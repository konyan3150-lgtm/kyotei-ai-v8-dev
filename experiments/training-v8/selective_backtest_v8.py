from __future__ import annotations

import argparse
import json
from pathlib import Path

import joblib
import numpy as np
import pandas as pd

from chronology import prepare_splits, POLICY
from common import FEATURES, combo_probabilities, parse_order, wide_to_long


def canonical_result(value):
    order = parse_order(value)
    if not order or len(order) < 3:
        return None
    return '-'.join(map(str, order[:3]))


def load_models(model_dir: Path):
    models, cals = {}, {}
    for rank in (1, 2, 3):
        models[rank] = joblib.load(model_dir / f'rank{rank}.joblib')
        cals[rank] = joblib.load(model_dir / f'cal_rank{rank}.joblib')
    return models, cals


def add_probs(long_df, models, cals):
    x = long_df[FEATURES]
    for rank in (1, 2, 3):
        raw_p = models[rank].predict_proba(x)[:, 1]
        long_df[f'p{rank}'] = np.clip(cals[rank].predict(raw_p), 1e-6, 1 - 1e-6)
    return long_df


def race_rows(raw, long_df, top_k, stake):
    rows = []
    for rid, g in long_df.groupby('race_row', sort=False):
        actual = canonical_result(raw.loc[rid, 'RENTAN3'])
        payout = pd.to_numeric(raw.loc[rid, 'RENTAN3K'], errors='coerce')
        if actual is None or pd.isna(payout):
            continue
        g = g.sort_values('LANE')
        combos = combo_probabilities(g['LANE'].tolist(), g['p1'], g['p2'], g['p3'])
        picks = combos[:top_k]
        probs = np.array([p for _, p in combos], dtype=float)
        top_prob = float(probs[0])
        gap = float(probs[0] - probs[1]) if len(probs) > 1 else top_prob
        entropy = float(-(probs * np.log(np.clip(probs, 1e-12, 1))).sum())
        p1_sorted = np.sort(g['p1'].to_numpy())[::-1]
        lane1_conf = float(p1_sorted[0])
        lane1_gap = float(p1_sorted[0] - p1_sorted[1])
        pick_names = [c for c, _ in picks]
        hit = actual in pick_names
        bet = stake * len(pick_names)
        returned = float(payout) * (stake / 100.0) if hit else 0.0
        rows.append({
            'race_row': int(rid),
            'RACEDATE': raw.loc[rid, 'RACEDATE'],
            'PLACE': raw.loc[rid, 'PLACE'],
            'RACE': raw.loc[rid, 'RACE'],
            'actual': actual,
            'picks': ','.join(pick_names),
            'hit': int(hit),
            'bet_yen': float(bet),
            'return_yen': float(returned),
            'top_combo_prob': top_prob,
            'top_combo_gap': gap,
            'combo_entropy': entropy,
            'top1_lane_prob': lane1_conf,
            'top1_lane_gap': lane1_gap,
        })
    return pd.DataFrame(rows)


def summarize(df):
    bet = df['bet_yen'].sum()
    ret = df['return_yen'].sum()
    return {
        'races': int(len(df)),
        'hits': int(df['hit'].sum()),
        'hit_rate': float(df['hit'].mean()) if len(df) else float('nan'),
        'bet_yen': float(bet),
        'return_yen': float(ret),
        'profit_yen': float(ret - bet),
        'roi': float(ret / bet) if bet else float('nan'),
    }


def find_rule(valid_df, min_races):
    # Deliberately simple, interpretable rule family to reduce overfitting.
    prob_grid = np.unique(np.quantile(valid_df['top_combo_prob'], np.linspace(0.05, 0.90, 18)))
    gap_grid = np.unique(np.quantile(valid_df['top1_lane_gap'], np.linspace(0.00, 0.80, 9)))
    candidates = []
    for p in prob_grid:
        for g in gap_grid:
            sel = valid_df[(valid_df['top_combo_prob'] >= p) & (valid_df['top1_lane_gap'] >= g)]
            if len(sel) < min_races:
                continue
            s = summarize(sel)
            # Penalize tiny samples while still prioritizing ROI.
            shrink = min(1.0, len(sel) / max(min_races * 2, 1))
            score = 1.0 + (s['roi'] - 1.0) * shrink
            candidates.append((score, s['roi'], len(sel), float(p), float(g), s))
    if not candidates:
        raise ValueError('条件に合う検証候補がありません。--min-races を下げてください。')
    candidates.sort(key=lambda x: (x[0], x[1], x[2]), reverse=True)
    return candidates[0], candidates[:20]


def print_summary(label, s):
    print(f'\n[{label}]')
    print(f"レース数: {s['races']:,}")
    print(f"的中: {s['hits']:,} ({s['hit_rate']*100:.2f}%)")
    print(f"投資: {s['bet_yen']:,.0f}円")
    print(f"払戻: {s['return_yen']:,.0f}円")
    print(f"損益: {s['profit_yen']:,.0f}円")
    print(f"回収率: {s['roi']*100:.2f}%")


def main():
    ap = argparse.ArgumentParser(description='競艇AI v8: 見送り判定の検証→固定ルールでtest評価')
    ap.add_argument('csv')
    ap.add_argument('--models', default='models_v8')
    ap.add_argument('--top-k', type=int, default=3)
    ap.add_argument('--stake', type=int, default=100)
    ap.add_argument('--min-races', type=int, default=300, help='検証ルールの最低購入レース数')
    args = ap.parse_args()

    raw = prepare_splits(pd.read_csv(args.csv))
    if joblib.load(Path(args.models) / 'meta.joblib').get('evaluation_policy') != POLICY:
        raise ValueError('Models must be retrained with separate calibration/selection dates')
    required = {'RENTAN3', 'RENTAN3K', 'split'}
    missing = required - set(raw.columns)
    if missing:
        raise ValueError(f'必要列がありません: {sorted(missing)}')

    long = wide_to_long(raw, require_target=False)
    models, cals = load_models(Path(args.models))

    valid_long = add_probs(long[long['split'].eq('selection')].copy(), models, cals)
    test_long = add_probs(long[long['split'].eq('test')].copy(), models, cals)
    valid = race_rows(raw, valid_long, args.top_k, args.stake)
    test = race_rows(raw, test_long, args.top_k, args.stake)

    print_summary('VALID 全レース', summarize(valid))
    best, top = find_rule(valid, args.min_races)
    _, _, _, p_thr, gap_thr, val_summary = best
    print(f'\n選択ルール: top_combo_prob >= {p_thr:.5f} AND top1_lane_gap >= {gap_thr:.5f}')
    print_summary('VALID 選択後', val_summary)

    test_sel = test[(test['top_combo_prob'] >= p_thr) & (test['top1_lane_gap'] >= gap_thr)].copy()
    print_summary('TEST 固定ルール', summarize(test_sel))
    print_summary('TEST 全レース比較', summarize(test))

    out = Path(args.models)
    out.mkdir(parents=True, exist_ok=True)
    rule = {
        'version': 'v8',
        'top_k': args.top_k,
        'stake': args.stake,
        'min_races': args.min_races,
        'top_combo_prob_min': p_thr,
        'top1_lane_gap_min': gap_thr,
        'validation': val_summary,
        'test': summarize(test_sel),
        'test_all': summarize(test),
    }
    with (out / 'selective_rule.json').open('w', encoding='utf-8') as f:
        json.dump(rule, f, ensure_ascii=False, indent=2)
    test_sel.to_csv(out / 'backtest_v8_selected_test.csv', index=False)
    pd.DataFrame([{
        'score': x[0], 'roi': x[1], 'races': x[2], 'top_combo_prob_min': x[3],
        'top1_lane_gap_min': x[4], **{f's_{k}': v for k, v in x[5].items()}
    } for x in top]).to_csv(out / 'v8_rule_candidates.csv', index=False)
    print(f'\n保存: {out / "selective_rule.json"}')


if __name__ == '__main__':
    main()
