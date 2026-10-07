import assert from 'node:assert/strict';
import {prepareOddsCalibration,oddsCalibratedDistribution,captureOddsCalibration,settleOddsCalibration,oddsCalibrationReport,validateOddsCalibrationModel} from './odds_calibration.mjs';
import {evTickets} from './ev_drift.mjs';
import {allCombinations,snapshot,settle} from './repaired_expert_shadow.mjs';
const combos=[];for(let a=1;a<=6;a++)for(let b=1;b<=6;b++)for(let c=1;c<=6;c++)if(new Set([a,b,c]).size===3)combos.push(`${a}-${b}-${c}`);
function fixture(day,n=1){const date=`202610${String(day).padStart(2,'0')}`,iso=`2026-10-${String(day).padStart(2,'0')}`;
 const d=combos.map((combo,i)=>({combo,prob:1/120,odds:i===0?2:200}));return {cohort:'expert-shadow-official-v1',date,stadium:'1',race:String(n),saved_at:iso+'T01:00:00Z',closed_at:iso+' 11:00:00',odds_snapshot_at:iso+'T00:55:00Z',baseline_distribution:d,candidate_distribution:d.map(x=>({...x})),baseline_picks:combos.slice(0,6),candidate_picks:combos.slice(0,6),value_arms:{baseline:evTickets(d,d,iso+'T00:55:00Z',iso+'T01:00:00Z')},outcome:{result:combos[0],amount:200,settled_at:iso+'T03:00:00Z',metrics:{baseline:{log_loss:Math.log(120),brier:119/120}},value_metrics:{baseline:{investment:400,payout:0,hit:false}}}};
}
const records={};for(let day=1;day<=20;day++)for(let n=1;n<=25;n++)records[`${day}_${n}`]=fixture(day,n);
const options={today:'20261021',now:'2026-10-21T00:00:00Z'},before=JSON.stringify(records),fitted=prepareOddsCalibration(records,options);assert.equal(JSON.stringify(records),before);
assert.equal(fitted.status,'frozen');assert.equal(fitted.new_model,true);assert.equal(fitted.model.train_races,500);assert.equal(fitted.model.train_dates.at(-1),'20261020');assert.equal(fitted.model.market_weight,.75);assert.equal(fitted.model.temperature,1);
const nineteen=Object.fromEntries(Object.entries(records).filter(([,r])=>r.date<'20261020'));assert.equal(prepareOddsCalibration(nineteen,options).status,'collecting');
const incomplete=structuredClone(records);incomplete['1_1'].baseline_distribution[5].odds=null;assert.equal(prepareOddsCalibration(incomplete,options).train_races,499);
const futureRecords={...records,test:fixture(21)};futureRecords.test.outcome.result=combos[1];assert.deepEqual(prepareOddsCalibration(futureRecords,{...options,model:fitted.model}).model,fitted.model);
assert.throws(()=>validateOddsCalibrationModel({...fitted.model,market_weight:1}));assert.throws(()=>validateOddsCalibrationModel({...fitted.model,fitted_at:'2026-10-20T00:00:00Z'}));assert.throws(()=>prepareOddsCalibration(records,{today:'20261022',now:options.now}));
const r=fixture(21),saved=JSON.stringify(r),d=oddsCalibratedDistribution(r.baseline_distribution,fitted.model);assert.ok(Math.abs(d.reduce((s,x)=>s+x.prob,0)-1)<1e-12);assert.ok(d[0].prob>r.baseline_distribution[0].prob);assert.equal(JSON.stringify(r),saved);
assert.equal(captureOddsCalibration(fixture(20),fitted.model),null);assert.equal(captureOddsCalibration({...r,saved_at:'2026-10-21T00:00:00Z'}, {...fitted.model,fitted_at:'2026-10-21T00:01:00Z'}),null);
assert.equal(captureOddsCalibration({...r,odds_snapshot_at:'2026-10-21T00:40:00Z'},fitted.model),null);
assert.equal(oddsCalibrationReport(records,fitted).test_races,0);assert.equal(settleOddsCalibration(r),null);
r.odds_calibration_shadow=captureOddsCalibration(r,fitted.model);assert.ok(r.odds_calibration_shadow);r.outcome.odds_calibration=settleOddsCalibration(r);assert.ok(r.outcome.odds_calibration);assert.equal(r.outcome.odds_calibration.investment,0);
const one=oddsCalibrationReport({r},fitted);assert.equal(one.test_races,1);assert.equal(one.ready_for_review,false);assert.equal(one.arms.raw.bought_races,1);assert.equal(one.arms.calibrated.bought_races,0);assert.equal(one.arms.calibrated.roi,null);assert.equal(one.production_changed,false);
const test={};for(let day=21;day<=25;day++)for(let n=1;n<=30;n++){const x=fixture(day,n);x.odds_calibration_shadow=captureOddsCalibration(x,fitted.model);x.outcome.odds_calibration=settleOddsCalibration(x);test[`${day}_${n}`]=x;}
const checked=oddsCalibrationReport(test,fitted);assert.equal(checked.test_races,150);assert.equal(checked.test_dates.length,5);assert.equal(checked.ready_for_review,true);assert.equal(checked.production_changed,false);
const corrupt=structuredClone(r);corrupt.odds_calibration_shadow.model_fitted_at='2026-10-22T00:00:00Z';assert.equal(oddsCalibrationReport({corrupt},fitted).test_races,0);assert.equal(settleOddsCalibration(corrupt),null);
for(const change of [x=>x.odds_calibration_shadow.distribution[0].prob=-1,x=>x.odds_calibration_shadow.captured_at='2026-10-21T00:00:00Z',x=>x.odds_calibration_shadow.model_fitted_at='invalid',x=>x.cancelled=true,x=>x.excluded={reason:'refund'}]){const bad=structuredClone(r);change(bad);assert.equal(settleOddsCalibration(bad),null);assert.equal(oddsCalibrationReport({bad},fitted).test_races,0);}
// Exercise actual collector snapshot and settlement, keeping existing picks intact.
const rows=[1,2,3,4,5,6].map(k=>({k:String(k),p:[1/6,1/6,1/6]})),odds={fetched_at:r.odds_snapshot_at,trifecta:{}};
for(const x of r.baseline_distribution){const [a,b,c]=x.combo.split('-');odds.trifecta[a]??={};odds.trifecta[a][b]??={};odds.trifecta[a][b][c]=x.odds;}
const rec=snapshot({race:{date:'2026-10-21',closed_at:'2026-10-21 10:15:00'},rows,expert:{version:2,weights:{inside:0,upset:0}},makeBets:rs=>allCombinations(rs).slice(0,6),date:r.date,stadium:'1',number:'1',now:new Date(r.saved_at),odds});rec.cohort='expert-shadow-official-v1';rec.odds_calibration_shadow=captureOddsCalibration(rec,fitted.model);const picks=JSON.stringify(rec.baseline_picks);
assert.ok(settle(rec,{combination:combos[0],amount:200}));assert.ok(rec.outcome.odds_calibration);assert.equal(JSON.stringify(rec.baseline_picks),picks);assert.equal(rec.outcome.metrics.baseline.investment,600);assert.equal(settle(rec,{combination:combos[0],amount:200}),false);
console.log('Odds calibration passed: 20 completed dates / 500 complete-odds races, immutable training and frozen model, no retrofits, capture/settlement integration, paired EV skips and future-only holdout');
