from __future__ import annotations

import itertools
from pathlib import Path
import numpy as np
import pandas as pd

FEATURE_BASES = [
    'AGE','WEIGHT','ST_AVG','CLASS','L','F','WIN1RATE','WIN2RATE',
    'LOCALWIN1RATE','LOCALWIN2RATE','MOTORWIN2RATE','MOTORWIN3RATE',
    'BOATWIN2RATE','BOATWIN3RATE'
]
META_FEATURES = ['PLACE','RACE','MONTH','DAYOFWEEK','LANE']
FEATURES = META_FEATURES + FEATURE_BASES


def parse_order(value):
    if pd.isna(value):
        return None
    s = str(value).replace(' ', '')
    for sep in ('>', '-', '='):
        if sep in s:
            parts = s.split(sep)
            break
    else:
        parts = list(s)
    try:
        vals = tuple(int(x) for x in parts if str(x).isdigit())
    except Exception:
        return None
    return vals if len(vals) >= 3 and len(set(vals[:3])) == 3 and all(1 <= x <= 6 for x in vals[:3]) else None


def wide_to_long(df: pd.DataFrame, require_target: bool = True) -> pd.DataFrame:
    base = df.copy()
    dates = pd.to_datetime(base['RACEDATE'], errors='coerce')
    base['MONTH'] = dates.dt.month
    base['DAYOFWEEK'] = dates.dt.dayofweek

    orders = base['RENTAN3'].map(parse_order) if 'RENTAN3' in base.columns else pd.Series([None] * len(base), index=base.index)
    if require_target:
        valid = orders.notna()
        base = base.loc[valid].copy()
        orders = orders.loc[valid]
    rows = []
    for lane in range(1, 7):
        part = pd.DataFrame(index=base.index)
        part['race_row'] = base.index
        part['PLACE'] = base['PLACE'].astype(str)
        part['RACE'] = pd.to_numeric(base['RACE'], errors='coerce')
        part['MONTH'] = base['MONTH']
        part['DAYOFWEEK'] = base['DAYOFWEEK']
        part['LANE'] = lane
        for f in FEATURE_BASES:
            part[f] = pd.to_numeric(base[f'{f}{lane}'], errors='coerce')
        if require_target:
            part['y1'] = orders.map(lambda x: int(bool(x) and x[0] == lane))
            part['y2'] = orders.map(lambda x: int(bool(x) and x[1] == lane))
            part['y3'] = orders.map(lambda x: int(bool(x) and x[2] == lane))
        if 'split' in base.columns:
            part['split'] = base['split'].astype(str)
        rows.append(part)
    return pd.concat(rows, ignore_index=True)


def combo_probabilities(lanes, p1, p2, p3):
    p1 = np.asarray(p1, dtype=float)
    p2 = np.asarray(p2, dtype=float)
    p3 = np.asarray(p3, dtype=float)
    p1 = p1 / p1.sum() if p1.sum() else np.ones_like(p1) / len(p1)
    out = []
    for a, b, c in itertools.permutations(range(len(lanes)), 3):
        rem2 = [i for i in range(len(lanes)) if i != a]
        denom2 = p2[rem2].sum()
        q2 = p2[b] / denom2 if denom2 else 1 / len(rem2)
        rem3 = [i for i in rem2 if i != b]
        denom3 = p3[rem3].sum()
        q3 = p3[c] / denom3 if denom3 else 1 / len(rem3)
        prob = p1[a] * q2 * q3
        out.append((f'{lanes[a]}-{lanes[b]}-{lanes[c]}', float(prob)))
    total = sum(p for _, p in out)
    if total:
        out = [(k, p / total) for k, p in out]
    return sorted(out, key=lambda x: x[1], reverse=True)
