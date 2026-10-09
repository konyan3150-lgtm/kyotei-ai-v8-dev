import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const src=fs.readFileSync('overrides/history.js','utf8');
const a=src.indexOf('  function records(){');
const b=src.indexOf('  function modeRecord(',a);
assert.ok(a>=0&&b>a);
const fn=src.slice(a,b);
function getRecords(serverData,local=[]){
  const store=new Map(local.map(([key,record])=>[key,JSON.stringify(record)]));
  const localStorage={length:store.size,key:i=>[...store.keys()][i],getItem:key=>store.get(key)};
  const ctx={localStorage,PREFIX:'kyotei_v8_dev_result_',window:{__v8ServerPredictionData:{records:serverData},v8GetSavedPredictions:()=>serverData},serverRecords:[],dateValue:x=>Number(x),Map,Object,JSON,Date,Number,String};
  return vm.runInNewContext(fn+'\nrecords()',ctx);
}
test('history iterates object-shaped server predictions without TypeError',()=>{
  const data={'a':{date:'20261009',stadium:'01',race:'01',saved_at:'2026-10-09T10:00:00Z',modes:{hit:{stake:100,payout:200}}}};
  const result=getRecords(data);
  assert.equal(result.length,1);
  assert.equal(result[0].modes.hit.stake,100);
});
test('newer server record wins over older local copy',()=>{
  const old={date:'20261009',stadium:'01',race:'01',saved_at:'2026-10-09T09:00:00Z',modes:{hit:{stake:100}}};
  const fresh={...old,saved_at:'2026-10-09T10:00:00Z',modes:{hit:{stake:300}}};
  const result=getRecords({'a':fresh},[['kyotei_v8_dev_result_20261009_01_01',{...old,source:'server'}]]);
  assert.equal(result.length,1);
  assert.equal(result[0].modes.hit.stake,300);
});

test('local-only saved predictions appear in history',()=>{
  const local={date:'20261009',stadium:'01',race:'02',saved_at:'2026-10-09T09:00:00Z',modes:{hit:{stake:600,payout:900}}};
  const result=getRecords({},[['kyotei_v8_dev_result_20261009_01_02',local]]);
  assert.equal(result.length,1);
  assert.equal(result[0].modes.hit.stake,600);
  assert.equal(result[0].modes.hit.payout,900);
});
