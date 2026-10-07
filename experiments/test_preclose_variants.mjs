import assert from 'node:assert/strict';
const makeBets=(rows,n)=>{const favorite=rows.slice().sort((a,b)=>b.p[0]-a.p[0])[0].k;const all=[];for(const a of rows)for(const b of rows)for(const c of rows)if(a.k===favorite&&new Set([a.k,b.k,c.k]).size===3)all.push({combo:[a.k,b.k,c.k].join('-'),score:a.p[0]*b.p[1]*c.p[2]});return all.sort((a,b)=>b.score-a.score).slice(0,n);};
import {captureVariants,collectRevision,evaluateVariants,variantRevision,exhibitionFactors} from './preclose_variants.mjs';
const rows=[1,2,3,4,5,6].map(k=>({k:String(k),p:[k===1?.8:.2,.4/k,.3/k]}));
const race={closed_at:'2026-10-03 10:00:00',preview:{racers:Object.fromEntries(rows.map((r,i)=>[r.k,{start_timing:.05+i*.03,exhibition_time:6.7+i*.02}]))}};
const at='2026-10-03T00:50:00Z';const v=captureVariants({race,rows,makeBets,capturedAt:at});assert.equal(v.st.eligible,true);assert.equal(v.budget.confident,true);
for(const group of ['st','budget'])for(const items of Object.values(v[group].arms))assert.equal(items.reduce((s,x)=>s+x.stake,0),600);
assert.deepEqual(v.st.arms.st_25.map(x=>x.combo),makeBets(rows,6,'hit').map(x=>x.combo));assert.notDeepEqual(exhibitionFactors(race,rows,0),exhibitionFactors(race,rows,50));
const rec={saved_at:at,closed_at:race.closed_at,date:'20261003',variants:v,outcome:{result:v.budget.arms.three_equal[0].combo,amount:1500}};
const out=evaluateVariants({x:rec});assert.equal(out.arms.budget.six_equal.payout,1500);assert.equal(out.arms.budget.three_equal.payout,3000);assert.equal(out.arms.budget.confident_three_weighted.payout,4500);
const absent=structuredClone(race);delete absent.preview.racers[6].start_timing;assert.equal(captureVariants({race:absent,rows,makeBets,capturedAt:at}).st.eligible,false);
assert.throws(()=>captureVariants({race,rows,makeBets,capturedAt:'2026-10-03T01:00:00Z'}),/preclose/);
// New policies must preserve even unchanged core predictions as a preclose revision.
const base={date:'20261003',stadium:'1',race:'1',saved_at:'2026-10-03T00:49:00Z',closed_at:race.closed_at,rank_probabilities:[],expert:{},baseline_distribution:[],value_arms:{}};
const next={...base,saved_at:at,variants:v};const changed=variantRevision(base,next);assert.equal(changed.revisions.length,1);assert.equal(changed.variants.policy,v.policy);assert.equal(variantRevision({...base,outcome:{}},next).variants,undefined);
console.log('Variants passed: exact control, fixed budgets, payout units, missing ST, preclose and immutable history.');

const unchanged=variantRevision(next,{...next,saved_at:'2026-10-03T00:51:00Z',variants:{...v,captured_at:'2026-10-03T00:51:00Z'}});assert.equal(unchanged,next);
const records={bad:base},rejections=[],before=JSON.stringify(records.bad);
assert.equal(collectRevision(records,'bad',{...next,race:'2'},rejections),false);
assert.equal(JSON.stringify(records.bad),before);
assert.equal(rejections[0].key,'bad');assert.equal(rejections[0].differences.race.next,'2');
assert.equal(collectRevision(records,'good',next,rejections),true);
assert.equal(records.good.saved_at,at);assert.equal(rejections.length,1);
assert.throws(()=>collectRevision(records,'good',{...next,saved_at:'2026-10-03T01:00:00Z'},rejections),/before close/);
const finalized={...next,outcome:{result:'1-2-3',amount:1500}};
records.finalized=finalized;
collectRevision(records,'finalized',{...next,saved_at:'2026-10-03T00:51:00Z'},rejections);
assert.equal(records.finalized,finalized);
