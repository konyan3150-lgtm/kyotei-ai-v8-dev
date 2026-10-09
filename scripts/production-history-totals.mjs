import fs from 'node:fs';
import crypto from 'node:crypto';
const root = process.argv[2];
if (!root) throw new Error('Pass a directory containing the production history snapshot');
const read = path => JSON.parse(fs.readFileSync(root + '/' + path, 'utf8'));
const index = read('server-predictions-index.json');
const sources = [
  ['current', read('server-predictions.json')],
  ...index.archives.map(item => [item.file, read(item.file)])
];
const records = new Map();
for (const [source, document] of sources) {
  for (const [key, record] of Object.entries(document.records || {})) {
    if (!records.has(key)) records.set(key, {source, record});
  }
}
const totals = {};
for (const group of ['modes', 'value_modes']) {
  for (const mode of ['hit', 'balance', 'return']) {
    let stake = 0, payout = 0, count = 0;
    for (const {record} of records.values()) {
      const item = record[group]?.[mode];
      if (!item) continue;
      stake += Number(item.stake || 0);
      payout += Number(item.payout || 0);
      count++;
    }
    totals[group + '.' + mode] = {count, stake, payout};
  }
}
const entries = [...records.entries()].sort(([a], [b]) => a.localeCompare(b));
const checksum = crypto.createHash('sha256').update(JSON.stringify(entries)).digest('hex');
console.log(JSON.stringify({
  source: 'frozen-production-snapshot',
  indexed_records: index.total_record_count,
  unique_records: records.size,
  totals,
  sha256: checksum
}, null, 2));
