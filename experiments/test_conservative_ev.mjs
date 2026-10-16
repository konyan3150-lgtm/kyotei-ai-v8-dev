import assert from 'node:assert/strict';
import {conservativeEvCapture,conservativeEvValid,conservativeEvReport,CONSERVATIVE_EV_POLICY as P,CONSERVATIVE_ARMS} from './conservative_ev.mjs';

const combos=[];for(const a of '123456')for(const b of '123456')for(const c of '123456')if(a!==b&&a!==c&&b!==c)combos.push(`${a}-${b}-${c}`);
// Ten high-probability tickets (two pass EV, one at 60x), plus two low-probability longshots that pass EV.
const special={'1-2-3':{prob:.15,odds:10},'1-2-4':{prob:.06,odds:60},'1-3-2':{prob:.05,odds:32},'1-3-4':{prob:.05,odds:5},'1-4-2':{prob:.05,odds:5},'1-4-3':{prob:.05,odds:5},
  '2-1-3':{prob:.05,odds:5},'2-1-4':{prob:.05,odds:5},'2-3-1':{prob:.05,odds:5},'3-1-2':{prob:.04,odds:5},'5-6-4':{prob:.015,odds:120},'6-5-4':{prob:.019,odds:90}};
const rest=(1-Object.values(special).reduce((s,x)=>s+x.prob,0))/(120-Object.keys(special).length);
const dist=combos.map(c=>special[c]?{combo:c,...special[c]}:{combo:c,prob:rest,odds:20});
const base={cohort:'expert-shadow-official-v1',date:'20261017',stadium:'1',race:'1',closed_at:'2026-10-17 10:30:00',saved_at:'2026-10-17T01:00:00Z',odds_snapshot_at:'2026-10-17T00:55:00Z',
  baseline_distribution:dist,candidate_distribution:dist,baseline_picks:combos.slice(0,6),candidate_picks:combos.slice(0,6)};
base.baseline_picks=['1-2-3','1-2-4','1-3-2','1-3-4','1-4-2','1-4-3'];base.candidate_picks=base.baseline_picks;

const c=conservativeEvCapture(base),names=a=>c.arms[a].items.map(x=>x.combo).sort();
// discounted EV = p x 0.75 x odds: 1-2-4 2.70, 5-6-4 1.35, 6-5-4 1.28, 1-3-2 1.20, 1-2-3 1.125, others < 1.08
assert.deepEqual(c.arms.reference.items.map(x=>x.combo),['1-2-4','5-6-4','6-5-4','1-3-2']);   // max 4 tickets
assert.deepEqual(names('cap50'),['1-2-3','1-3-2']);                  // tickets at 50x or more removed
assert.deepEqual(names('top10'),['1-2-3','1-2-4','1-3-2']);          // low-probability longshots are outside the top 10
assert.deepEqual(names('top10_cap50'),['1-2-3','1-3-2']);            // and the 60x ticket is above the cap
assert.deepEqual(names('min_prob_2pct'),['1-2-3','1-2-4','1-3-2']);  // 1.5% and 1.9% tickets removed
for(const a of CONSERVATIVE_ARMS)assert.ok(c.arms[a].items.every(x=>x.discounted_ev>=P.min_ev&&x.stake===100)&&c.arms[a].investment===c.arms[a].items.length*100);
// Not captured before the fixed start, with stale or incomplete odds, other cohort, or a capture date different from the race date.
assert.equal(conservativeEvCapture({...base,date:'20261016',closed_at:'2026-10-16 23:50:00',saved_at:'2026-10-16T14:59:00Z',odds_snapshot_at:'2026-10-16T14:55:00Z'}),null);
assert.equal(conservativeEvCapture({...base,odds_snapshot_at:'2026-10-17T00:40:00Z'}),null);
assert.equal(conservativeEvCapture({...base,baseline_distribution:dist.map((x,i)=>i?x:{...x,odds:null})}),null);
assert.equal(conservativeEvCapture({...base,cohort:'other'}),null);
// Tampered or post-close captures are invalid.
const r={...base,conservative_ev_shadow:c,outcome:{result:'1-3-2',amount:3100}};
assert.ok(conservativeEvValid(r));
assert.equal(conservativeEvValid({...r,conservative_ev_shadow:{...c,arms:{...c.arms,top10:{items:[],investment:0}}}}),false);
assert.equal(conservativeEvValid({...r,closed_at:'2026-10-17 09:59:00'}),false);
// Report: same races for all arms, skips as 0, difference to reference, records not mutated.
const skipDist=combos.map(x=>({combo:x,prob:1/120,odds:5}));   // nothing passes EV anywhere -> every arm skips
const s={...base,race:'2',baseline_distribution:skipDist,candidate_distribution:skipDist};s.conservative_ev_shadow=conservativeEvCapture(s);s.outcome={result:'1-2-3',amount:500};
assert.equal(s.conservative_ev_shadow.arms.reference.investment,0);
const before=JSON.stringify(r),rep=conservativeEvReport({a:r,b:s});assert.equal(JSON.stringify(r),before);
assert.equal(rep.test_races,2);assert.equal(rep.ready_for_review,false);assert.equal(rep.production_changed,false);assert.equal(rep.status,'collecting_future');
const A=rep.arms;
assert.equal(A.top10_cap50.bought_races,1);assert.equal(A.top10_cap50.skipped_races,1);assert.equal(A.top10_cap50.investment,200);assert.equal(A.top10_cap50.payout,3100);
assert.equal(A.reference.profit_minus_reference,0);
assert.equal(A.top10_cap50.profit_minus_reference,(3100-200)-(3100-400));
assert.equal(A.top10_cap50.largest_payout,3100);assert.equal(A.top10_cap50.roi_without_top1,0);
assert.ok(Math.abs(A.top10_cap50.expected_hits-(.15+.05))<1e-12);
// Zero purchases are reported, not relaxed.
const zero=conservativeEvReport({b:s});for(const a of CONSERVATIVE_ARMS){assert.equal(zero.arms[a].bought_races,0);assert.equal(zero.arms[a].roi,null);}
// Policy is frozen and starts after it was fixed.
assert.ok(Object.isFrozen(P)&&Object.isFrozen(P.review));assert.ok(Date.parse(P.starts_at)>Date.parse(P.fixed_at));assert.ok(CONSERVATIVE_ARMS.includes(P.primary_arm));
console.log('conservative EV OK: fixed arms (reference, cap50, top10, top10_cap50, min_prob_2pct), start/freshness/cohort gates, re-derivable captures, same-race report with skips as 0, difference to reference, top-payout dependence, zero purchases reported');
