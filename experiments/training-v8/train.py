from __future__ import annotations

import argparse
from pathlib import Path
import joblib
import numpy as np
import pandas as pd
from sklearn.compose import ColumnTransformer
from sklearn.ensemble import HistGradientBoostingClassifier
from sklearn.impute import SimpleImputer
from sklearn.metrics import roc_auc_score
from sklearn.pipeline import Pipeline
from sklearn.preprocessing import OrdinalEncoder

from common import FEATURES, META_FEATURES, wide_to_long, combo_probabilities, parse_order

CAT = ['PLACE']
NUM = [c for c in FEATURES if c not in CAT]


def make_model():
    pre = ColumnTransformer([
        ('cat', Pipeline([
            ('impute', SimpleImputer(strategy='most_frequent')),
            ('enc', OrdinalEncoder(handle_unknown='use_encoded_value', unknown_value=-1)),
        ]), CAT),
        ('num', Pipeline([
            ('impute', SimpleImputer(strategy='median')),
        ]), NUM),
    ])
    clf = HistGradientBoostingClassifier(
        learning_rate=0.08,
        max_iter=180,
        max_leaf_nodes=31,
        l2_regularization=1.0,
        random_state=42,
    )
    return Pipeline([('pre', pre), ('clf', clf)])


def race_top1_accuracy(long_df, probs, target_col):
    tmp = long_df[['race_row', 'LANE', target_col]].copy()
    tmp['p'] = probs
    pred = tmp.loc[tmp.groupby('race_row')['p'].idxmax(), ['race_row', 'LANE']].set_index('race_row')['LANE']
    actual = tmp[tmp[target_col] == 1].set_index('race_row')['LANE']
    common = pred.index.intersection(actual.index)
    return float((pred.loc[common] == actual.loc[common]).mean())


def trifecta_top1_accuracy(raw_test, long_test, models):
    ps = {r: models[r].predict_proba(long_test[FEATURES])[:, 1] for r in (1,2,3)}
    tmp = long_test[['race_row','LANE']].copy()
    for r in (1,2,3): tmp[f'p{r}'] = ps[r]
    correct = total = 0
    for rid, g in tmp.groupby('race_row', sort=False):
        g = g.sort_values('LANE')
        combos = combo_probabilities(g['LANE'].tolist(), g['p1'], g['p2'], g['p3'])
        pred = combos[0][0]
        actual_raw = raw_test.loc[rid, 'RENTAN3']
        order = parse_order(actual_raw)
        if order:
            actual = '-'.join(map(str, order[:3]))
            correct += pred == actual
            total += 1
    return correct / total if total else float('nan')


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('csv')
    ap.add_argument('--out', default='models')
    args = ap.parse_args()

    df = pd.read_csv(args.csv)
    long = wide_to_long(df, require_target=True)
    if 'split' not in long.columns:
        raise ValueError('CSVに split 列が必要です (train/validate/test)。')

    train = long[long['split'].eq('train')].copy()
    valid = long[long['split'].eq('validate')].copy()
    test = long[long['split'].eq('test')].copy()
    print(f'rows train={len(train):,} valid={len(valid):,} test={len(test):,}')

    models = {}
    metrics = {}
    for rank in (1, 2, 3):
        m = make_model()
        fit = pd.concat([train, valid], ignore_index=True)
        m.fit(fit[FEATURES], fit[f'y{rank}'])
        p = m.predict_proba(test[FEATURES])[:,1]
        auc = roc_auc_score(test[f'y{rank}'], p)
        top1 = race_top1_accuracy(test, p, f'y{rank}')
        models[rank] = m
        metrics[f'rank{rank}_auc'] = float(auc)
        metrics[f'rank{rank}_race_pick_accuracy'] = float(top1)
        print(f'rank{rank}: AUC={auc:.4f}, race-pick={top1:.4f}')

    # race_row in long refers to original dataframe index; preserve that index in test subset
    raw_test = df[df['split'].eq('test')].copy()
    tri_acc = trifecta_top1_accuracy(raw_test, test, models)
    metrics['trifecta_top1_accuracy'] = float(tri_acc)
    print(f'trifecta top1 exact={tri_acc:.4f}')

    out = Path(args.out); out.mkdir(parents=True, exist_ok=True)
    for rank, m in models.items(): joblib.dump(m, out / f'rank{rank}.joblib')
    joblib.dump({'features': FEATURES, 'metrics': metrics}, out / 'meta.joblib')
    pd.Series(metrics).to_json(out / 'metrics.json', indent=2)
    print(f'saved to {out.resolve()}')

if __name__ == '__main__': main()
