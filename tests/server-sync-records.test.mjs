import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

function setup(initial={}, serverRecord=null) {
  const entries=new Map(Object.entries(initial).map(([k,v])=>[k,JSON.stringify(v)]));
  const localStorage={
    get length(){return entries.size},
    key(i){return [...entries.keys()][i]??null},
    getItem(k){return entries.get(k)??null},
    setItem(k,v){entries.set(k,String(v))}
  };
  const listeners={};
  const window={addEventListener(){},dispatchEvent(){},v8SavedValueRecommendations:null};
  const document={getElementById(){return null},addEventListener(){}};
  const context={window,document,localStorage,Date,console,setTimeout(){},setInterval(){},CustomEvent:class{}};
  vm.runInNewContext(fs.readFileSync('overrides/server-sync.js','utf8'),context);
  const key='kyotei_v8_dev_result_20261009_01_01';
  if(serverRecord) vm.runInNewContext('void 0',context);
  return {window,localStorage,key};
}
const key='kyotei_v8_dev_result_20261009_01_01';
const saved=(picks,stake,payout=0)=>({picks,stake,payout,items:picks.map(combo=>({combo,stake:stake/picks.length}))});
test('local-only saved prediction remains available',()=>{
  const local={date:'20261009',modes:{hit:saved(['1-2-3'],600)},value_modes:{hit:saved(['2-1-3'],400)}};
  const {window}=setup({[key]:local});
  const result=window.v8GetSavedPredictions()[key];
  assert.deepEqual(Array.from(result.modes.hit.picks),['1-2-3']);
  assert.deepEqual(Array.from(result.value_modes.hit.picks),['2-1-3']);
  assert.equal(result.modes.hit.stake,600);
  assert.equal(result.value_modes.hit.stake,400);
});
test('malformed local record does not hide other valid saved predictions',()=>{
  const other='kyotei_v8_dev_result_20261009_01_02';
  const {window,localStorage}=setup({[key]:{date:'20261009',modes:{hit:saved(['1-2-3'],600)}}});
  localStorage.setItem(other,'{broken');
  assert.equal(window.v8GetSavedPredictions()[key].modes.hit.stake,600);
  assert.equal(window.v8GetSavedPredictions()[other],undefined);
});
