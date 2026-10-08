"""Research-only dated player features, keyed by official registration number.

No predictions, model fitting, bet selection or updates to historical records.
Query course must be a separately supplied planned course, never a target outcome.
"""
import argparse
import collections
import csv
import datetime as dt
import gzip
import hashlib
import json
import math
from pathlib import Path


def date_value(value):
    return dt.datetime.strptime(str(value).replace('-', ''), '%Y%m%d').date()


class RecentHistory:
    def __init__(self, rows, available_dates):
        self.available_dates = {date_value(d) for d in available_dates}
        self.players = collections.defaultdict(list)
        seen = set()
        for r in rows:
            date = date_value(r['date'])
            if date not in self.available_dates:
                raise ValueError('Row outside source date coverage')
            rid, venue, course, race, lane = (int(r[k]) for k in ('racer_id', 'stadium', 'course', 'race', 'lane'))
            if not (1000 <= rid <= 9999 and 1 <= venue <= 24 and 1 <= course <= 6 and 1 <= race <= 12 and 1 <= lane <= 6):
                raise ValueError('Invalid registration/venue/course/race/lane')
            key = (date, venue, race, lane)
            if key in seen:
                raise ValueError('Duplicate official start')
            seen.add(key)
            finish = int(r['finish']) if r.get('finish') not in (None, '') else None
            if finish is not None and not 1 <= finish <= 6:
                raise ValueError('Invalid normal finish')
            st = float(r['st']) if r.get('st') not in (None, '') else None
            if st is not None and (not math.isfinite(st) or abs(st) > 2):
                raise ValueError('Invalid main-race ST')
            self.players[rid].append({'date': date, 'stadium': venue, 'course': course,
                                      'finish': finish, 'st': st, 'st_quality': r.get('st_quality'),
                                      'finish_status': str(r.get('finish_status', ''))})
        self.starts = len(seen)

    @staticmethod
    def summarize(rows):
        n = len(rows)
        finishes = [r['finish'] for r in rows if r['finish'] is not None]
        # Negative main-race F and late starts are separate, not normal ST.
        ordinary = [r['st'] for r in rows if r['st_quality'] == 'observed' and r['st'] is not None and r['st'] >= 0]
        return {'starts': n, 'normal_finishes': len(finishes), 'non_normal_finishes': n - len(finishes),
                'win_rate': sum(f == 1 for f in finishes) / n if n else None,
                'top2_rate': sum(f <= 2 for f in finishes) / n if n else None,
                'top3_rate': sum(f <= 3 for f in finishes) / n if n else None,
                'mean_normal_finish': sum(finishes) / len(finishes) if finishes else None,
                'ordinary_st_count': len(ordinary), 'mean_ordinary_st': sum(ordinary) / len(ordinary) if ordinary else None,
                'main_race_F_count': sum(r['finish_status'].startswith('F') or (r['st'] is not None and r['st'] < 0) for r in rows),
                'late_start_count': sum(r['st_quality'] == 'late_start_excluded' for r in rows),
                'small_sample': n < 10}

    def features(self, *, query_date, racer_id, stadium, planned_course):
        query = date_value(query_date)
        rid, venue, course = int(racer_id), int(stadium), int(planned_course)
        if not (1000 <= rid <= 9999 and 1 <= venue <= 24 and 1 <= course <= 6):
            raise ValueError('Invalid query identity or planned course')
        out = {'version': 'recent-player-research-v1', 'as_of_date': query.isoformat(),
               'racer_id': rid, 'stadium': venue, 'planned_course': course, 'windows': {}}
        for days in (30, 90):
            start = query - dt.timedelta(days=days)
            rs = [r for r in self.players.get(rid, []) if start <= r['date'] < query]
            expected = {start + dt.timedelta(days=i) for i in range(days)}
            coverage = len(expected & self.available_dates)
            groups = {'overall': rs, 'course': [r for r in rs if r['course'] == course],
                      'venue': [r for r in rs if r['stadium'] == venue],
                      'venue_course': [r for r in rs if r['stadium'] == venue and r['course'] == course]}
            out['windows'][str(days)] = {'from': start.isoformat(), 'through': (query - dt.timedelta(days=1)).isoformat(),
                                         'source_days': coverage, 'required_days': days, 'source_complete': coverage == days,
                                         'groups': {name: self.summarize(rows) for name, rows in groups.items()}}
        return out


def load_sources(official_history, expected_sha, daily_dir):
    sha = hashlib.sha256(official_history.read_bytes()).hexdigest()
    if sha != expected_sha:
        raise ValueError('Official history source hash mismatch')
    with gzip.open(official_history, 'rt', encoding='utf-8', newline='') as f:
        rows = list(csv.DictReader(f))
    dates = {r['date'] for r in rows}
    proof = {'official_history_sha256': sha, 'daily_sources': []}
    daily = []
    for p in sorted(daily_dir.glob('*.json')):
        j = json.loads(p.read_text(encoding='utf-8'))
        if set(j.get('source_sha256', {})) != {'B', 'K'} or any(len(v) != 64 for v in j['source_sha256'].values()):
            raise ValueError('Missing official B/K source evidence')
        date = j['date']
        if p.stem != date or date in dates:
            raise ValueError('Duplicate/mismatched source date')
        dates.add(date)
        daily.extend({'date': date, **r} for r in j['starts'])
        proof['daily_sources'].append({'date': date, 'starts': len(j['starts']), 'source_sha256': j['source_sha256']})
    rows.extend(daily)
    return RecentHistory(rows, dates), daily, proof


def main():
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument('--official-history', type=Path, required=True)
    p.add_argument('--expected-sha', required=True)
    p.add_argument('--daily-dir', type=Path, required=True)
    p.add_argument('--as-of', required=True)
    p.add_argument('--out', type=Path, required=True)
    args = p.parse_args()
    if args.out.resolve() == args.official_history.resolve() or args.out.resolve().is_relative_to(args.daily_dir.resolve()):
        p.error('Output must not overwrite source artifacts')
    history, daily, proof = load_sources(args.official_history, args.expected_sha, args.daily_dir)
    query = date_value(args.as_of)
    if any(d >= query for d in history.available_dates):
        p.error('Coverage audit input must end before query date')
    prior = (query - dt.timedelta(days=1)).strftime('%Y%m%d')
    contexts = sorted({(int(r['racer_id']), int(r['stadium']), int(r['course'])) for r in daily if r['date'] == prior})
    if not contexts:
        p.error('Previous-day contexts are required for this diagnostic sample')
    captures = [history.features(query_date=args.as_of, racer_id=r, stadium=v, planned_course=c) for r, v, c in contexts]
    report = {'version': 'recent-player-coverage-audit-v1', 'as_of': query.isoformat(), 'history_starts': history.starts,
              'history_days': len(history.available_dates), 'source': proof, 'diagnostic_contexts': len(contexts),
              'context_selection': 'Previous-day observed player/venue/course cells; coverage diagnostics only, no target races or forecasts.',
              'windows': {}, 'prediction_changed': False,
              'limitations': ['Raw descriptive features, not calibrated probabilities or fitted improvements.',
                             'Registration IDs are absent from the uploaded training CSV; historical joins remain unverified.',
                             'Production and existing shadow predictions are unchanged. Integration requires prospective preclose identity capture.']}
    for days in ('30', '90'):
        report['windows'][days] = {'source_complete_contexts': sum(x['windows'][days]['source_complete'] for x in captures),
                                   'groups': {name: {'nonempty_contexts': sum(x['windows'][days]['groups'][name]['starts'] > 0 for x in captures),
                                                    'contexts_with_10_or_more_starts': sum(x['windows'][days]['groups'][name]['starts'] >= 10 for x in captures)}
                                              for name in ('overall', 'course', 'venue', 'venue_course')}}
    args.out.parent.mkdir(parents=True, exist_ok=True)
    args.out.write_text(json.dumps(report, ensure_ascii=False, indent=2, allow_nan=False) + '\n', encoding='utf-8')
    print(json.dumps({'history_starts': history.starts, 'contexts': len(contexts), 'windows': report['windows']}, ensure_ascii=False))


if __name__ == '__main__':
    main()
