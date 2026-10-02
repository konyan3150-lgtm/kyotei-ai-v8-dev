"""Use only official pre-race B fields and independently checked K settlement."""
import gzip,hashlib,json,re
from pathlib import Path
from audit_official_aptitude import archive,BLOCK,HEADER,PROGRAM
from repair_official_aptitude import official_rows

FIELDS=['national_win_rate','national_top_2_percent','local_win_rate','local_top_2_percent','motor_number','motor_top_2_percent','boat_number','boat_top_2_percent']
MISSING=['average_start_timing','flying_count','late_count','motor_top_3_percent','boat_top_3_percent']

def programs(text):
    sid=rn=None;out={}
    for line in text.splitlines():
        b=BLOCK.match(line.strip())
        if b:sid,rn=int(b[1]),None;continue
        h=HEADER.match(line)
        if h:rn=int(h[1]);continue
        m=PROGRAM.match(line)
        if not m or sid is None or rn is None:continue
        metrics=re.match(r'(\d{1,2}\.\d{2})\s*(\d{1,3}\.\d{2})\s*(\d{1,2}\.\d{2})\s*(\d{1,3}\.\d{2})\s*(\d{1,3})\s*(\d{1,3}\.\d{2})\s*(\d{1,3})\s*(\d{1,3}\.\d{2})',line[m.end():])
        if not metrics:raise ValueError('Incomplete official program metrics: '+repr(line))
        parts=metrics.groups()
        x={'number':int(m[2]),'age':int(m[4]),'weight':int(m[6]),'rank_number':m[7]}
        x.update({k:float(v) for k,v in zip(FIELDS,parts[:8])})
        key=(sid,rn);r=out.setdefault(key,{'racers':{}});lane=m[1]
        if lane in r['racers']:raise ValueError('Duplicate program lane')
        r['racers'][lane]=x
    return out

def payouts(text):
    sid=rn=None;out={}
    for line in text.splitlines():
        b=BLOCK.match(line.strip())
        if b:sid,rn=int(b[1]),None;continue
        h=HEADER.match(line)
        if h and re.search(r'H\d+m',line):rn=int(h[1]);continue
        m=re.match(r'^\s*３連単\s+([1-6]-[1-6]-[1-6])\s+(\d+)\s',line)
        if m and sid is not None and rn is not None:
            out.setdefault((sid,rn),[]).append({'combination':m[1],'amount':int(m[2])})
    return out

def main():
    root=Path('dev');cache=Path('/tmp/official-aptitude-cache')
    audit=json.loads((root/'aptitude-official-audit.json').read_text())
    repair=json.loads((root/'aptitude-official-repair-audit.json').read_text())
    source=root/'racer-starts-official.csv.gz'
    if repair['status']!='verified' or hashlib.sha256(source.read_bytes()).hexdigest()!=repair['normalized_rows_sha256']:raise ValueError('Unverified repaired input')
    total=0;out=Path('/tmp/official-comparison-days.jsonl')
    with out.open('w') as f:
        for prior in audit['days']:
            day=prior['date'];bt,bsha=archive(day,'B',cache);kt,ksha=archive(day,'K',cache)
            if {'B':bsha,'K':ksha}!=prior['official_sha256']:raise ValueError('Official source hash changed')
            pr=programs(bt);rows,excluded,raw=official_rows(kt);pay=payouts(kt);races={}
            for (sid,rn,lane),r in rows.items():
                if pr.get((sid,rn),{}).get('racers',{}).get(str(lane),{}).get('number')!=r['racer_id']:raise ValueError('Program/result identity mismatch')
                races.setdefault((sid,rn),[]).append({'racer_number':r['racer_id'],'racer_boat_number':lane,'racer_course_number':r['course'],'racer_place_number':r['finish'],'racer_start_timing':r['st']})
            results=[{'stadium_number':sid,'number':rn,'date':day,'boats':boats,'payouts':{'trifecta':pay.get((sid,rn),[])}} for (sid,rn),boats in sorted(races.items())]
            total+=len(rows)
            f.write(json.dumps({'date':day,'programs':[{'stadium':s,'race':n,**p} for (s,n),p in sorted(pr.items())],'results':results,'official_sha256':{'B':bsha,'K':ksha}},ensure_ascii=False)+'\n')
    if total!=repair['counts']['starts']:raise ValueError('Repaired start coverage mismatch')
    print({'prepared_days':len(audit['days']),'starts':total,'missing_program_fields':MISSING},flush=True)
if __name__=='__main__':main()
