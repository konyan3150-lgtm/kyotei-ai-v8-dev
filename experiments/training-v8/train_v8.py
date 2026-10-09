from __future__ import annotations

import argparse
import json
from pathlib import Path

import joblib
import numpy as np
import pandas as pd
from sklearn.isotonic import IsotonicRegression
from sklearn.metrics import brier_score_loss, roc_auc_score

from chronology import prepare_splits, POLICY
from common import FEATURES, combo_probabilities, parse_order, wide_to_long
from train import make_model, race_top1_accuracy


def _calibrate(cal, p):
    p = np.asarray(p, dtype=float)
    return np.clip(cal.predict(p), 1e-6, 1 - 1e-6)


def trifecta_top1_accuracy(raw: pd.DataFrame, long_df: pd.DataFrame, probs: dict[int, np.ndarray]) -> float:
    tmp = long_df[['race_row', 'LANE']].copy()
    for rank in (1, 2, 3):
        tmp[f'p{rank}'] = probs[rank]
    correct = total = 0
    for rid, g in tmp.groupby('race_row', sort=False):
        g = g.sort_values('LANE')
        pred = combo_probabilities(g['LANE'].tolist(), g['p1'], g['p2'], g['p3'])[0][0]
        order = parse_order(raw.loc[rid, 'RENTAN3'])
        if order:
            actual = '-'.join(map(str, order[:3]))
            correct += int(pred == actual)
            total += 1
    return correct / total if total else float('nan')


def main():
    ap = argparse.ArgumentParser(description='競艇AI v8: 時系列分離 + 確率キャリブレーション学習')
    ap.add_argument('csv')
    ap.add_argument('--out', default='models_v8')
    args = ap.parse_args()

    raw = prepare_splits(pd.read_csv(args.csv))
    long = wide_to_long(raw, require_target=True)
    if 'split' not in long.columns:
        raise ValueError('CSVに split 列が必要です。')

    train = long[long['split'].eq('train')].copy()
    valid = long[long['split'].eq('calibration')].copy()
    test = long[long['split'].eq('test')].copy()
    print(f'rows train={len(train):,} valid={len(valid):,} test={len(test):,}')

    out = Path(args.out)
    out.mkdir(parents=True, exist_ok=True)

    models = {}
    calibrators = {}
    metrics = {}
    test_probs = {}

    for rank in (1, 2, 3):
        model = make_model()
        model.fit(train[FEATURES], train[f'y{rank}'])

        p_valid_raw = model.predict_proba(valid[FEATURES])[:, 1]
        cal = IsotonicRegression(y_min=1e-6, y_max=1 - 1e-6, out_of_bounds='clip')
        cal.fit(p_valid_raw, valid[f'y{rank}'].to_numpy())

        p_test_raw = model.predict_proba(test[FEATURES])[:, 1]
        p_test = _calibrate(cal, p_test_raw)
        test_probs[rank] = p_test

        auc_raw = roc_auc_score(test[f'y{rank}'], p_test_raw)
        auc_cal = roc_auc_score(test[f'y{rank}'], p_test)
        brier_raw = brier_score_loss(test[f'y{rank}'], p_test_raw)
        brier_cal = brier_score_loss(test[f'y{rank}'], p_test)
        pick_acc = race_top1_accuracy(test, p_test, f'y{rank}')

        metrics[f'rank{rank}_auc_raw'] = float(auc_raw)
        metrics[f'rank{rank}_auc_calibrated'] = float(auc_cal)
        metrics[f'rank{rank}_brier_raw'] = float(brier_raw)
        metrics[f'rank{rank}_brier_calibrated'] = float(brier_cal)
        metrics[f'rank{rank}_race_pick_accuracy'] = float(pick_acc)

        models[rank] = model
        calibrators[rank] = cal
        joblib.dump(model, out / f'rank{rank}.joblib')
        joblib.dump(cal, out / f'cal_rank{rank}.joblib')

        print(
            f'rank{rank}: AUC raw={auc_raw:.4f} cal={auc_cal:.4f} | '
            f'Brier raw={brier_raw:.4f} cal={brier_cal:.4f} | pick={pick_acc:.4f}'
        )

    tri = trifecta_top1_accuracy(raw, test, test_probs)
    metrics['trifecta_top1_accuracy'] = float(tri)
    print(f'trifecta top1 exact={tri:.4f}')

    joblib.dump({'features': FEATURES, 'metrics': metrics, 'version': 'v8', 'evaluation_policy': POLICY}, out / 'meta.joblib')
    with (out / 'metrics.json').open('w', encoding='utf-8') as f:
        json.dump(metrics, f, ensure_ascii=False, indent=2)
    print(f'saved to {out.resolve()}')


if __name__ == '__main__':
    main()
