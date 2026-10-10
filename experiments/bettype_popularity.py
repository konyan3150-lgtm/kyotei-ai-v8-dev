"""Long-run favourite/longshot check for every popularity-ranked bet type in official K files.

Extends trifecta_popularity.py to 3連単/3連複/2連単/2連複 using the same cached K files.
Buying "the N-th favourite of a bet type every race" returns
sum(payout where winner popularity == N) / (races * 100).
Final popularity is post-close: market-bias research only, never a prediction feature.
Writes only dev/bettype-popularity/. Production and saved history are untouched.

Usage: python experiments/bettype_popularity.py --start 20210401 --end 20260930
"""
import argparse, hashlib, json, re, time
from collections import defaultdict
from datetime import datetime, timezone
from pathlib import Path
from audit_official_aptitude import archive, BLOCK, HEADER
from trifecta_popularity import days

TYPES = {  # label in K file -> (key, combinations, ordered)
    '３連単': ('trifecta', 120, True), '３連複': ('trio', 20, False),
    '２連単': ('exacta', 30, True), '２連複': ('quinella', 15, False),
}
LINE = re.compile(r'^\s*(３連単|３連複|２連単|２連複)\s+(\S+)\s+(\d+)\s+人気\s+(\d+)')
BANDS = [(1, 1), (2, 3), (4, 6), (7, 10), (11, 20), (21, 40), (41, 80), (81, 120)]


def valid_combo(combo, key):
    parts = combo.split('-')
    size = 3 if key in ('trifecta', 'trio') else 2
    return len(parts) == size and all(p in '123456' and len(p) == 1 for p in parts) and len(set(parts)) == size


def parse_k(text):
    """Return ({(stadium, race): {key: [(combo, amount, pop), ...]}}, set of (stadium, race))."""
    sid = rn = None; out = defaultdict(lambda: defaultdict(list)); seen = set()
    for line in text.splitlines():
        b = BLOCK.match(line.strip())
        if b: sid, rn = int(b[1]), None; continue
        h = HEADER.match(line)
        if h:
            if re.search(r'H\d+m', line):
                rn = int(h[1].translate(str.maketrans('０１２３４５６７８９', '0123456789'))); seen.add((sid, rn))
            continue
        m = LINE.match(line)
        if m and sid is not None and rn is not None:
            out[(sid, rn)][TYPES[m[1]][0]].append((m[2], int(m[3]), int(m[4])))
    return out, seen


def race_rows(day, text):
    """{key: rows}; a race counts for a bet type only with exactly one valid winning line of that type."""
    parsed, seen = parse_k(text); rows = defaultdict(list); excluded = defaultdict(int)
    for race in sorted(seen):
        for label, (key, n, _) in TYPES.items():
            p = parsed.get(race, {}).get(key, [])
            if len(p) != 1 or not valid_combo(p[0][0], key) or p[0][1] < 100 or not 1 <= p[0][2] <= n:
                excluded[key] += 1; continue
            rows[key].append({'date': day, 'stadium': race[0], 'race': race[1], 'combo': p[0][0], 'amount': p[0][1], 'popularity': p[0][2]})
    return rows, excluded


def summarize(rows, n_combos):
    def block(rs):
        n = len(rs); by = defaultdict(lambda: [0, 0])
        for r in rs: x = by[r['popularity']]; x[0] += 1; x[1] += r['amount']
        bands = []
        for lo, hi in BANDS:
            if lo > n_combos: break
            hi = min(hi, n_combos); k = hi - lo + 1
            hits = sum(by[p][0] for p in range(lo, hi + 1)); pay = sum(by[p][1] for p in range(lo, hi + 1))
            bands.append({'ranks': f'{lo}-{hi}', 'hit_rate_per_race': hits / n if n else None, 'roi': pay / (n * k * 100) if n else None})
        ranks = [{'rank': p, 'hits': by[p][0], 'roi': by[p][1] / (n * 100) if n else None} for p in range(1, min(20, n_combos) + 1)]
        return {'races': n, 'bands': bands, 'top_ranks': ranks}
    by_year, by_venue = defaultdict(list), defaultdict(list)
    for r in rows: by_year[r['date'][:4]].append(r); by_venue[str(r['stadium'])].append(r)
    return {'overall': block(rows), 'by_year': {y: block(v) for y, v in sorted(by_year.items())},
            'by_venue': {v: block(x) for v, x in sorted(by_venue.items(), key=lambda kv: int(kv[0]))}}


def main():
    p = argparse.ArgumentParser()
    p.add_argument('--start', default='20210401'); p.add_argument('--end', default='20260930')
    p.add_argument('--out-dir', default='dev/bettype-popularity'); p.add_argument('--cache', default='/tmp/official-aptitude-cache')
    p.add_argument('--pause', type=float, default=0.5)
    a = p.parse_args(); out = Path(a.out_dir); out.mkdir(parents=True, exist_ok=True); cache = Path(a.cache)
    rows, excluded, failures, sources = defaultdict(list), defaultdict(int), [], {}
    started = time.time(); all_days = list(days(a.start, a.end))
    for i, day in enumerate(all_days, 1):
        if i % 30 == 0 or i == len(all_days):
            print(f'progress {i}/{len(all_days)} days, {len(rows["trifecta"])} races, {len(failures)} source failures, {time.time()-started:.0f}s', flush=True)
        cached = (cache / 'K' / day[:6] / f'k{day[2:]}.lzh').exists()
        try:
            text, sha = archive(day, 'K', cache)
        except Exception as e:
            failures.append({'date': day, 'reason': type(e).__name__ + ': ' + str(e)[:120]}); continue
        finally:
            if not cached: time.sleep(a.pause)
        r, x = race_rows(day, text); sources[day] = sha
        for k, v in r.items(): rows[k] += v
        for k, v in x.items(): excluded[k] += v
    report = {'policy': 'bettype-popularity-v1', 'generated_at': datetime.now(timezone.utc).isoformat(), 'start': a.start, 'end': a.end,
              'days_with_source': len(sources), 'source_failures': len(failures), 'failure_samples': failures[:30],
              'sources_sha256': hashlib.sha256(json.dumps(sources, sort_keys=True).encode()).hexdigest(),
              'interpretation': 'Final popularity ranks from official K files per bet type. Market-bias research only; '
                                'popularity is post-close and must never be a prediction feature.',
              'types': {key: {'combinations': n, 'races': len(rows[key]), 'excluded_races': excluded[key], **summarize(rows[key], n)}
                        for key, n, _ in TYPES.values()}}
    (out / 'summary.json').write_text(json.dumps(report, ensure_ascii=False, indent=1) + '\n')
    for key, t in report['types'].items():
        print(key, t['races'], t['excluded_races'], [(b['ranks'], round(b['roi'] * 100, 1)) for b in t['overall']['bands']])


if __name__ == '__main__':
    main()
