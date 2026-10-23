import assert from 'node:assert/strict';
import {distA,distHarville,fitA,orderingReport} from './trifecta_ordering.mjs';
const P={'1':[.5,.2,.1],'2':[.2,.3,.2],'3':[.1,.2,.2],'4':[.1,.1,.2],'5':[.05,.1,.15],'6':[.05,.1,.15]};
// A with (1,1,1) equals the normalized rank product; unequal exponents can change the order; both sum to 1.
{const d=distA(P,[1,1,1]),raw=x=>{const [i,j,k]=x.split('-');return P[i][0]*P[j][1]*P[k][2];},s=d.reduce((t,x)=>t+raw(x.combo),0);
 for(const x of d)assert.ok(Math.abs(x.prob-raw(x.combo)/s)<1e-12);
 const order=e=>[...distA(P,e)].sort((a,b)=>b.prob-a.prob).map(x=>x.combo).slice(0,10).join();
 assert.notEqual(order([1,1,1]),order([1,3,.3]));assert.ok(Math.abs(distA(P,[2,1,.5]).reduce((t,x)=>t+x.prob,0)-1)<1e-12);}
// Harville: sums to 1, uses only p1; with p1 uniform all 120 are equal.
{const d=distHarville(P);assert.ok(Math.abs(d.reduce((t,x)=>t+x.prob,0)-1)<1e-12);
 const U=Object.fromEntries('123456'.split('').map(l=>[l,[1/6,.9,.9]]));assert.ok(distHarville(U).every(x=>Math.abs(x.prob-1/120)<1e-12));}
// fitA recovers exponents from data generated with them.
{let seed=3;const rnd=()=>(seed=(seed*1103515245+12345)%2147483648)/2147483648;const true_e=[1.3,.7,1];const train=[];
 for(let n=0;n<500;n++){const Q=Object.fromEntries('123456'.split('').map(l=>[l,[rnd()+.05,rnd()+.05,rnd()+.05]]));
   const d=distA(Q,true_e);let u=rnd(),res=d.at(-1).combo;for(const x of d){u-=x.prob;if(u<=0){res=x.combo;break;}}train.push({P:Q,result:res});}
 const e=fitA(train);assert.ok(Math.abs(e[0]-1.3)<.35&&Math.abs(e[1]-.7)<.35,`fitted ${e}`);}
// Walk-forward report: window limited, fits use earlier dates only (changing later outcomes does not change earlier fits).
{const lanes='123456'.split(''),mk=(date,i,res)=>{const dist=[];for(const a of lanes)for(const b of lanes)for(const c of lanes)if(a!==b&&a!==c&&b!==c)dist.push({combo:`${a}-${b}-${c}`,prob:1/120,odds:10});
   const close=`2026-10-${date.slice(6)} 12:${String(i%60).padStart(2,'0')}:00`;
   return {cohort:'expert-shadow-official-v1',date,stadium:'1',race:String(i),closed_at:close,saved_at:new Date(Date.parse(close.replace(' ','T')+'+09:00')-600000).toISOString(),
     baseline_distribution:dist,candidate_distribution:dist,baseline_picks:dist.slice(0,6).map(x=>x.combo),candidate_picks:dist.slice(0,6).map(x=>x.combo),
     rank_probabilities:lanes.map(l=>({lane:l,p:[1/6,1/6,1/6]})),outcome:{result:res,amount:1000}};};
 const recs=[];for(const d of ['20261003','20261004','20261005'])for(let i=0;i<160;i++)recs.push(mk(d,i,i%2?'1-2-3':'4-5-6'));
 const r1=orderingReport(recs);assert.equal(r1.tested_dates,1);assert.equal(r1.fits[0].prior_races,320);
 const r2=orderingReport(recs.map(r=>r.date==='20261005'?{...r,outcome:{...r.outcome,result:'6-5-4'}}:r));assert.deepEqual(r2.fits,r1.fits);
 assert.equal(r1.production_changed,false);assert.ok(r1.max_abs_diff_A111_vs_saved_baseline<1e-12);
 // Window is fixed by calendar: dates outside 10/03-10/22 are ignored even if earlier dates are missing.
 const r3=orderingReport([...recs,...recs.map(r=>({...r,date:'20261023'})),...recs.map(r=>({...r,date:'20261002'}))]);assert.deepEqual(r3.dates_window,['20261003','20261004','20261005']);}
console.log('trifecta ordering OK: A equals the rank product at (1,1,1) and reorders otherwise, Harville from p1 only, exponent recovery, walk-forward fits use earlier dates only');
