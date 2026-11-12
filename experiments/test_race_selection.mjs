import assert from 'node:assert/strict';
import {selectionFeatures,raceSelectionReport,RACE_SELECTION_POLICY as P} from './race_selection.mjs';
const combos=[];for(const a of '123456')for(const b of '123456')for(const c of '123456')if(a!==b&&a!==c&&b!==c)combos.push(`${a}-${b}-${c}`);
const mk=(race,{pickProb,l1,result,amount,saved='2026-11-13T01:00:00Z'})=>{const picks=combos.slice(0,6),other=(1-pickProb)/114;
  const dist=combos.map((c,i)=>({combo:c,prob:i<6?pickProb/6:other,odds:10}));const close=new Date(Date.parse(saved)+30*60000+race*60000);
  const jst=new Date(close.getTime()+9*3600000).toISOString();
  return {cohort:'expert-shadow-official-v1',date:jst.slice(0,10).replaceAll('-',''),stadium:'1',race:String(race),closed_at:jst.slice(0,10)+' '+jst.slice(11,19),saved_at:saved,odds_snapshot_at:new Date(Date.parse(saved)-60000).toISOString(),
    baseline_distribution:dist,candidate_distribution:dist,baseline_picks:picks,candidate_picks:picks,rank_probabilities:'123456'.split('').map(l=>({lane:l,p:[l==='1'?l1:(1-l1)/5,.2,.2]})),
    outcome:{result,amount}};};
// Features and fixed thresholds.
{const f=selectionFeatures(mk(1,{pickProb:.30,l1:.8,result:'1-2-3',amount:1000}));assert.ok(Math.abs(f.pick_prob-.30)<1e-12);assert.deepEqual(f.buy,{all:true,conc40:true,lane1:true});
 assert.deepEqual(selectionFeatures(mk(1,{pickProb:.28,l1:.5,result:'1-2-3',amount:1000})).buy,{all:true,conc40:false,lane1:false});
 assert.equal(selectionFeatures(mk(1,{pickProb:.3,l1:.8,result:'1-2-3',amount:1000,saved:'2026-11-12T14:59:00Z'})),null);   // before start
 const r=mk(1,{pickProb:.3,l1:.8,result:'1-2-3',amount:1000});assert.equal(selectionFeatures({...r,odds_snapshot_at:new Date(Date.parse(r.saved_at)-601000).toISOString()}),null);   // stale odds
 assert.equal(selectionFeatures({...r,rank_probabilities:[]}),null);assert.equal(selectionFeatures({...r,baseline_picks:r.baseline_picks.slice(0,5)}),null);}
// Report: same races, skipped races cost 0, refunds excluded, official payout.
{const recs=[mk(1,{pickProb:.30,l1:.8,result:combos[0],amount:1200}),mk(2,{pickProb:.20,l1:.5,result:combos[1],amount:3000}),mk(3,{pickProb:.30,l1:.5,result:'6-5-4',amount:9000}),
   {...mk(4,{pickProb:.30,l1:.8,result:combos[0],amount:500}),outcome:{result:combos[0],amount:500,excluded:{kind:'refund'}}}];
 const rep=raceSelectionReport(recs);assert.equal(rep.test_races,3);assert.equal(rep.excluded.not_settled_or_refund,1);
 assert.equal(rep.arms.all.investment,1800);assert.equal(rep.arms.all.payout,4200);assert.equal(rep.arms.conc40.bought_races,2);assert.equal(rep.arms.conc40.payout,1200);assert.equal(rep.arms.conc40.skipped_races,1);
 assert.equal(rep.arms.lane1.bought_races,1);assert.equal(rep.arms.lane1.hit_rate,1);assert.equal(rep.ready_for_review,false);assert.equal(rep.production_changed,false);
 assert.ok(Math.abs(rep.versus_all.conc40.roi_difference-(1200/1200-4200/1800))<1e-12);}
console.log('race selection OK: fixed thresholds, start/odds/inputs guards, skipped races cost 0, refund exclusion, official payout, comparison with all');
