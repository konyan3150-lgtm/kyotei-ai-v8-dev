"""Append official earlier-day starts to a separate prospective snapshot."""
import gzip,hashlib,json,os
from datetime import datetime,timedelta
from pathlib import Path
from zoneinfo import ZoneInfo
from audit_official_aptitude import archive,parse_official
from repair_official_aptitude import accumulate,official_rows
COHORT='expert-shadow-official-v1'
def next_day(s):return (datetime.strptime(s.replace('-',''),'%Y%m%d')+timedelta(days=1)).strftime('%Y%m%d')
def append_day(data,date,btext,ktext):
    if date!=next_day(data['through']):raise ValueError('Noncontiguous/duplicate history day')
    _,program=parse_official(btext,'B');rows,excluded,raw=official_rows(ktext)
    if raw!=len(rows)+len(excluded):raise ValueError('Raw row accounting mismatch')
    for key,row in rows.items():
        if program.get(key)!=row['racer_id']:raise ValueError('Official program/result registration mismatch')
    for row in rows.values():accumulate(data,row)
    data['starts']+=len(rows);data['racers_count']=len(data['racers']);data['through']=f'{date[:4]}-{date[4:6]}-{date[6:]}';data['history_end']=date
    return {'date':date,'starts':len(rows),'races':len({k[:2] for k in rows}),'excluded_nonstarts':len(excluded)},rows,excluded

def atomic(p,content):
    p.parent.mkdir(parents=True,exist_ok=True);temp=p.with_suffix(p.suffix+'.tmp');temp.write_text(content);temp.replace(p)
def main():
    root=Path('dev');target=root/'racer-aptitude-prospective.json';auditpath=root/'aptitude-prospective-audit.json';cache=Path('/tmp/prospective-official-cache')
    end=(datetime.now(ZoneInfo('Asia/Tokyo')).date()-timedelta(days=1)).strftime('%Y%m%d')
    base=root/'racer-aptitude-official.json';repair=json.loads((root/'aptitude-official-repair-audit.json').read_text())
    if repair['status']!='verified':raise ValueError('Official base is not verified')
    basehash=hashlib.sha256(base.read_bytes()).hexdigest()
    if target.exists():
        data=json.loads(target.read_text());proof=json.loads(auditpath.read_text())
        if proof['cohort']!=COHORT or proof['base_snapshot_sha256']!=basehash or proof['snapshot_sha256']!=hashlib.sha256(target.read_bytes()).hexdigest():raise ValueError('Prospective provenance mismatch')
        days=proof['appended_days']
    else:
        data=json.loads(base.read_text());days=[]
        if data['starts']!=repair['total_starts'] or data['through']!=repair['through']:raise ValueError('Base count/date mismatch')
        proof={'cohort':COHORT,'base_snapshot_sha256':basehash,'base_through':data['through'],'base_starts':data['starts'],'base_repair_audit_sha256':hashlib.sha256((root/'aptitude-official-repair-audit.json').read_bytes()).hexdigest()}
    if data['history_end']>end:raise ValueError('Future history in prospective snapshot')
    changed=not target.exists()
    for date in iter(lambda:next_day(data['through']),None):
        if date>end:break
        bt,bsha=archive(date,'B',cache);kt,ksha=archive(date,'K',cache)
        entry,rows,excluded=append_day(data,date,bt,kt);entry['source_sha256']={'B':bsha,'K':ksha};days.append(entry);data['recovery']['days'].append(entry);changed=True
        raw=root/'aptitude-prospective-source'/f'{date}.json.gz';raw.parent.mkdir(parents=True,exist_ok=True)
        raw.write_bytes(gzip.compress(json.dumps({'date':date,'source_sha256':entry['source_sha256'],'starts':list(rows.values()),'nonstarts':excluded},ensure_ascii=False).encode(),mtime=0))
    if changed:
        data['updated_at']=datetime.now(ZoneInfo('UTC')).isoformat();data['prospective_cohort']=COHORT
        atomic(target,json.dumps(data,ensure_ascii=False,separators=(',',':'))+'\n')
        proof.update({'status':'verified','through':data['through'],'starts':data['starts'],'racers':data['racers_count'],'appended_days':days,'snapshot_sha256':hashlib.sha256(target.read_bytes()).hexdigest(),'production_changed':False})
        atomic(auditpath,json.dumps(proof,ensure_ascii=False,indent=2)+'\n')
    if data['history_end']!=end or data['starts']!=proof['base_starts']+sum(d['starts'] for d in days):raise ValueError('Stale history / ledger count mismatch')
    print({'cohort':COHORT,'through':data['through'],'starts':data['starts'],'appended_days':len(days),'fresh_through_yesterday':True},flush=True)
if __name__=='__main__':main()
