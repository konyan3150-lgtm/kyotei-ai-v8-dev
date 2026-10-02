"""Build a separate DEV aptitude snapshot from official B/K, retaining raw records."""
import csv,gzip,hashlib,json,math,re,sys,urllib.request
from collections import Counter
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime,timezone
from pathlib import Path
from audit_official_aptitude import archive,fetch,parse_official,BLOCK,HEADER,RAW_RESULT,VENUES,number

BASE='f9934034bfcb651b226a160e01bbd813ca7b1e0d'
# L . / F . are two-token timings, unlike regular 0.12 / F0.02.
ROW=re.compile(r'^\s*([A-Z0-9]{1,2})\s+([1-6])\s+(\d{4})\s+(.+?)\s+(\d{1,3})\s+(\d{1,3})\s+(\d\.\d{2}|\.{1,2})\s+([1-6])\s+(.+?)\s{2,}')
def timing(value,status):
    raw=value.strip();compact=re.sub(r'\s+','',raw)
    numeric=None
    try:numeric=float(compact[1:] if compact.startswith(('F','L')) else compact)
    except ValueError:
        if compact not in ('.','..','...','....','F.','L.'):raise ValueError('Unknown ST '+repr(raw))
    if numeric is not None and compact.startswith('F'):numeric=-numeric
    if numeric is not None and (not math.isfinite(numeric) or abs(numeric)>2):raise ValueError('ST out of range')
    # Late-start values retain their official numeric representation, but are
    # excluded from ordinary ST features. No assumption that 1.99 is measured ST.
    late=status.startswith('L') or compact.startswith('L')
    return {'raw_st':raw,'official_numeric_st':numeric,'st':None if late else numeric,'st_quality':'late_start_excluded' if late else 'missing' if numeric is None else 'observed'}

def official_rows(text):
    sid=rn=None;rows={};withdrawals=[];raw_count=0
    for line in text.splitlines():
        b=BLOCK.match(line.strip())
        if b:sid,rn=int(b[1]),None;continue
        h=HEADER.match(line)
        if h:
            if re.search(r'H\d+m',line):rn=int(h[1])
            continue
        if sid is None or rn is None:continue
        m=RAW_RESULT.match(line)
        if not m:continue
        raw_count+=1;key=(sid,rn,int(m[2]));d=ROW.match(line)
        if not d:
            if m[1] in ('K0','K1'):
                withdrawals.append({'key':key,'id':int(m[3]),'status':m[1]});continue
            raise ValueError('Unparsed actual/result row: '+repr(line))
        if key in rows:raise ValueError('Duplicate official start '+str(key))
        rank=int(d[1]) if d[1].isdigit() else None
        rows[key]={'stadium':sid,'venue':VENUES[sid-1],'race':rn,'lane':int(d[2]),'racer_id':int(d[3]),'course':int(d[8]),'finish':rank if rank is not None and 1<=rank<=6 else None,'finish_status':d[1],**timing(d[9],d[1])}
    return rows,withdrawals,raw_count

def blank():return [0]*9
def accumulate(data,row):
    rid=str(row['racer_id']);c=str(row['course']);v=row['venue'];r=data['racers'].setdefault(rid,{'o':blank(),'c':{},'v':{},'x':{}})
    arrays=[r['o'],r['c'].setdefault(c,blank()),r['v'].setdefault(v,blank()),r['x'].setdefault(v+':'+c,blank()),data['global_course'].setdefault(c,blank())]
    for a in arrays:
        a[0]+=1;f=row['finish'];st=row['st']
        if f is not None:a[1]+=1;a[2]+=int(f==1);a[3]+=int(f<=2);a[4]+=int(f<=3);a[5]+=f
        if st is not None:a[6]+=1;a[7]+=st;a[8]+=st*st

def api_rows(payload):
    out={}
    for race in payload['results']:
        for b in race['boats']:
            c=number(b.get('racer_course_number'))
            if c is None or c==0:continue
            key=(int(race['stadium_number']),int(race['number']),int(b['racer_boat_number']))
            if key in out:raise ValueError('Duplicate API start')
            out[key]=b
    return out

def verify_csv(path,expected,late_count):
    seen=set();n=late=0
    with gzip.open(path,'rt',encoding='utf-8',newline='') as f:
        for r in csv.DictReader(f):
            key=(r['date'],r['stadium'],r['race'],r['lane'])
            if key in seen:raise ValueError('Duplicate serialized start')
            seen.add(key);n+=1
            if r['st_quality']=='late_start_excluded':
                late+=1
                if r['st']!='':raise ValueError('Late timing entered ordinary ST')
            if not 1<=int(r['course'])<=6 or not 1000<=int(r['racer_id'])<=9999:raise ValueError('Invalid serialized identity/course')
    if n!=expected or late!=late_count:raise ValueError('Serialized coverage mismatch')
    return n

def main():
    root=Path('dev');cache=Path('/tmp/official-aptitude-cache')
    old_audit=json.loads((root/'aptitude-official-audit.json').read_text())
    if old_audit['audited_days']!=429 or old_audit['source_failures']:raise ValueError('Prior audit coverage incomplete')
    def preload(prior):
        day=prior['date']
        for kind in ('B','K'):
            name=f'{kind.lower()}{day[2:]}.lzh'
            fetch(f'https://www1.mbrace.or.jp/od2/{kind}/{day[:6]}/{name}',cache/kind/day[:6]/name)
        fetch(f'https://boatraceopenapi.github.io/results/v3/{day[:4]}/{day}.json',cache/'API'/f'{day}.json')
    with ThreadPoolExecutor(max_workers=8) as pool:list(pool.map(preload,old_audit['days']))
    baseline_path=cache/'baseline.json'
    if not baseline_path.exists():
        with urllib.request.urlopen(f'https://raw.githubusercontent.com/konyan3150-lgtm/kyotei-ai-v8-live/{BASE}/racer-aptitude.json',timeout=35) as r:baseline_path.write_bytes(r.read())
    data=json.loads(baseline_path.read_text());base_starts=data['starts']
    if base_starts!=1435463 or data['through']!='2025-07-29':raise ValueError('Wrong baseline')
    totals=Counter();days=[];examples=[];late=0
    output=root/'racer-starts-official.csv.gz';temp=output.with_suffix('.tmp')
    fields=['date','stadium','venue','race','lane','racer_id','course','finish','finish_status','st','raw_st','official_numeric_st','st_quality']
    with gzip.open(temp,'wt',encoding='utf-8',newline='') as handle:
        writer=csv.DictWriter(handle,fieldnames=fields);writer.writeheader()
        for prior in old_audit['days']:
            day=prior['date'];btext,bsha=archive(day,'B',cache);ktext,ksha=archive(day,'K',cache)
            if {'B':bsha,'K':ksha}!=prior['official_sha256']:raise ValueError('Official source changed '+day)
            _,program=parse_official(btext,'B');official,withdrawals,raw_count=official_rows(ktext)
            payload=json.loads((cache/'API'/f'{day}.json').read_text());api=api_rows(payload)
            if set(api)-set(official):raise ValueError('API start still lacks official parsing '+day)
            missing=set(official)-set(api)
            for key,row in sorted(official.items()):
                if program.get(key)!=row['racer_id']:raise ValueError('Official program/result ID mismatch '+day+str(key))
                if key in api:
                    b=api[key];rank=number(b.get('racer_place_number'));finish=int(rank) if rank is not None and 1<=rank<=6 else None
                    if int(b['racer_number'])!=row['racer_id'] or int(b['racer_course_number'])!=row['course']:raise ValueError('ID/course mismatch '+day)
                    if finish!=row['finish']:raise ValueError('Normal finish mismatch '+day+str(key))
                    ast=number(b.get('racer_start_timing'))
                    same=ast is None and row['st'] is None or ast is not None and row['st'] is not None and abs(ast-row['st'])<1e-8
                    if not same:raise ValueError('Ordinary ST mismatch '+day+str(key))
                else:
                    if len(examples)<20:examples.append({'date':day,**row})
                accumulate(data,row);writer.writerow({'date':day,**row});late+=int(row['st_quality']=='late_start_excluded')
            if raw_count!=len(official)+len(withdrawals):raise ValueError('Raw row accounting mismatch')
            entry={'date':day,'starts':len(official),'races':len({k[:2] for k in official}),'api_starts':len(api),'recovered_missing_starts':len(missing),'withdrawals_excluded':len(withdrawals),'source_sha256':{'B':bsha,'K':ksha}}
            days.append(entry);totals.update({k:entry[k] for k in ['starts','races','api_starts','recovered_missing_starts','withdrawals_excluded']})
            if len(days)%60==0:print({'verified_days':len(days),'official_starts':totals['starts'],'added_missing':totals['recovered_missing_starts']},flush=True)
    verify_csv(temp,totals['starts'],late);temp.replace(output)
    data['starts']=base_starts+totals['starts'];data['racers_count']=len(data['racers']);end=days[-1]['date'];data['through']=f'{end[:4]}-{end[4:6]}-{end[6:]}';data['history_end']=end
    data['updated_at']=datetime.now(timezone.utc).isoformat();data['recovery']={'baseline_commit':BASE,'baseline_starts':base_starts,'baseline_through':'2025-07-29','days':days,'source':'BOAT RACE official daily B/K','production_promoted':False,'st_policy':'L-coded values retained raw and excluded from ordinary ST aggregates; F timings retain signed values'}
    target=root/'racer-aptitude-official.json';target.write_text(json.dumps(data,ensure_ascii=False,separators=(',',':'))+'\n')
    audit={'status':'verified','verified_days':len(days),'baseline_starts':base_starts,'total_starts':data['starts'],'through':data['through'],'racers':data['racers_count'],'counts':dict(totals),'missing_official_sources':0,'registration_or_course_mismatches':0,'normal_finish_or_st_mismatches':0,'late_start_records_retained':late,'normalized_rows_sha256':hashlib.sha256(output.read_bytes()).hexdigest(),'recovered_examples':examples,'source':'official B/K with source hashes checked against prior audit','production_changed':False,'limitations':['Late-start raw timings are retained separately rather than treated as ordinary ST.','Baseline historical aggregates remain the fixed pre-backfill baseline.','This establishes recovered-period data integrity, not predictive improvement.']}
    (root/'aptitude-official-repair-audit.json').write_text(json.dumps(audit,ensure_ascii=False,indent=2)+'\n');print(json.dumps({k:v for k,v in audit.items() if k!='recovered_examples'},ensure_ascii=False))

if __name__=='__main__':main()
