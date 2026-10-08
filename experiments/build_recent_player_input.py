"""Build a transient, verified recent-player lookup for future preclose captures."""
import argparse
import collections
import datetime as dt
import gzip
import hashlib
import json
import tempfile
from pathlib import Path
from recent_player_features import date_value, load_sources, RecentHistory


def build_store(history, query_date, proof):
    query = date_value(query_date)
    if any(d >= query for d in history.available_dates):
        raise ValueError('Input includes target-day or future history')
    coverage = {}
    players = {}
    for days in (30, 90):
        begin = query - dt.timedelta(days=days)
        expected = {begin + dt.timedelta(days=i) for i in range(days)}
        coverage[str(days)] = {'from': begin.isoformat(), 'through': (query - dt.timedelta(days=1)).isoformat(),
                              'source_days': len(expected & history.available_dates), 'required_days': days,
                              'source_complete': expected <= history.available_dates}
    for rid, all_rows in history.players.items():
        player = {}
        for days in (30, 90):
            begin = query - dt.timedelta(days=days)
            groups = collections.defaultdict(list)
            for r in all_rows:
                if begin <= r['date'] < query:
                    for key in ('overall', f"c_{r['course']}", f"v_{r['stadium']}", f"x_{r['stadium']}_{r['course']}"):
                        groups[key].append(r)
            player[str(days)] = {key: RecentHistory.summarize(rows) for key, rows in groups.items()}
        players[str(rid)] = player
    return {'version': 'recent-player-preclose-v1', 'as_of_date': query.strftime('%Y%m%d'),
            'history_through': (query - dt.timedelta(days=1)).isoformat(), 'coverage': coverage,
            'source': proof, 'players': players, 'empty_group': RecentHistory.summarize([]),
            'role': 'learning input only; never used in existing probabilities or bets'}


def main():
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument('--root', type=Path, default=Path('.'))
    p.add_argument('--date', default=dt.datetime.now(dt.timezone(dt.timedelta(hours=9))).strftime('%Y%m%d'))
    p.add_argument('--out', type=Path, required=True)
    args = p.parse_args()
    root = args.root / 'dev'
    repair = json.loads((root / 'aptitude-official-repair-audit.json').read_text())
    audit_bytes = (root / 'aptitude-prospective-audit.json').read_bytes()
    audit = json.loads(audit_bytes)
    if repair['status'] != 'verified' or audit['status'] != 'verified' or audit['cohort'] != 'expert-shadow-official-v1':
        raise ValueError('Unverified history audit')
    if date_value(audit['through']) != date_value(args.date) - dt.timedelta(days=1):
        raise ValueError('History must end exactly yesterday')
    with tempfile.TemporaryDirectory() as directory:
        target = Path(directory)
        for entry in audit['appended_days']:
            date = entry['date']
            if date_value(date) >= date_value(args.date):
                raise ValueError('Future ledger day')
            source = json.loads(gzip.decompress((root / 'aptitude-prospective-source' / (date + '.json.gz')).read_bytes()))
            if source['date'] != date or source['source_sha256'] != entry['source_sha256'] or len(source['starts']) != entry['starts']:
                raise ValueError('Daily source does not match official audit')
            (target / (date + '.json')).write_text(json.dumps(source))
        history, _, proof = load_sources(root / 'racer-starts-official.csv.gz', repair['normalized_rows_sha256'], target)
    proof['prospective_audit_sha256'] = hashlib.sha256(audit_bytes).hexdigest()
    proof['aptitude_sha256'] = audit['snapshot_sha256']
    store = build_store(history, args.date, proof)
    args.out.parent.mkdir(parents=True, exist_ok=True)
    args.out.write_text(json.dumps(store, separators=(',', ':'), allow_nan=False) + '\n')
    print(json.dumps({'as_of': args.date, 'players': len(store['players']), 'coverage': store['coverage']}))


if __name__ == '__main__':
    main()
