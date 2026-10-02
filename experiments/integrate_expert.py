"""Build a shadow dataset with pre-close features separated from outcomes."""
import argparse
from collections import Counter
from datetime import datetime, timezone, timedelta
import json
from pathlib import Path

JST = timezone(timedelta(hours=9))

def instant(value, local=False):
    try:
        dt = datetime.fromisoformat(str(value).replace('Z', '+00:00'))
        return dt.replace(tzinfo=JST) if local and dt.tzinfo is None else dt
    except (ValueError, TypeError):
        return None

def key(rec):
    return f"{rec['date']}_{int(rec['stadium']):02d}_{int(rec['race']):02d}"

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--expert-root', required=True)
    ap.add_argument('--server-root', required=True)
    ap.add_argument('--out', required=True)
    args = ap.parse_args()
    expert_root, server_root, out = map(Path, [args.expert_root, args.server_root, args.out])
    out.mkdir(parents=True, exist_ok=True)
    server, expert, context = {}, {}, {}
    counts = Counter()
    for p in [*sorted((server_root/'dev/server-predictions-archive').glob('*.json')), server_root/'dev/server-predictions.json']:
        for r in json.loads(p.read_text()).get('records', {}).values():
            k = key(r)
            if k in server:
                counts['server_duplicates'] += 1
                assert not (server[k].get('result') and r.get('result') and server[k]['result'] != r['result']), k
            server[k] = r
    for p in sorted((expert_root/'dev/expert-v2-archive').glob('*.json')):
        for r in json.loads(p.read_text()).get('records', {}).values():
            k = key(r)
            assert k not in expert, f'duplicate Expert {k}'
            expert[k] = r
    for p in sorted((expert_root/'dev/meeting-context-archive').glob('*.json')):
        d = json.loads(p.read_text())
        for r in d.get('latest', {}).values():
            context[key(r)] = r
    rows = []
    for k, e in sorted(expert.items()):
        saved, close = instant(e.get('saved_at')), instant(e.get('closed_at'), local=True)
        valid = bool(e.get('version') == 2 and not e.get('reconstructed') and e.get('captured_before_close') and saved and saved.tzinfo and close and saved < close)
        if not valid:
            counts['invalid_expert'] += 1
            continue
        counts['valid_preclose'] += 1
        s, outcome = server.get(k), e.get('outcome')
        counts['matched_server' if s else 'missing_server'] += 1
        if outcome:
            counts['settled'] += 1
            if s and s.get('result'):
                assert outcome['result'] == s['result'], f'result mismatch {k}'
                counts['result_matches'] += 1
        else:
            counts['pending'] += 1
        feature = {f:e.get(f) for f in ['version','policy','active','weights','scores','signals','saved_at','closed_at']}
        c = context.get(k)
        observed = instant(c.get('observed_at')) if c else None
        if observed and observed.tzinfo and observed < close:
            feature['meeting_context'] = {f:v for f,v in c.items() if f not in ['result','payout','settled','outcome']}
            counts['context_preclose'] += 1
        items = {}
        if s and not s.get('cancelled'):
            odds_time, value_time = instant(s.get('odds_snapshot_at')), instant(s.get('value_saved_at'))
            if odds_time and value_time and odds_time.tzinfo and value_time.tzinfo and odds_time < close and value_time < close:
                for mode, m in s.get('value_modes', {}).items():
                    tickets = [{f:t.get(f) for f in ['combo','prob','odds','stake']} for t in m.get('items', [])]
                    if tickets:
                        items[mode] = tickets
                if items:
                    counts['preclose_probability_odds_races'] += 1
            elif s.get('value_modes'):
                counts['excluded_probability_odds_timestamp'] += 1
        rows.append({'race_key':k, 'features':feature, 'preclose_value_tickets':items,
                     'labels':{'expert_outcome':outcome, 'server_result':s.get('result') if s else None,
                               'server_settled':s.get('settled') if s else None, 'cancelled':s.get('cancelled',False) if s else None},
                     'expert_used_in_prediction':e.get('used_in_prediction',False)})
    report = {'expert_records':len(expert), 'server_unique_races':len(server), **dict(counts),
              'source_expert_root':str(expert_root), 'source_server_root':str(server_root),
              'limitations':['Selected ticket probabilities are not a complete 120-combination distribution.',
                             'Expert classes were not used to generate baseline bets; grouped ROI does not demonstrate Expert improvement.',
                             'Only two dates of Expert data; no reliable chronological promotion decision yet.']}
    (out/'expert_joined.jsonl').write_text(''.join(json.dumps(r,ensure_ascii=False)+'\n' for r in rows))
    (out/'integration_audit.json').write_text(json.dumps(report,ensure_ascii=False,indent=2))
    print(json.dumps(report,ensure_ascii=False,indent=2))

if __name__ == '__main__':
    main()
