"""Read-only audit of the uploaded V8 ZIP and training CSV; never load pickles.

Usage: python experiments/audit_training_assets.py ASSETS.zip TRAINING.csv --out report.json
Python standard library only. Original data and model artifacts remain unchanged.
"""
import argparse
import ast
import collections
import csv
import datetime as dt
import hashlib
import json
import pathlib
import re
import zipfile

OUTCOMES = {'TAN', 'TANK', 'RENTAN2', 'RENTAN2K', 'RENTAN3', 'RENTAN3K'}
SPLITS = ('train', 'validate', 'test')


def digest(path):
    h = hashlib.sha256()
    with open(path, 'rb') as f:
        for block in iter(lambda: f.read(1024 * 1024), b''):
            h.update(block)
    return h.hexdigest()


def features_from_source(source):
    # Read literal definitions without executing uploaded Python or joblib files.
    definitions = {}
    for node in ast.parse(source).body:
        if isinstance(node, ast.Assign):
            for name in node.targets:
                if isinstance(name, ast.Name) and name.id in ('FEATURE_BASES', 'META_FEATURES'):
                    definitions[name.id] = ast.literal_eval(node.value)
    if set(definitions) != {'FEATURE_BASES', 'META_FEATURES'}:
        raise ValueError('Missing literal feature definitions')
    return definitions['META_FEATURES'] + definitions['FEATURE_BASES']


def audit_rows(rows, columns):
    errors = collections.Counter()
    dates = {s: collections.Counter() for s in SPLITS}
    seen = set()
    count = 0
    empty = collections.Counter()
    for row in rows:
        count += 1
        empty.update(k for k, v in row.items() if v is None or v == '')
        split = row.get('split')
        if split not in dates:
            errors['unknown_split'] += 1
        date = row.get('RACEDATE') or ''
        try:
            if not re.fullmatch(r'\d{4}-\d{2}-\d{2}', date):
                raise ValueError()
            dt.date.fromisoformat(date)
            if split in dates:
                dates[split][date] += 1
        except ValueError:
            errors['invalid_date'] += 1
        key = (date, row.get('PLACE'), row.get('RACE'))
        if key in seen:
            errors['duplicate_race_key'] += 1
        seen.add(key)
        if not row.get('PLACE') or not re.fullmatch(r'(?:[1-9]|1[0-2])', row.get('RACE') or ''):
            errors['invalid_race_key'] += 1
        result = row.get('RENTAN3') or ''
        if not re.fullmatch(r'[1-6]>[1-6]>[1-6]', result) or len(set(result.split('>'))) != 3:
            errors['invalid_trifecta'] += 1
        try:
            payout = float(row.get('RENTAN3K', ''))
            if not (payout > 0 and payout.is_integer()):
                raise ValueError()
        except (ValueError, OverflowError):
            errors['invalid_payout'] += 1
    periods = {}
    for s in SPLITS:
        ds = sorted(dates[s])
        periods[s] = {'races': sum(dates[s].values()), 'days': len(ds),
                      'first_date': ds[0] if ds else None, 'last_date': ds[-1] if ds else None}
        if not ds:
            errors['empty_split'] += 1
    chronology = all(periods[a]['last_date'] and periods[b]['first_date'] and
                     periods[a]['last_date'] < periods[b]['first_date']
                     for a, b in zip(SPLITS, SPLITS[1:]))
    if not chronology:
        errors['overlapping_or_reversed_periods'] += 1
    vd = sorted(dates['validate'])
    cut = len(vd) // 2
    proposed = {}
    for name, ds in [('calibration', vd[:cut]), ('rule_selection', vd[cut:])]:
        proposed[name] = {'first_date': ds[0] if ds else None,
                          'last_date': ds[-1] if ds else None,
                          'races': sum(dates['validate'][d] for d in ds), 'days': len(ds)}
    if len(columns) != len(set(columns)):
        errors['duplicate_column_names'] += 1
    return {'races': count, 'columns': len(columns), 'periods': periods,
            'chronological_separation': bool(chronology), 'errors': dict(errors),
            'empty_cells_by_column': dict(empty), 'proposed_validation_partition': proposed}


def audit_assets(archive, training_csv):
    with open(training_csv, encoding='utf-8-sig', newline='') as f:
        reader = csv.DictReader(f)
        columns = reader.fieldnames or []
        required = {'RACEDATE', 'PLACE', 'RACE', 'split', 'RENTAN3', 'RENTAN3K'}
        if required - set(columns):
            raise ValueError(f'Missing columns: {sorted(required - set(columns))}')
        data = audit_rows(reader, columns)
    with zipfile.ZipFile(archive) as z:
        candidates = [n for n in z.namelist() if n.endswith('/src/common.py')]
        if len(candidates) != 1:
            raise ValueError('Expected exactly one src/common.py')
        prefix = candidates[0][:-len('src/common.py')]
        features = features_from_source(z.read(prefix + 'src/common.py').decode('utf-8'))
        train_source = z.read(prefix + 'src/train_v8.py').decode('utf-8')
        rule_source = z.read(prefix + 'src/selective_backtest_v8.py').decode('utf-8')
        metrics = json.loads(z.read(prefix + 'models_v8/metrics.json'))
        rule = json.loads(z.read(prefix + 'models_v8/selective_rule.json'))
        artifacts = {n[len(prefix):]: hashlib.sha256(z.read(n)).hexdigest()
                     for n in z.namelist() if n.startswith(prefix + 'models_v8/') and not n.endswith('/')}
        backtest = list(csv.DictReader(z.read(prefix + 'models_v8/backtest_v8_selected_test.csv').decode('utf-8').splitlines()))
    missing_features = []
    meta = {'PLACE', 'RACE', 'MONTH', 'DAYOFWEEK', 'LANE'}
    for feature in features:
        if feature not in meta:
            missing_features.extend(f'{feature}{i}' for i in range(1, 7) if f'{feature}{i}' not in columns)
    reproduced = {'races': len(backtest), 'hits': sum(int(x['hit']) for x in backtest),
                  'bet_yen': sum(float(x['bet_yen']) for x in backtest),
                  'return_yen': sum(float(x['return_yen']) for x in backtest)}
    reproduced['roi'] = reproduced['return_yen'] / reproduced['bet_yen'] if reproduced['bet_yen'] else None
    matches = all(abs(reproduced[k] - rule['test'][k]) < 1e-9 for k in reproduced)
    brier = {f'rank{i}': {'raw': metrics[f'rank{i}_brier_raw'],
                         'calibrated': metrics[f'rank{i}_brier_calibrated'],
                         'delta_calibrated_minus_raw': metrics[f'rank{i}_brier_calibrated'] - metrics[f'rank{i}_brier_raw']}
             for i in (1, 2, 3)}
    return {
        'version': 'uploaded-v8-assets-audit-v1',
        'sources': {'archive_sha256': digest(archive), 'csv_sha256': digest(training_csv),
                    'model_artifact_sha256': artifacts},
        'data': data,
        'features': {'count': len(features), 'names': features,
                     'outcome_columns_used': sorted(OUTCOMES.intersection(features)),
                     'missing_source_columns': missing_features,
                     'as_of_capture_provenance': 'not_present_in_csv; historical rate cutoff cannot be verified'},
        'training_source_review': {
            'model_fit_train_only': "model.fit(train[FEATURES]" in train_source,
            'calibrator_fit_validate': "cal.fit(p_valid_raw, valid[" in train_source,
            'rule_search_validate': 'find_rule(valid, args.min_races)' in rule_source,
            'same_validate_used_for_calibration_and_rule_selection':
                "cal.fit(p_valid_raw, valid[" in train_source and 'find_rule(valid, args.min_races)' in rule_source,
            'caution': 'Shared validation may overstate tuning results; it does not by itself leak test labels. Static source review, not proof of how uploaded binary artifacts were built.'},
        'saved_evaluation': {'rule_validation': rule['validation'], 'rule_test': rule['test'],
                              'all_test': rule['test_all'], 'brier': brier,
                              'test_backtest_recomputed': reproduced, 'backtest_matches_saved_metrics': matches,
                              'roi_difference_percentage_points': 100 * (rule['test']['roi'] - rule['test_all']['roi']),
                              'test_status': 'already_reported; unsuitable as untouched test for future rule tuning'},
        'next_data_requirements': {
            'recent_player_course_venue': 'Registration IDs and dated, verified result history; IDs absent from this CSV.',
            'exhibition_F': 'Observed preclose signed exhibition ST; ST_AVG is historical average, not exhibition ST.',
            'odds_deterioration': 'Timestamped preclose odds; payout column covers winning combination only, never all 120 odds.'},
        'decision': 'Do not promote uploaded selective rule or recalibration on these results. Preserve assets; separate calibration/rule-selection periods and evaluate frozen candidates on later unseen data.',
    }


def main():
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument('archive', type=pathlib.Path)
    p.add_argument('training_csv', type=pathlib.Path)
    p.add_argument('--out', type=pathlib.Path)
    args = p.parse_args()
    if args.out and args.out.resolve() in {args.archive.resolve(), args.training_csv.resolve()}:
        p.error('Output must not overwrite source artifacts')
    report = audit_assets(args.archive, args.training_csv)
    payload = json.dumps(report, ensure_ascii=False, indent=2, allow_nan=False) + '\n'
    if args.out:
        args.out.parent.mkdir(parents=True, exist_ok=True)
        args.out.write_text(payload, encoding='utf-8')
    else:
        print(payload, end='')
    blocking = report['data']['errors'] or report['features']['outcome_columns_used'] or report['features']['missing_source_columns'] or not report['saved_evaluation']['backtest_matches_saved_metrics']
    return int(bool(blocking))


if __name__ == '__main__':
    raise SystemExit(main())
