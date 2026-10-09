import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const source=fs.readFileSync('overrides/odds-value.js','utf8');
const a=source.indexOf('  function renderSavedValueBets(saved,closed=true){');
const b=source.indexOf('  function renderValueBets(rows){',a);
assert.ok(a>=0&&b>a,'saved value renderer is present');
const fn=source.slice(a,b);
function render(saved){
  const el={innerHTML:'',textContent:''};
  const context={document:{getElementById:id=>id==='bets'?el:null},window:{},stakeBadge:()=>'',stakeForEv:()=>100,Date,Number,String,Array};
  vm.runInNewContext(fn+'\nrenderSavedValueBets(saved,true)',{...context,saved});
  return el.innerHTML;
}
test('value saved items show frozen ticket and stake, not current odds',()=>{
  const html=render({snapshot_at:'2026-10-09T10:00:00Z',picks:['1-2-3'],items:[{combo:'1-2-3',prob:.2,odds:8,ev:1.2,stake:200}]});
  assert.match(html,/1-2-3/);
  assert.match(html,/200/);
  assert.match(html,/8\.0/);
});
test('value legacy saved picks show ticket even without EV details',()=>{
  const html=render({picks:['2-1-3'],items:[]});
  assert.match(html,/2-1-3/);
  assert.match(html,/組番のみ表示/);
});
test('value saved empty picks are marked as skipped',()=>{
  const html=render({picks:[],items:[],display_state:{kind:'skipped',reason:'EV基準未達'}});
  assert.match(html,/見送り/);
  assert.match(html,/EV基準未達/);
});
