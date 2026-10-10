import assert from 'node:assert/strict';
import {oddsCapCapture,oddsCapReport,oddsCapValid,ODDS_CAP_POLICY} from './odds_cap.mjs';

const combos=[];for(const a of '123456')for(const b of '123456')for(const c of '123456')if(a!==b&&a!==c&&b!==c)combos.push(`${a}-${b}-${c}`);
// Four EV tickets at different odds bands, everything else far below the EV threshold.
const special={'1-2-3':{prob:.2,odds:8},'1-3-2':{prob:.05,odds:40},'2-1-3':{prob:.022,odds:80},'4-5-6':{prob:.01,odds:300}};
const remainder=(1-Object.values(special).reduce((s,x)=>s+x.prob,0))/(120-Object.keys(special).length);
const distribution=combos.map(combo=>special[combo]?{combo,...special[combo]}:{combo,prob:remainder,odds:50});
const at='2026-10-12T00:55:00Z',saved='2026-10-12T01:00:00Z';
const base={cohort:'expert-shadow-official-v1',date:'20261012',stadium:'1',race:'1',closed_at:'2026-10-12 10:30:00',saved_at:saved,odds_snapshot_at:at,baseline_distribution:distribution,candidate_distribution:structuredClone(distribution),baseline_picks:combos.slice(0,6),candidate_picks:combos.slice(0,6)};

const capture=oddsCapCapture(base);
assert.deepEqual(capture.arms.reference.items.map(x=>x.combo),['4-5-6','1-3-2','2-1-3','1-2-3']);
assert.deepEqual(capture.arms.cap_100.items.map(x=>x.combo),['1-3-2','2-1-3','1-2-3']);
assert.deepEqual(capture.arms.cap_50.items.map(x=>x.combo),['1-3-2','1-2-3']);
assert.deepEqual(capture.arms.cap_30.items.map(x=>x.combo),['1-2-3']);
assert.equal(capture.arms.reference.investment,400);assert.equal(capture.arms.cap_30.investment,100);
for(const arm of Object.values(capture.arms))assert.ok(arm.items.every(x=>x.discounted_ev>=ODDS_CAP_POLICY.min_ev&&x.stake===100));

// Not captured before the fixed start, with stale odds, or with incomplete odds.
assert.equal(oddsCapCapture({...base,saved_at:'2026-10-10T14:59:00Z',odds_snapshot_at:'2026-10-10T14:55:00Z'}),null);
assert.equal(oddsCapCapture({...base,odds_snapshot_at:'2026-10-12T00:40:00Z'}),null);
assert.equal(oddsCapCapture({...base,baseline_distribution:distribution.map((x,i)=>i?x:{...x,odds:null})}),null);

// Settlement with actual payouts; records are not mutated.
const r={...base,odds_cap_shadow:capture,outcome:{result:'1-2-3',amount:760}};
const before=JSON.stringify(r),report=oddsCapReport({a:r});assert.equal(JSON.stringify(r),before);
assert.equal(report.test_races,1);assert.equal(report.ready_for_review,false);assert.equal(report.production_changed,false);
assert.equal(report.arms.reference.payout,760);assert.equal(report.arms.reference.investment,400);assert.equal(report.arms.cap_30.roi,7.6);
const miss={...r,race:'2',odds_cap_shadow:oddsCapCapture({...base,race:'2'}),outcome:{result:'4-5-6',amount:30000}};
const two=oddsCapReport({a:r,b:miss});
assert.equal(two.arms.reference.payout,30760);assert.equal(two.arms.cap_100.payout,760);assert.equal(two.arms.cap_100.risk.max_consecutive_misses,1);

// Tampered, post-close, cancelled, excluded or missing captures are not counted.
for(const change of [x=>delete x.odds_cap_shadow,x=>x.odds_cap_shadow.arms.cap_30.items=[],x=>x.odds_cap_shadow.version='bad',x=>x.cancelled=true,x=>x.excluded={reason:'refund'},
  x=>{x.closed_at='2026-10-12 09:59:00'},x=>x.baseline_distribution[0].odds=99]){const bad=structuredClone(r);change(bad);assert.equal(oddsCapValid(bad)&&!bad.cancelled&&!bad.excluded,false);assert.equal(oddsCapReport({bad}).test_races,0);}

assert.deepEqual(ODDS_CAP_POLICY.caps,[100,50,30]);assert.ok(Object.isFrozen(ODDS_CAP_POLICY));
assert.ok(Object.isFrozen(ODDS_CAP_POLICY.caps));
for(const change of [x=>x.cohort='other',x=>x.date='20261011',x=>x.closed_at='2026-10-12 10:00:00',x=>x.baseline_distribution[0].prob=2,x=>x.baseline_distribution[1].combo=x.baseline_distribution[0].combo,x=>x.baseline_distribution[0].prob+=.1,x=>x.saved_at='bad']){
 const bad=structuredClone(base);change(bad);assert.equal(oddsCapCapture(bad),null);assert.equal(oddsCapReport({bad:{...bad,odds_cap_shadow:capture,outcome:r.outcome}}).test_races,0);
}
for(const outcome of [{result:'1-1-2',amount:100},{result:'bad',amount:100},{result:'1-2-3',amount:0},{result:'1-2-3',amount:1.5},{result:'1-2-3',amount:Number.MAX_SAFE_INTEGER+1},{excluded:true,result:'1-2-3',amount:100}])assert.equal(oddsCapReport({bad:{...r,outcome}}).test_races,0);
const boundary={...base,date:'20261011',closed_at:'2026-10-11 00:30:00',saved_at:ODDS_CAP_POLICY.starts_at,odds_snapshot_at:ODDS_CAP_POLICY.starts_at};
assert.ok(oddsCapCapture(boundary));
const atCap=structuredClone(base);atCap.baseline_distribution.find(x=>x.combo==='1-3-2').odds=50;
assert.ok(!oddsCapCapture(atCap).arms.cap_50.items.some(x=>x.combo==='1-3-2'));
const skipped=structuredClone(base);for(const x of skipped.baseline_distribution)x.odds=1;
const skippedReport=oddsCapReport({skipped:{...skipped,odds_cap_shadow:oddsCapCapture(skipped),outcome:r.outcome}});
assert.equal(skippedReport.arms.reference.skipped_races,1);assert.equal(skippedReport.arms.reference.roi,null);
const readyRecords={};for(let d=12;d<17;d++)for(let i=0;i<30;i++){
 const date=`202610${d}`,sample={...base,date,race:String(i+1),saved_at:`2026-10-${d}T01:00:00Z`,odds_snapshot_at:`2026-10-${d}T00:55:00Z`,closed_at:`2026-10-${d} 10:30:00`};
 readyRecords[`${date}_${i}`]={...sample,odds_cap_shadow:oddsCapCapture(sample),outcome:r.outcome};
}
assert.equal(oddsCapReport(readyRecords).ready_for_review,true);delete readyRecords['20261012_0'];assert.equal(oddsCapReport(readyRecords).ready_for_review,false);
console.log('Odds cap passed: fixed caps on unchanged EV rule, start gate, stale/incomplete odds rejected, actual payouts, immutable records, tampering and post-close captures rejected');
