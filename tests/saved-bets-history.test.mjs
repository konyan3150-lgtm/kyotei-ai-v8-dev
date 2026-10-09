import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const source=fs.readFileSync('overrides/value-record-state.js','utf8');
function load(){
  const window={};
  vm.runInNewContext(source,{window});
  return window;
}
test('value recommendations must follow the saved value mode and not a recalculated bet',()=>{
  const w=load();
  const rec={
    odds_snapshot_at:'2026-10-09T10:00:00Z',
    value_modes:{
      hit:{picks:[{combination:'1-2-3'}]},
      balance:{picks:[]},
      return:{picks:[{combination:'1-3-2'}]}
    },
    recommendations:{
      hit:{level:'buy',score:90},
      balance:{level:'buy',score:90},
      return:{level:'skip',score:20}
    }
  };
  assert.equal(w.v8ValueRecordState(rec,'hit').kind,'ready');
  assert.equal(w.v8ValueRecordState(rec,'balance').kind,'skipped');
  assert.equal(w.v8ValueRecordState(rec,'return').kind,'ready');
  const saved=w.v8SavedValueRecommendations(rec);
  assert.equal(saved.hit.level,'buy');
  assert.equal(saved.balance.level,'skip');
  assert.equal(saved.return.level,'skip');
});
test('missing or cancelled snapshots cannot be treated as saved purchases',()=>{
  const w=load();
  assert.equal(w.v8ValueRecordState({cancelled:true},'hit').kind,'cancelled');
  assert.equal(w.v8ValueRecordState({},'hit').kind,'missing');
  assert.equal(w.v8ValueRecordState({value_modes:{hit:{picks:[]}}},'hit').kind,'unavailable');
});
test('history rendering preserves separate base and value records',()=>{
  const history=fs.readFileSync('overrides/history.js','utf8');
  assert.match(history,/view==='base'/);
  assert.match(history,/rec\?\.modes\?\.\[mode\]/);
  assert.match(history,/rec\?\.value_modes\?\.\[mode\]/);
  assert.match(history,/period==='1'&&program/);
});
