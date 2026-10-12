import assert from 'node:assert/strict';
import {finalOddsCapture,finalOddsReport,finalOddsValid,FINAL_ODDS_POLICY,bandRatio} from './final_odds_ev.mjs';

const combos=[];for(const a of '123456')for(const b of '123456')for(const c of '123456')if(a!==b&&a!==c&&b!==c)combos.push(`${a}-${b}-${c}`);
// discounted EV (prob x 0.75 x odds): 1-2-3 = 1.2, 1-3-2 = 1.5, 2-1-3 = 1.98, 4-5-6 = 1.2
const special={'1-2-3':{prob:.2,odds:8},'1-3-2':{prob:.05,odds:40},'2-1-3':{prob:.033,odds:80},'4-5-6':{prob:.004,odds:400}};
const remainder=(1-Object.values(special).reduce((s,x)=>s+x.prob,0))/(120-Object.keys(special).length);
const distribution=combos.map(combo=>special[combo]?{combo,...special[combo]}:{combo,prob:remainder,odds:50});
const base={cohort:'expert-shadow-official-v1',date:'20261013',stadium:'1',race:'1',closed_at:'2026-10-13 10:30:00',saved_at:'2026-10-13T01:00:00Z',odds_snapshot_at:'2026-10-13T00:55:00Z',
  baseline_distribution:distribution,candidate_distribution:structuredClone(distribution),baseline_picks:combos.slice(0,6),candidate_picks:combos.slice(0,6)};

const c=finalOddsCapture(base),names=x=>x.items.map(y=>y.combo);
// Band edges: lower bound inclusive.
assert.equal(bandRatio(9.9),1.862);assert.equal(bandRatio(10),1.364);assert.equal(bandRatio(49.9),1.082);assert.equal(bandRatio(50),.93);
assert.equal(bandRatio(499.9),.609);assert.equal(bandRatio(500),.406);assert.equal(bandRatio(100000),.406);
// Independent brute force of the same rule for every arm.
function expected({calibrate,factor,cap}){
  let d=distribution.map(x=>({...x,p:calibrate?x.prob*bandRatio(x.odds):x.prob}));const mass=d.reduce((s,x)=>s+x.p,0);d=d.map(x=>({...x,p:x.p/mass}));
  return d.filter(x=>cap==null||x.odds<cap).map(x=>({combo:x.combo,ev:x.p*.75*x.odds*factor})).filter(x=>x.ev>=1.08)
    .sort((a,b)=>b.ev-a.ev||a.combo.localeCompare(b.combo)).slice(0,4).map(x=>x.combo);
}
assert.deepEqual(names(c.arms.reference),['2-1-3','1-3-2','1-2-3','4-5-6']);
assert.deepEqual(names(c.arms.reference),expected({calibrate:false,factor:1,cap:null}));
for(const [name,spec] of Object.entries(FINAL_ODDS_POLICY.arms))assert.deepEqual(names(c.arms[name]),expected(spec),name);
assert.ok(!names(c.arms.band_cal).includes('4-5-6'));                 // 400x longshot falls below the line after calibration
assert.ok(names(c.arms.band_cal).includes('1-2-3'));                  // 8x favourite rises
assert.deepEqual(names(c.arms.final_085_cap50),['1-3-2']);            // 8x: 1.2 x 0.85 < 1.08; 80x/400x not below 50
for(const [name,a] of Object.entries(c.arms))for(const x of a.items){
  const spec=FINAL_ODDS_POLICY.arms[name]||{factor:1};
  assert.ok(Math.abs(x.expected_final_odds-x.saved_odds*spec.factor)<1e-9);
  assert.ok(Math.abs(x.discounted_ev-x.prob*.75*x.expected_final_odds)<1e-9&&x.discounted_ev>=1.08&&x.stake===100);
}
assert.ok(Object.values(c.arms).every(a=>a.investment===a.items.length*100&&a.items.length<=4));
assert.equal(JSON.stringify(base.baseline_distribution),JSON.stringify(distribution)); // input not mutated

// Gates: before start, stale odds, incomplete odds, other cohort, wrong date.
assert.equal(finalOddsCapture({...base,date:'20261012',closed_at:'2026-10-12 23:59:00',saved_at:'2026-10-12T14:59:00Z',odds_snapshot_at:'2026-10-12T14:55:00Z'}),null);
assert.equal(finalOddsCapture({...base,odds_snapshot_at:'2026-10-13T00:40:00Z'}),null);
assert.equal(finalOddsCapture({...base,baseline_distribution:distribution.map((x,i)=>i?x:{...x,odds:null})}),null);
assert.equal(finalOddsCapture({...base,baseline_distribution:distribution.map((x,i)=>i?x:{...x,prob:null})}),null);
assert.equal(finalOddsCapture({...base,cohort:'other'}),null);
assert.equal(finalOddsCapture({...base,date:'20261014'}),null);
assert.ok(finalOddsCapture({...base,date:'20261013',closed_at:'2026-10-13 00:30:00',saved_at:FINAL_ODDS_POLICY.starts_at,odds_snapshot_at:FINAL_ODDS_POLICY.starts_at}));

// Settlement with actual payouts, records not mutated.
const hit={...base,final_odds_shadow:c,outcome:{result:'2-1-3',amount:5600}};
const before=JSON.stringify(hit),rep=finalOddsReport({a:hit});assert.equal(JSON.stringify(hit),before);
assert.equal(rep.test_races,1);assert.equal(rep.ready_for_review,false);assert.equal(rep.production_changed,false);
assert.equal(rep.arms.reference.payout,5600);assert.equal(rep.arms.reference.investment,400);assert.equal(rep.arms.reference.roi,14);
assert.equal(rep.arms.reference.winning_final_to_saved_median,0.7);assert.equal(rep.arms.final_085_cap50.hits,0);assert.equal(rep.arms.final_085_cap50.winning_final_to_saved_median,null);
assert.equal(rep.arms.band_cal.hits,names(c.arms.band_cal).includes('2-1-3')?1:0);
const miss={...base,race:'2',final_odds_shadow:finalOddsCapture({...base,race:'2'}),outcome:{result:'4-5-6',amount:40000}};
const two=finalOddsReport({a:hit,b:miss});
assert.equal(two.arms.reference.payout,45600);assert.equal(two.arms.band_cal.payout,names(c.arms.band_cal).includes('2-1-3')?5600:0);assert.equal(two.arms.reference.largest_payout,40000);

// Tampered, post-close, cancelled, excluded, missing captures are not counted.
for(const change of [x=>delete x.final_odds_shadow,x=>x.final_odds_shadow.arms.band_cal.items=[],x=>x.final_odds_shadow.version='bad',x=>x.cancelled=true,x=>x.excluded={reason:'refund'},
  x=>{x.closed_at='2026-10-13 09:59:00'},x=>x.baseline_distribution[0].odds=99]){const bad=structuredClone(hit);change(bad);assert.equal(finalOddsReport({bad}).test_races,0);}
for(const outcome of [{result:'1-1-2',amount:100},{result:'bad',amount:100},{result:'1-2-3',amount:0},{result:'1-2-3',amount:1.5},{excluded:true,result:'1-2-3',amount:100}])assert.equal(finalOddsReport({bad:{...hit,outcome}}).test_races,0);

// No ticket under the cap with otherwise valid input: counted as a skip, report does not stop (ChatGPT review 2026-10-12).
const flat=structuredClone(base);for(const x of flat.baseline_distribution){x.prob=1/120;x.odds=80;}
const flatBefore=JSON.stringify(flat),fc=finalOddsCapture(flat);
assert.ok(fc);assert.deepEqual(fc.arms.final_085_cap50,{items:[],investment:0});assert.equal(JSON.stringify(flat),flatBefore);
assert.equal(fc.arms.reference.items.length,0);                         // 1/120 x 0.75 x 80 = 0.5 < 1.08
const flatRec={...flat,final_odds_shadow:fc,outcome:{result:'1-2-3',amount:8000}},flatRecBefore=JSON.stringify(flatRec);
const flatRep=finalOddsReport({flat:flatRec});assert.equal(JSON.stringify(flatRec),flatRecBefore);
assert.equal(flatRep.test_races,1);
const capArm=flatRep.arms.final_085_cap50;
assert.equal(capArm.investment,0);assert.equal(capArm.payout,0);assert.equal(capArm.skipped_races,1);assert.equal(capArm.bought_races,0);assert.equal(capArm.roi,null);
// Mixing a skipped-cap race with a normal race leaves the other arms' results unchanged.
const mixed=finalOddsReport({a:hit,flat:flatRec});
for(const name of ['reference','band_cal','band_cal_final085'])assert.equal(mixed.arms[name].payout,rep.arms[name].payout,name);
assert.equal(mixed.arms.final_085_cap50.skipped_races,1+rep.arms.final_085_cap50.skipped_races);
// Invalid inputs are still rejected, and a stored null/malformed arm is not counted.
assert.equal(finalOddsCapture({...flat,odds_snapshot_at:'2026-10-13T00:40:00Z'}),null);
assert.equal(finalOddsCapture({...flat,baseline_distribution:flat.baseline_distribution.map((x,i)=>i?x:{...x,odds:0})}),null);
assert.equal(finalOddsCapture({...flat,baseline_distribution:flat.baseline_distribution.slice(1)}),null);
for(const broken of [null,{investment:0},{items:null,investment:0},{items:[]}]){const bad=structuredClone(flatRec);bad.final_odds_shadow.arms.final_085_cap50=broken;
  assert.doesNotThrow(()=>finalOddsReport({bad}));assert.equal(finalOddsReport({bad}).test_races,0);}

// Policy is frozen and ready only after 5 dates and 150 races.
assert.ok(Object.isFrozen(FINAL_ODDS_POLICY)&&Object.isFrozen(FINAL_ODDS_POLICY.arms)&&Object.isFrozen(FINAL_ODDS_POLICY.band_ratios)&&Object.values(FINAL_ODDS_POLICY.arms).every(Object.isFrozen));
assert.deepEqual(FINAL_ODDS_POLICY.band_ratios,[1.862,1.364,1.082,.93,.609,.406]);assert.deepEqual(Object.keys(FINAL_ODDS_POLICY.arms),['band_cal','band_cal_final085','final_085_cap50']);
const ready={};for(let d=13;d<18;d++)for(let i=0;i<30;i++){const s={...base,date:`202610${d}`,race:String(i+1),saved_at:`2026-10-${d}T01:00:00Z`,odds_snapshot_at:`2026-10-${d}T00:55:00Z`,closed_at:`2026-10-${d} 10:30:00`};
  ready[`${d}_${i}`]={...s,final_odds_shadow:finalOddsCapture(s),outcome:hit.outcome};}
assert.equal(finalOddsReport(ready).ready_for_review,true);delete ready['13_0'];assert.equal(finalOddsReport(ready).ready_for_review,false);
console.log('Final-odds EV passed: fixed band ratios and factors on unchanged EV rule, start gate, stale/incomplete odds rejected, actual payouts, immutable records, tampering and post-close captures rejected');
