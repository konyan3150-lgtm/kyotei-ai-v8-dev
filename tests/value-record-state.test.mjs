import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

function loadValueState() {
  const context = {window:{}};
  vm.runInNewContext(fs.readFileSync('overrides/value-record-state.js','utf8'),context);
  return context.window;
}
test('saved EV recommendations never fall back to V8 recommendations',()=>{
  const api=loadValueState();
  const record={
    modes:{hit:{picks:['1-2-3']}},
    base_recommendations:{hit:{level:'buy'}},
    value_modes:{},
    recommendations:{}
  };
  assert.equal(api.v8ValueRecordState(record,'hit').kind,'missing');
  assert.equal(api.v8SavedValueRecommendations(record).hit.level,'none');
});
test('saved EV picks are ready only in their own mode',()=>{
  const api=loadValueState();
  const record={
    value_modes:{hit:{picks:['2-1-3']},balance:{picks:[]}},
    recommendations:{hit:{level:'buy'},balance:{level:'buy'}},
    odds_snapshot_at:'2026-10-09T10:00:00+09:00'
  };
  assert.equal(api.v8ValueRecordState(record,'hit').kind,'ready');
  assert.equal(api.v8ValueRecordState(record,'balance').kind,'skipped');
  assert.equal(api.v8SavedValueRecommendations(record).balance.level,'skip');
});
