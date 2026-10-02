"""Read-only comparison of recovered OpenAPI starts with official B/K files."""
import argparse
import hashlib
import json
import re
import time
import urllib.request
from collections import Counter
from concurrent.futures import ThreadPoolExecutor
from datetime import date, timedelta, datetime, timezone
from pathlib import Path
import lhafile

VENUES = ['桐生','戸田','江戸川','平和島','多摩川','浜名湖','蒲郡','常滑','津','三国','びわこ','住之江','尼崎','鳴門','丸亀','児島','宮島','徳山','下関','若松','芦屋','福岡','唐津','大村']
BLOCK = re.compile(r'^(\d{2})[BK]BGN$')
HEADER = re.compile(r'^\s*([0-9０-９]{1,2})[RＲ]\s')
RAW_RESULT = re.compile(r'^\s*([A-Z0-9]{1,2})\s+([1-6])\s+(\d{4})\s+')
DETAIL = re.compile(r'^\s*(\S{1,2})\s+([1-6])\s+(\d{4})\s+(.+?)\s+(\d{1,3})\s+(\d{1,3})\s+(\d\.\d{2}|\.{1,2})\s+([1-6])\s+([FL]?\d?\.\d{2}|\.{1,2})\s+')
PROGRAM = re.compile(r'^([1-6])\s+(\d{4})(.+?)(\d{2})(群馬|埼玉|東京|静岡|愛知|三重|福井|滋賀|大阪|兵庫|徳島|香川|岡山|広島|山口|福岡|佐賀|長崎)(\d{2})(A1|A2|B1|B2)\s')

def number(v):
    if v is None or str(v).strip() == '': return None
    return float(v)

def parse_official(text, kind):
    raw, parsed = {}, {}
    sid = rn = None
    for line in text.splitlines():
        block = BLOCK.match(line.strip())
        if block: sid, rn = int(block[1]), None; continue
        header = HEADER.match(line)
        if header:
            # Ignore the payout summary: official result headers contain H1800m etc.
            if kind == 'B' or re.search(r'H\d+m', line): rn = int(header[1])
            continue
        if sid is None or rn is None: continue
        if kind == 'B':
            m = PROGRAM.match(line)
            if m:
                key = (sid, rn, int(m[1]))
                if key in parsed: raise ValueError('Duplicate official program row')
                parsed[key] = int(m[2])
            continue
        m = RAW_RESULT.match(line)
        if not m: continue
        key = (sid, rn, int(m[2]))
        if key in raw: raise ValueError('Duplicate official result row')
        raw[key] = {'id': int(m[3]), 'status': m[1]}
        detail = DETAIL.match(line)
        if not detail: continue
        st = detail[9].strip()
        if st in ('.', '..'): st = None
        else: st = float(st[1:]) * (-1 if st.startswith('F') else 1) if st.startswith(('F','L')) else float(st)
        parsed[key] = {'id': int(detail[3]), 'course': int(detail[8]), 'finish': int(detail[1]) if detail[1].isdigit() else None, 'status': detail[1], 'st': st}
    return raw, parsed

def fetch(url, cache):
    cache.parent.mkdir(parents=True, exist_ok=True)
    if cache.exists(): return cache.read_bytes()
    for attempt in range(3):
        try:
            req = urllib.request.Request(url, headers={'User-Agent':'V8-DEV-official-audit/1.0'})
            with urllib.request.urlopen(req, timeout=35) as response: data = response.read()
            cache.write_bytes(data); return data
        except Exception:
            if attempt == 2: raise
            time.sleep(attempt+1)

def archive(day, kind, cache):
    filename = f'{kind.lower()}{day[2:]}.lzh'
    p = cache/kind/day[:6]/filename
    data = fetch(f'https://www1.mbrace.or.jp/od2/{kind}/{day[:6]}/{filename}', p)
    lha = lhafile.Lhafile(str(p))
    if len(lha.namelist()) != 1: raise ValueError('Unexpected archive members')
    return lha.read(lha.namelist()[0]).decode('cp932', errors='strict'), hashlib.sha256(data).hexdigest()

def compare_day(day, payload, btext, ktext):
    _, program = parse_official(btext, 'B')
    raw, official = parse_official(ktext, 'K')
    counts = Counter({'api_starts':0,'compared_starts':0,'finish_agreements':0,'st_agreements':0}); errors = []; code_pairs = Counter(); api = {}
    def error(kind, key, expected=None, actual=None):
        counts[kind] += 1
        if len(errors) < 20: errors.append({'kind':kind,'key':list(key),'official':expected,'api':actual})
    for race in payload['results']:
        if race['date'].replace('-','') != day: raise ValueError('Wrong API date')
        for boat in race['boats']:
            course = number(boat.get('racer_course_number'))
            if course is None or course == 0: continue
            key = (int(race['stadium_number']),int(race['number']),int(boat['racer_boat_number']))
            if key in api: raise ValueError('Duplicate API lane')
            api[key] = boat
    for key in official.keys()-api.keys(): error('missing_api_start', key, official[key], None)
    for key, boat in api.items():
        counts['api_starts'] += 1
        oid = int(boat['racer_number']); o = official.get(key)
        if key not in program: error('missing_program_row', key)
        elif program[key] != oid: error('program_id_mismatch', key, program[key], oid)
        if not o:
            error('missing_or_unparsed_official_start', key, raw.get(key), boat); continue
        counts['compared_starts'] += 1
        for field, actual in [('id',oid),('course',int(boat['racer_course_number']))]:
            if o[field] != actual: error(field+'_mismatch', key, o[field], actual)
        place = number(boat.get('racer_place_number'))
        finish = int(place) if place is not None and 1 <= place <= 6 else None
        if finish != o['finish']: error('finish_mismatch', key, o['finish'], finish)
        else: counts['finish_agreements'] += 1
        if finish is None: code_pairs[(o['status'],str(boat.get('racer_place_number')))] += 1
        ast = number(boat.get('racer_start_timing'))
        same = o['st'] is None and ast is None or o['st'] is not None and ast is not None and abs(o['st']-ast)<1e-8
        if not same: error('st_mismatch', key, o['st'], ast)
        else: counts['st_agreements'] += 1
    counts['official_starts'] = len(official)
    counts['official_raw_rows'] = len(raw)
    counts['api_races_with_starts'] = len({k[:2] for k in api})
    counts['official_races_with_starts'] = len({k[:2] for k in official})
    counts['official_rows_without_parsed_course'] = len(raw.keys()-official.keys())
    return {'date':day,'counts':dict(counts),'errors':errors,'nonstandard_code_pairs':{'|'.join(k):v for k,v in code_pairs.items()}}

def audit_day(day, cache):
    btext, bsha = archive(day,'B',cache)
    ktext, ksha = archive(day,'K',cache)
    payload = json.loads(fetch(f'https://boatraceopenapi.github.io/results/v3/{day[:4]}/{day}.json', cache/'API'/f'{day}.json'))
    out = compare_day(day,payload,btext,ktext)
    out['official_sha256'] = {'B':bsha,'K':ksha}
    return out

def main():
    p=argparse.ArgumentParser();p.add_argument('--start',default='20250730');p.add_argument('--end',default='20261001');p.add_argument('--output',default='dev/aptitude-official-audit.json');p.add_argument('--cache',default='/tmp/official-aptitude-cache');p.add_argument('--workers',type=int,default=8);args=p.parse_args()
    first,last=date.fromisoformat(f'{args.start[:4]}-{args.start[4:6]}-{args.start[6:]}'),date.fromisoformat(f'{args.end[:4]}-{args.end[4:6]}-{args.end[6:]}')
    days=[(first+timedelta(days=i)).strftime('%Y%m%d') for i in range((last-first).days+1)]
    reports=[]; failures=[]
    progress=Path(args.output.replace('.json','-progress.json'))
    fingerprint=hashlib.sha256(Path(__file__).read_bytes()).hexdigest()
    prior=json.loads(progress.read_text()) if progress.exists() else {}
    completed={r['date']:r for r in prior.get('days',[])} if prior.get('script_sha256')==fingerprint else {}
    def run(d):
        if d in completed:return completed[d]
        try: return audit_day(d,Path(args.cache))
        except Exception as e: return {'date':d,'source_error':str(e)}
    with ThreadPoolExecutor(max_workers=max(1,min(8,args.workers))) as pool:
        for i,r in enumerate(pool.map(run,days)):
            (failures if 'source_error' in r else reports).append(r)
            progress.parent.mkdir(parents=True,exist_ok=True)
            temp=progress.with_suffix('.tmp')
            temp.write_text(json.dumps({'status':'in_progress','script_sha256':fingerprint,'completed_days':len(reports),'days':reports,'source_failures':failures},ensure_ascii=False))
            temp.replace(progress)
            if i%30==0: print(f'checked {i+1}/{len(days)} days; unavailable={len(failures)}',flush=True)
    totals=Counter(); pairs=Counter()
    for r in reports: totals.update(r['counts']);pairs.update(r['nonstandard_code_pairs'])
    mismatch_keys=[k for k in totals if k.endswith('_mismatch') or k.startswith('missing_')]
    mismatches=sum(totals[k] for k in mismatch_keys)
    ledger=json.loads(Path('dev/racer-aptitude-clean.json').read_text())['recovery']['days'] if Path('dev/racer-aptitude-clean.json').exists() else []
    ledger_map={r['date']:r for r in ledger}
    ledger_errors=[r['date'] for r in reports if ledger and ledger_map.get(r['date'],{}).get('starts') != r['counts'].get('api_starts',0)]
    out={'status':'passed' if not failures and not mismatches and not ledger_errors else 'needs_review','start':args.start,'end':args.end,'requested_days':len(days),'audited_days':len(reports),'source_failures':failures,'counts':dict(totals),'mismatches':mismatches,'ledger_start_count_mismatch_days':ledger_errors,'nonstandard_code_pairs':dict(pairs),'days':reports,'checked_at':datetime.now(timezone.utc).isoformat(),'production_changed':False,'limitations':['Compares actual starts with a valid course; non-starting withdrawals are excluded.','Normal ranks 1..6 are checked exactly; nonstandard finish codes are checked as non-completed and their official/API pairs are reported.','Source SHA256 hashes preserve provenance; this does not establish predictive improvement.']}
    target=Path(args.output);target.parent.mkdir(parents=True,exist_ok=True);target.write_text(json.dumps(out,ensure_ascii=False,indent=2)+'\n')
    saved=json.loads(progress.read_text());saved['status']='completed';saved['audit_status']=out['status'];progress.write_text(json.dumps(saved,ensure_ascii=False)+'\n')
    print(json.dumps({k:v for k,v in out.items() if k!='days'},ensure_ascii=False))

if __name__=='__main__': main()
