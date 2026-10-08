import assert from 'node:assert/strict';
import {robustEvCapture,robustEvReport,ROBUST_EV_POLICY} from './robust_ev.mjs';
const d=[{combo:'1-2-3',prob:.1},{combo:'1-3-2',prob:.1}],odds=[{combo:'1-2-3',odds:16},{combo:'1-3-2',odds:20}];
const at='2026-10-21T00:55:00Z',saved='2026-10-21T01:00:00Z';
const bundle=robustEvCapture(d,odds,at,saved);
assert.equal(bundle.reference.investment,200);assert.equal(bundle.conservative.investment,100);assert.equal(bundle.conservative.items[0].combo,'1-3-2');
assert.equal(robustEvCapture(d,odds,'2026-10-21T00:00:00Z',saved),null);
assert.equal(robustEvCapture(d,odds,'2026-10-08T14:20:00Z','2026-10-08T14:29:00Z'),null);
const r={date:'20261021',stadium:'1',race:'1',closed_at:'2026-10-21 11:00:00',saved_at:saved,odds_snapshot_at:at,baseline_distribution:odds,odds_calibration_shadow:{distribution:d,robust_ev:bundle},outcome:{result:'1-3-2',amount:1800}};
const before=JSON.stringify(r),report=robustEvReport([r]);assert.equal(JSON.stringify(r),before);
assert.equal(report.arms.reference.payout,1800);assert.equal(report.arms.conservative.payout,1800);assert.equal(report.arms.conservative.roi,18);assert.equal(report.ready_for_review,false);
const skip=structuredClone(r);skip.odds_calibration_shadow.distribution=d.map(x=>({...x,prob:.001}));skip.odds_calibration_shadow.robust_ev=robustEvCapture(skip.odds_calibration_shadow.distribution,odds,at,saved);
const paired=robustEvReport([r,skip]);assert.equal(paired.test_races,2);assert.equal(paired.arms.conservative.skipped_races,1);assert.equal(paired.arms.conservative.risk.max_consecutive_misses,0);
for(const change of [x=>delete x.odds_calibration_shadow.robust_ev,x=>x.cancelled=true,x=>x.excluded={reason:'refund'},x=>x.odds_calibration_shadow.robust_ev.conservative.items[0].stake=200,x=>x.odds_calibration_shadow.robust_ev.version='bad']){const bad=structuredClone(r);change(bad);assert.equal(robustEvReport([bad]).test_races,0);}
assert.equal(ROBUST_EV_POLICY.probability_factor,.9);assert.equal(ROBUST_EV_POLICY.odds_factor,.9);
console.log('Robust EV passed: fixed stress assumptions, threshold filtering, actual payouts, paired skips, immutable records, no missing-capture retrofits, stale odds and corruption rejected');
