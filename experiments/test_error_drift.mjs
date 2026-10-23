import assert from 'node:assert/strict';
import {pageHinkley,adwin,errorDriftReport,ERROR_DRIFT_POLICY} from './error_drift.mjs';

let seed=11;const rnd=()=>(seed=(seed*1103515245+12345)%2147483648)/2147483648;
const normal=()=>{let u=0;for(let i=0;i<12;i++)u+=rnd();return u-6;};
// A stationary loss stream (mean 4, sd 1.3 like the shadow log loss) gives no alarm over 2,000 races.
{const xs=Array.from({length:2000},()=>4+1.3*normal());assert.deepEqual(pageHinkley(xs),[]);assert.equal(adwin(xs).alarms.length,0);}
// A lasting increase of 1.0 after race 800 is detected, after the change and within 150 races; ADWIN marks it "worse".
{const xs=Array.from({length:1600},(_,i)=>4+(i>=800?1:0)+1.3*normal());
 const ph=pageHinkley(xs);assert.ok(ph.length>=1&&ph[0]>=800&&ph[0]<950,`PH ${ph}`);
 const ad=adwin(xs);assert.ok(ad.alarms.some(a=>a.index>=800&&a.index<1100&&a.direction==='worse'),JSON.stringify(ad.alarms));}
// A decrease is not a Page-Hinkley alarm (it watches for worse error only); ADWIN reports it as "better".
{const xs=Array.from({length:1600},(_,i)=>4-(i>=800?1:0)+1.3*normal());assert.deepEqual(pageHinkley(xs),[]);assert.ok(adwin(xs).alarms.every(a=>a.direction==='better'));}
// Report on synthetic shadow records: fixed and adaptive streams, venue table, no production change; ineligible records ignored.
{const combos=[];for(const a of '123456')for(const b of '123456')for(const c of '123456')if(a!==b&&a!==c&&b!==c)combos.push(`${a}-${b}-${c}`);
 const recs=[];let k=0;
 for(let day=1;day<=6;day++)for(let i=0;i<120;i++){
   const w=combos.map(()=>Math.exp(2*rnd())),s=w.reduce((a,x)=>a+x,0),dist=combos.map((c,j)=>({combo:c,prob:w[j]/s,odds:10}));
   const date=`202610${String(day).padStart(2,'0')}`,close=`2026-10-${String(day).padStart(2,'0')} ${String(8+Math.floor(i/12)).padStart(2,'0')}:${String(i%60).padStart(2,'0')}:00`;
   const picks=[...dist].sort((a,b)=>b.prob-a.prob).slice(0,6).map(x=>x.combo);
   recs.push({cohort:'expert-shadow-official-v1',date,stadium:String(1+i%6),race:String(1+Math.floor(i/6)%12),closed_at:close,saved_at:new Date(Date.parse(close.replace(' ','T')+'+09:00')-600000).toISOString(),
     baseline_distribution:dist,candidate_distribution:dist,baseline_picks:picks,candidate_picks:picks,outcome:{result:combos[Math.floor(rnd()*120)],amount:1000}});k++;
 }
 const rep=errorDriftReport([...recs,{...recs[0],excluded:{kind:'refund'}},{...recs[1],outcome:null}]);
 assert.equal(rep.races,720);assert.equal(rep.fixed.races,720);assert.equal(rep.adaptive.races,720-360);   // adaptive needs >= 300 earlier races
 assert.equal(rep.production_changed,false);assert.ok(Object.keys(rep.venues).length>0);
 assert.ok(Object.values(rep.fixed.daily_mean_log_loss).every(Number.isFinite));
 assert.equal(rep.paired.races,rep.adaptive.races);assert.ok(Number.isFinite(rep.paired.mean_diff_adaptive_minus_fixed));assert.equal(rep.paired.dates,3);}
// Paired comparison uses only races in both streams.
{const {pairedComparison}=await import('./error_drift.mjs');
 const fx=[{date:'1',stadium:'1',race:'1',loss:4},{date:'1',stadium:'1',race:'2',loss:5},{date:'2',stadium:'1',race:'1',loss:3}];
 const ad=[{date:'1',stadium:'1',race:'2',loss:4.5},{date:'2',stadium:'1',race:'1',loss:3.5},{date:'3',stadium:'1',race:'1',loss:9}];
 const p=pairedComparison(fx,ad);assert.equal(p.races,2);assert.ok(Math.abs(p.mean_diff_adaptive_minus_fixed-0)<1e-12);assert.deepEqual(p.daily_mean_diff,{'1':-.5,'2':.5});assert.equal(p.dates_adaptive_better,1);}
assert.ok(Object.isFrozen(ERROR_DRIFT_POLICY));
console.log('error drift OK: no alarm on a stationary stream, Page-Hinkley and ADWIN detect a lasting increase after it happens, decreases are not PH alarms, report with fixed/adaptive/venue streams');
