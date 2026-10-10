"""Long-run favourite/longshot check from official K files (read-only research).

For every race, the official K file lists the winning trifecta, its 100-yen payout and its
final popularity rank among the 120 combinations. Buying "the N-th favourite every race"
therefore returns sum(payout where winner popularity == N) / (races * 100).
This needs no odds for losing tickets, so years of history can be checked.

Final popularity is post-close information: use it only to measure market bias,
never as a prediction feature. Production, saved history and existing records are untouched.

Usage: python experiments/trifecta_popularity.py --start 20210401 --end 20260930
"""
import argparse, csv, gzip, hashlib, io, json, re, time
from collections import defaultdict
from datetime import date, timedelta, datetime, timezone
from pathlib import Path
from audit_official_aptitude import archive, BLOCK, HEADER

TRIFECTA = re.compile(r'^\s*３連単\s+(\S+)\s+(\d+)\s+人気\s+(\d+)')
COMBO = re.compile(r'^([1-6])-([1-6])-([1-6])$')
BANDS = [(1, 1), (2, 3), (4, 6), (7, 10), (11, 20), (21, 40), (41, 80), (81, 120)]


def parse_k(text):
    """Return ({(stadium, race): [(combo, amount, popularity), ...]}, set of all (stadium, race) seen)."""
    sid = rn = None; out = defaultdict(list); seen = set()
    for line in text.splitlines():
        b = BLOCK.match(line.strip())
        if b: sid, rn = int(b[1]), None; continue
        h = HEADER.match(line)
        if h:
            # Detailed race headers carry the distance (H1800m); the top summary block does not.
            if re.search(r'H\d+m', line):
                rn = int(h[1].translate(str.maketrans('０１２３４５６７８９', '0123456789'))); seen.add((sid, rn))
            continue
        m = TRIFECTA.match(line)
        if m and sid is not None and rn is not None:
            out[(sid, rn)].append((m[1], int(m[2]), int(m[3])))
    return dict(out), seen


def race_rows(day, text):
    """One row per race. Races without exactly one valid trifecta (refund, dead heat, special payout) are excluded."""
    payouts, seen = parse_k(text); rows = []; excluded = 0
    for key in sorted(seen):
        p = payouts.get(key, [])
        if len(p) != 1: excluded += 1; continue
        combo, amount, pop = p[0]; c = COMBO.match(combo)
        if not c or len(set(c.groups())) != 3 or amount < 100 or not 1 <= pop <= 120: excluded += 1; continue
        rows.append({'date': day, 'stadium': key[0], 'race': key[1], 'combo': combo, 'amount': amount, 'popularity': pop})
    return rows, excluded


def summarize(rows):
    def block(rs):
        n = len(rs); by_pop = defaultdict(lambda: [0, 0])
        for r in rs: x = by_pop[r['popularity']]; x[0] += 1; x[1] += r['amount']
        bands = []
        for lo, hi in BANDS:
            hits = sum(by_pop[p][0] for p in range(lo, hi + 1)); pay = sum(by_pop[p][1] for p in range(lo, hi + 1)); k = hi - lo + 1
            # Buying every rank in the band once per race (k tickets x 100 yen).
            bands.append({'ranks': f'{lo}-{hi}', 'tickets_per_race': k, 'hit_rate_per_race': hits / n if n else None,
                          'roi': pay / (n * k * 100) if n else None})
        ranks = [{'rank': p, 'hits': by_pop[p][0], 'roi': by_pop[p][1] / (n * 100) if n else None} for p in range(1, 21)]
        return {'races': n, 'bands': bands, 'top_ranks': ranks,
                'lane1_head_share': sum(r['combo'].startswith('1-') for r in rs) / n if n else None}
    by_year = defaultdict(list)
    for r in rows: by_year[r['date'][:4]].append(r)
    return {'overall': block(rows), 'by_year': {y: block(v) for y, v in sorted(by_year.items())}}


def days(start, end):
    d = date(int(start[:4]), int(start[4:6]), int(start[6:])); e = date(int(end[:4]), int(end[4:6]), int(end[6:]))
    while d <= e: yield d.strftime('%Y%m%d'); d += timedelta(days=1)


def main():
    p = argparse.ArgumentParser()
    p.add_argument('--start', default='20210401'); p.add_argument('--end', default='20260930')
    p.add_argument('--out-dir', default='dev/trifecta-popularity'); p.add_argument('--cache', default='/tmp/official-aptitude-cache')
    p.add_argument('--pause', type=float, default=0.5)
    a = p.parse_args(); out = Path(a.out_dir); out.mkdir(parents=True, exist_ok=True); cache = Path(a.cache)
    rows, excluded, failures, sources = [], 0, [], {}
    for day in days(a.start, a.end):
        cached = (cache / 'K' / day[:6] / f'k{day[2:]}.lzh').exists()
        try:
            text, sha = archive(day, 'K', cache)
        except Exception as e:  # no racing that day, or source unavailable: record, never guess
            failures.append({'date': day, 'reason': type(e).__name__ + ': ' + str(e)[:120]}); continue
        finally:
            if not cached: time.sleep(a.pause)
        r, x = race_rows(day, text); rows += r; excluded += x; sources[day] = sha
    buf = io.StringIO(); w = csv.DictWriter(buf, ['date', 'stadium', 'race', 'combo', 'amount', 'popularity']); w.writeheader(); w.writerows(rows)
    data = gzip.compress(buf.getvalue().encode(), mtime=0); (out / 'races.csv.gz').write_bytes(data)
    report = {'policy': 'trifecta-popularity-v1', 'generated_at': datetime.now(timezone.utc).isoformat(), 'start': a.start, 'end': a.end,
              'days_with_source': len(sources), 'source_failures': len(failures), 'failure_samples': failures[:30], 'races': len(rows),
              'excluded_races': excluded, 'rows_sha256': hashlib.sha256(data).hexdigest(),
              'sources_sha256': hashlib.sha256(json.dumps(sources, sort_keys=True).encode()).hexdigest(),
              'interpretation': 'Final popularity ranks from official K files. Measures market favourite/longshot bias only; '
                                'popularity is post-close and must never be a prediction feature. Takeout makes ~75% the neutral return.',
              **summarize(rows)}
    (out / 'summary.json').write_text(json.dumps(report, ensure_ascii=False, indent=1) + '\n')
    print({k: report[k] for k in ['days_with_source', 'source_failures', 'races', 'excluded_races']})
    for b in report['overall']['bands']: print(b)


if __name__ == '__main__':
    main()
