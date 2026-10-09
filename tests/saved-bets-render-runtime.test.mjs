import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const source=fs.readFileSync('overrides/odds-value.js','utf8');
const start=source.indexOf('function renderBaseBetsPanel(rows){');
const end=source.indexOf('  const baseRenderBets=renderBets;',start);
if(start<0||end<start)throw Error('V8 rendering function missing');
const fn=source.slice(start,end);
function render({closed,stored,models=[]}){
  const el={innerHTML:'',textContent:''};
  let recalculations=0;
  const ctx={
    document:{getElementById:id=>id==='baseBets'?el:null},
    D:{programs:{stadiums:{'1':{races:{'1':{}}}}}},
    sid:'1',rno:'1',basePredictionMode:'hit',models,
    cancelledRace:()=>false,
    raceCloseMs:()=>closed?0:Date.now()+600000,
    hasOfficialResult:()=>false,
    savedRaceRecord:()=>stored,
    makeBets:()=>{recalculations++;return[{rank:1,combo:'6-5-4',share:.2}]},
    Date
  };
  vm.runInNewContext(fn+'\nrenderBaseBetsPanel([])',ctx);
  return {html:el.innerHTML,text:el.textContent,recalculations};
}
test('closed V8 race shows saved picks even without loaded models',()=>{
  const x=render({closed:true,stored:{modes:{hit:{picks:['1-2-3','1-3-2']}}}});
  assert.match(x.html,/1-2-3/);
  assert.match(x.html,/1-3-2/);
  assert.doesNotMatch(x.html,/6-5-4/);
  assert.equal(x.recalculations,0);
});
test('server V8 record is authoritative before close',()=>{
  const x=render({closed:false,stored:{source:'server',modes:{hit:{picks:['2-1-3']}}},models:[1,2,3]});
  assert.match(x.html,/2-1-3/);
  assert.equal(x.recalculations,0);
});
test('closed V8 race without saved bets never invents picks',()=>{
  const x=render({closed:true,stored:null,models:[1,2,3]});
  assert.match(x.html,/保存買い目がありません/);
  assert.equal(x.recalculations,0);
});
test('open unsaved V8 race can show current recommendations',()=>{
  const x=render({closed:false,stored:null,models:[1,2,3]});
  assert.match(x.html,/6-5-4/);
  assert.equal(x.recalculations,1);
});
