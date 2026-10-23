import test from 'node:test';
import assert from 'node:assert/strict';
import { analyzeSavedSelections } from '../selection-analysis.mjs';

const mode = (picks, stake, payout, hit) => ({
  picks, stake, payout, hit, settled: true
});
const records = {
  race: {
    date: '20261009', stadium: 1, race: 1, settled: true,
    modes: { hit: mode(['1-2-3'], 600, 1200, true), balance: mode(['1-3-2'], 400, 0, false) },
    value_model_version: 3,
    value_modes: { hit: mode(['2-1-3'], 200, 0, false), balance: mode(['2-3-1'], 300, 1500, true) }
  }
};
test('V8 and EV saved mode summaries stay isolated', () => {
  const baseHit = analyzeSavedSelections(records, {view:'base',mode:'hit'}).summary;
  const evHit = analyzeSavedSelections(records, {view:'value',mode:'hit'}).summary;
  const baseBalance = analyzeSavedSelections(records, {view:'base',mode:'balance'}).summary;
  const evBalance = analyzeSavedSelections(records, {view:'value',mode:'balance'}).summary;
  assert.deepEqual([baseHit.investment,baseHit.payout,baseHit.hits],[600,1200,1]);
  assert.deepEqual([evHit.investment,evHit.payout,evHit.hits],[200,0,0]);
  assert.deepEqual([baseBalance.investment,baseBalance.payout,baseBalance.hits],[400,0,0]);
  assert.deepEqual([evBalance.investment,evBalance.payout,evBalance.hits],[300,1500,1]);
});
test('EV records without value model v3 are not counted', () => {
  const legacy = structuredClone(records);
  legacy.race.value_model_version = 2;
  assert.equal(analyzeSavedSelections(legacy,{view:'value',mode:'hit'}).summary.races,0);
});
