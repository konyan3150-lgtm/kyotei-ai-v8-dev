"""Descriptive historical slices; no threshold or calibrator selection on test."""
import argparse
import hashlib
import importlib.util
import json
from pathlib import Path
import joblib
import numpy as np
import pandas as pd
from sklearn.linear_model import LogisticRegression
from sklearn.metrics import brier_score_loss, log_loss

def ece(y, p):
    bins = np.minimum((p * 10).astype(int), 9)
    return float(sum(np.mean(bins == k) * abs(p[bins == k].mean() - y[bins == k].mean()) for k in range(10) if (bins == k).any()))

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--csv', required=True); ap.add_argument('--source', required=True); ap.add_argument('--out', required=True)
    a = ap.parse_args(); src, out = Path(a.source), Path(a.out); out.mkdir(parents=True, exist_ok=True)
    spec = importlib.util.spec_from_file_location('common', src/'src/common.py'); common = importlib.util.module_from_spec(spec); spec.loader.exec_module(common)
    raw = pd.read_csv(a.csv); assert not raw.duplicated(['RACEDATE', 'PLACE', 'RACE']).any()
    periods = raw.groupby('split').RACEDATE.agg(['min','max','count'])
    assert periods.loc['train','max'] < periods.loc['validate','min'] < periods.loc['test','min']
    assert periods.loc['validate','max'] < periods.loc['test','min']
    long = common.wide_to_long(raw); valid = long[long.split.eq('validate')]; test = long[long.split.eq('test')].copy()
    dates = pd.to_datetime(test.race_row.map(raw.RACEDATE)); test['week'] = dates.dt.to_period('W-SUN').astype(str); test['month'] = dates.dt.strftime('%Y-%m')
    vd = pd.to_datetime(valid.race_row.map(raw.RACEDATE)); weights = np.power(.5, (vd.max()-vd).dt.days.to_numpy()/21)
    logit = lambda p: np.log(np.clip(p,1e-6,1-1e-6)/(1-np.clip(p,1e-6,1-1e-6))).reshape(-1,1)
    summary = {'source_sha256':hashlib.sha256(Path(a.csv).read_bytes()).hexdigest(),'historical_races':len(raw),'test_races':test.race_row.nunique(),
      'scope':'Repeated descriptive analysis of the archived test split; not a fresh holdout and not evidence for production promotion.', 'ranks':{}}
    for rank in (1,2,3):
        model = joblib.load(src/f'models_v8/rank{rank}.joblib'); old = joblib.load(src/f'models_v8/cal_rank{rank}.joblib')
        pv = model.predict_proba(valid[common.FEATURES])[:,1]; pt = model.predict_proba(test[common.FEATURES])[:,1]
        yv = valid[f'y{rank}'].to_numpy(); yt = test[f'y{rank}'].to_numpy()
        predictions = {'raw':pt,'old_isotonic':old.predict(pt)}
        for name,w in [('platt',None),('recent_platt_21d',weights)]:
            cal = LogisticRegression(C=1e6,max_iter=1000).fit(logit(pv),yv,sample_weight=w); predictions[name] = cal.predict_proba(logit(pt))[:,1]
        groups = [('all','all',np.ones(len(test),dtype=bool))]
        for field in ['PLACE','week','month']:
            groups += [(field,str(k),test[field].eq(k).to_numpy()) for k in sorted(test[field].unique())]
        report = []
        for field,k,mask in groups:
            metrics = {}
            for name,p in predictions.items():
                pp = np.clip(p[mask],1e-6,1-1e-6); yy = yt[mask]
                metrics[name] = {'brier':float(brier_score_loss(yy,pp)), 'log_loss':float(log_loss(yy,pp,labels=[0,1])), 'ece_10_bins':ece(yy,pp)}
            report.append({'group':field,'name':k,'races':int(test.loc[mask,'race_row'].nunique()),'metrics':metrics})
        (out/f'rank{rank}.json').write_text(json.dumps(report,ensure_ascii=False,indent=2))
        counts = {}
        for name in predictions:
            if name=='raw':continue
            counts[name] = {field:{'improved':sum(r['metrics'][name]['brier']<r['metrics']['raw']['brier'] for r in report if r['group']==field),
                                  'total':sum(r['group']==field for r in report)} for field in ['PLACE','week','month']}
        summary['ranks'][str(rank)] = {'overall':report[0]['metrics'],'brier_improvement_counts':counts}
        print('rank',rank,json.dumps(counts,ensure_ascii=False),flush=True)
    (out/'summary.json').write_text(json.dumps(summary,ensure_ascii=False,indent=2))
if __name__=='__main__':main()
