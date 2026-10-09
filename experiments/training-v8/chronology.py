import pandas as pd
POLICY='chronological_calibration_selection_v1'
def prepare_splits(raw):
    required={'RACEDATE','PLACE','RACE','split'}
    if not required.issubset(raw.columns):raise ValueError('Missing chronology columns')
    out=raw.copy();dates=pd.to_datetime(out.RACEDATE,errors='coerce')
    if dates.isna().any() or not set(out.split).issubset({'train','validate','test'}):raise ValueError('Invalid date or split')
    if out.duplicated(['RACEDATE','PLACE','RACE']).any():raise ValueError('Duplicate race identity')
    groups={s:dates[out.split.eq(s)] for s in ['train','validate','test']}
    if any(g.empty for g in groups.values()) or not (groups['train'].max()<groups['validate'].min() and groups['validate'].max()<groups['test'].min()):raise ValueError('Chronological split overlap or reversal')
    days=sorted(groups['validate'].unique())
    if len(days)<2:raise ValueError('Validation needs two distinct dates')
    boundary=days[len(days)//2]
    out.loc[out.split.eq('validate') & dates.lt(boundary),'split']='calibration'
    out.loc[out.split.eq('validate'),'split']='selection'
    return out
