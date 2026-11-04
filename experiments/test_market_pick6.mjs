import assert from 'node:assert/strict';
import fs from 'node:fs';
import {marketPick6Capture,marketPick6Valid,marketPick6Report,MARKET_PICK6_POLICY as P} from './market_pick6.mjs';
const model=JSON.parse(fs.readFileSync(new URL('../dev/probability-calibration/odds-aware-v1.json',import.meta.url)));
const combos=[];for(const a of '123456')for(const b of '123456')for(const c of '123456')if(a!==b&&a!==c&&b!==c)combos.push(`${a}-${b}-${c}`);
// Model favours 1-x-x strongly; the market favours 2-x-x (lowest odds).
const dist=combos.map((c,i)=>({combo:c,prob:c[0]==='1'?0.12/20+(i<6?0.1:0):(1-0.72)/100,odds:c[0]==='2'?3+i/100:c[0]==='1'?40:80}));
const s=dist.reduce((t,x)=>t+x.prob,0);dist.forEach(x=>x.prob/=s);
const base={cohort:'expert-shadow-official-v1',date:'20261105',stadium:'1',race:'1',closed_at:'2026-11-05 10:30:00',saved_at:'2026-11-05T01:00:00Z',odds_snapshot_at:'2026-11-05T00:55:00Z',
  baseline_distribution:dist,candidate_distribution:dist,baseline_picks:['1-2-3','1-2-4','1-3-2','1-3-4','1-4-2','1-4-3'],candidate_picks:['1-2-3','1-2-4','1-3-2','1-3-4','1-4-2','1-4-3']};
const c=marketPick6Capture(base,model);assert.ok(c);
assert.deepEqual(c.arms.market_top6,['2-1-3','2-1-4','2-1-5','2-1-6','2-3-1','2-3-4']);   // lowest odds, then combo order
assert.deepEqual(c.arms.base_top6,['1-2-3','1-2-4','1-2-5','1-2-6','1-3-2','1-3-4']);
assert.equal(c.arms.makeBets.join(),base.baseline_picks.join());assert.equal(c.temperature,0.75);assert.equal(c.market_weight,0.75);
// Not captured: before start, stale odds, odds after save, after close, missing odds, other cohort, no model.
assert.equal(marketPick6Capture({...base,date:'20261104',closed_at:'2026-11-04 23:50:00',saved_at:'2026-11-04T14:59:00Z',odds_snapshot_at:'2026-11-04T14:55:00Z'},model),null);
assert.equal(marketPick6Capture({...base,odds_snapshot_at:'2026-11-05T00:49:00Z'},model),null);
assert.equal(marketPick6Capture({...base,odds_snapshot_at:'2026-11-05T01:01:00Z'},model),null);
assert.equal(marketPick6Capture({...base,saved_at:'2026-11-05T01:31:00Z',odds_snapshot_at:'2026-11-05T01:30:00Z'},model),null);
assert.equal(marketPick6Capture({...base,baseline_distribution:dist.map((x,i)=>i?x:{...x,odds:null})},model),null);
assert.equal(marketPick6Capture({...base,cohort:'x'},model),null);assert.equal(marketPick6Capture(base,null),null);
assert.equal(marketPick6Capture(base,{...model,market_weight:1}),null);
// Settlement with official payout; tampered captures and refunds are excluded.
const r1={...base,market_pick6_shadow:c,outcome:{result:'2-1-3',amount:850}},r2={...base,race:'2',closed_at:'2026-11-05 11:00:00',market_pick6_shadow:c,outcome:{result:'1-2-3',amount:2400}};
assert.ok(marketPick6Valid(r1,model));
const tampered={...r1,race:'3',market_pick6_shadow:{...c,arms:{...c.arms,blend75_top6:['6-5-4','6-5-3','6-5-2','6-5-1','6-4-5','6-4-3']}}};
const refund={...r1,race:'4',outcome:{...r1.outcome,excluded:{kind:'refund'}}};
const rep=marketPick6Report([r1,r2,tampered,refund],model);
assert.equal(rep.test_races,2);assert.deepEqual(rep.excluded,{not_settled_or_refund:1,invalid_capture:1});
assert.equal(rep.arms.market_top6.payout,850);assert.equal(rep.arms.market_top6.investment,1200);assert.equal(rep.arms.makeBets.payout,2400);assert.equal(rep.arms.base_top6.hits,1);
assert.equal(rep.contrasts.blend75_top6_minus_makeBets.profit_difference,rep.arms.blend75_top6.profit-rep.arms.makeBets.profit);
assert.equal(rep.ready_for_review,false);assert.equal(rep.production_changed,false);
console.log('market pick6 OK: four arms from the same saved snapshot, odds ordering and ties, start/odds-age/close/model guards, official-payout settlement, tamper and refund exclusion, paired contrasts');
