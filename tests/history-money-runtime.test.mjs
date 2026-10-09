import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const source=fs.readFileSync('overrides/history.js','utf8');
const modeStart=source.indexOf('  function modeRecord(');
const modeEnd=source.indexOf('  function ensurePanel()',modeStart);
assert.ok(modeStart>=0&&modeEnd>modeStart);
const funcs=source.slice(modeStart,modeEnd);
const sumStart=source.indexOf('    let races=0,hits=0,invest=0,payout=0;');
const sumEnd=source.indexOf('    const roi=',sumStart);
assert.ok(sumStart>=0&&sumEnd>sumStart);
const roiEnd=source.indexOf('\n',sumEnd);
const calculation=source.slice(sumStart,roiEnd);
function total(filtered,mode,view,scope='all'){
  const context={filtered,mode,view,scope,MODE_LABELS:{hit:'hit',balance:'balance',return:'return'},Number,Object};
  return vm.runInNewContext(funcs+'\n'+calculation+'\n({races,hits,invest,payout,roi,hitRate,profit})',context);
}
const record={
  value_model_version:4,
  modes:{hit:{settled:true,stake:600,payout:900,hit:true},balance:{settled:true,stake:700,payout:0,hit:false}},
  value_modes:{hit:{settled:true,stake:200,payout:500,hit:true},balance:{settled:true,stake:300,payout:0,hit:false}},
  base_recommendations:{hit:{level:'buy'},balance:{level:'skip'}}
};
test('V8 and value history investment and payout remain independent',()=>{
  const base=total([record],'hit','base');
  const value=total([record],'hit','value');
  assert.equal(base.invest,600);assert.equal(base.payout,900);
  assert.equal(value.invest,200);assert.equal(value.payout,500);
});
test('all mode sums individual mode records exactly once',()=>{
  const base=total([record],'all','base');
  assert.equal(base.races,2);assert.equal(base.invest,1300);assert.equal(base.payout,900);
});
test('recommended filter excludes non-buy V8 records',()=>{
  const base=total([record],'all','base','recommended');
  assert.equal(base.races,1);assert.equal(base.invest,600);assert.equal(base.payout,900);
});
test('cancelled, skipped and unsettled modes do not enter monetary totals',()=>{
  const cancelled={...record,cancelled:true};
  const skipped={value_model_version:4,value_modes:{hit:{settled:true,skipped:true,stake:400,payout:0}}};
  const pending={value_model_version:4,value_modes:{hit:{settled:false,stake:500,payout:0}}};
  const value=total([cancelled,skipped,pending],'hit','value');
  assert.equal(value.races,0);assert.equal(value.invest,0);assert.equal(value.payout,0);
});

test('ROI uses settled saved stakes and payouts in each prediction mode',()=>{
  const base=total([record],'hit','base');
  const value=total([record],'hit','value');
  assert.equal(base.roi,150);assert.equal(base.profit,300);
  assert.equal(value.roi,250);assert.equal(value.profit,300);
  const combined=total([record],'all','base');
  assert.equal(combined.roi,900/1300*100);assert.equal(combined.profit,-400);
});
test('empty history has finite zero ROI without division by zero',()=>{
  const empty=total([],'hit','base');
  assert.equal(empty.roi,0);assert.equal(empty.hitRate,0);assert.equal(empty.profit,0);
});
