import assert from 'node:assert/strict';
import fs from 'node:fs';
const filename=process.argv[2];
if(!filename)throw Error('usage: node scripts/check-production-baseline.mjs <totals-json>');
const actual=JSON.parse(fs.readFileSync(filename,'utf8'));
const expected={
  indexed_records:2782,
  unique_records:2782,
  sha256:'b99196159f93b03303e65e750277fd82dedce9db6737f331266b55f3c9aed00f',
  totals:{
    'modes.hit':{count:2782,stake:1669200,payout:1314890},
    'modes.balance':{count:2782,stake:1669200,payout:1261180},
    'modes.return':{count:2782,stake:1669200,payout:1295770},
    'value_modes.hit':{count:2782,stake:1996000,payout:1635450},
    'value_modes.balance':{count:2782,stake:2462700,payout:2061700},
    'value_modes.return':{count:2782,stake:2487400,payout:1662880}
  }
};
for(const key of ['indexed_records','unique_records','sha256','totals'])assert.deepEqual(actual[key],expected[key],key+' differs from approved frozen snapshot');
console.log('Frozen production baseline matches all 6 modes, counts and checksum.');
