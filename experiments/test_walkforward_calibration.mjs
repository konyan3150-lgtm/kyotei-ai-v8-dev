import assert from 'node:assert/strict';
import {applyTemperature,fitTemperature,fitPlatt,fitIsotonic,raceMetrics,ece,walkForward,WF_POLICY} from './walkforward_calibration.mjs';

// Deterministic synthetic races: 120 combinations, a "true" distribution, the model reports it sharpened (t=0.5).
const combos=[];for(let a=1;a<=6;a++)for(let b=1;b<=6;b++)for(let c=1;c<=6;c++)if(a!==b&&b!==c&&a!==c)combos.push(`${a}-${b}-${c}`);
let seed=7;const rnd=()=>(seed=(seed*1103515245+12345)%2147483648)/2147483648;
function race(date,i,{sharpen=.5}={}){
  const w=combos.map(()=>Math.exp(3*rnd()));const s=w.reduce((a,x)=>a+x,0);
  const truth=combos.map((c,k)=>({combo:c,prob:w[k]/s}));
  let u=rnd(),res=truth[119].combo;for(const x of truth){u-=x.prob;if(u<=0){res=x.combo;break;}}
  const model=applyTemperature(truth,sharpen).map(x=>({...x,odds:Math.max(1.1,Math.round(0.75/truth.find(t=>t.combo===x.combo).prob*10)/10)}));
  const close=`${date.slice(0,4)}-${date.slice(4,6)}-${date.slice(6)} 12:${String(i%60).padStart(2,'0')}:00`;
  return {cohort:'expert-shadow-official-v1',date,stadium:String(1+i%24).padStart(2,'0'),race:String(1+i%12),closed_at:close,
    saved_at:new Date(Date.parse(close.replace(' ','T')+'+09:00')-600000).toISOString(),odds_snapshot_at:new Date(Date.parse(close.replace(' ','T')+'+09:00')-660000).toISOString(),
    baseline_distribution:model,baseline_picks:[...model].sort((a,b)=>b.prob-a.prob).slice(0,6).map(x=>x.combo),
    candidate_distribution:model,candidate_picks:[...model].sort((a,b)=>b.prob-a.prob).slice(0,6).map(x=>x.combo),
    outcome:{result:res,amount:1000}};
}

// Temperature: recovers the sharpening (true t = 1/0.5 = 2) from enough races.
{const rs=[];for(let i=0;i<600;i++)rs.push(race('20261001',i));const {t}=fitTemperature(rs);assert.ok(t>1.6&&t<2.5,`t=${t}`);}
// applyTemperature keeps a distribution; t=1 is identity.
{const r=race('20261001',1);const d=applyTemperature(r.baseline_distribution,1);d.forEach((x,i)=>assert.ok(Math.abs(x.prob-r.baseline_distribution[i].prob)<1e-12));
 assert.ok(Math.abs(applyTemperature(r.baseline_distribution,2).reduce((s,x)=>s+x.prob,0)-1)<1e-12);}
// Platt and isotonic: valid distributions, isotonic is monotone in the input probability.
{const rs=[];for(let i=0;i<300;i++)rs.push(race('20261001',i));const P=fitPlatt(rs),I=fitIsotonic(rs),d=rs[0].baseline_distribution;
 for(const f of [P,I]){const c=f.apply(d);assert.equal(c.length,120);assert.ok(Math.abs(c.reduce((s,x)=>s+x.prob,0)-1)<1e-9);assert.ok(c.every(x=>x.prob>0));}
 const sorted=[...d].sort((a,b)=>a.prob-b.prob),c=new Map(I.apply(d).map(x=>[x.combo,x.prob]));for(let i=1;i<sorted.length;i++)assert.ok(c.get(sorted[i].combo)>=c.get(sorted[i-1].combo)-1e-15);
 assert.ok(P.a<1,'sharpened inputs need a<1');}
// Metrics: log loss / Brier / top-k on a known case; ECE of a perfectly calibrated bin is 0.
{const d=combos.map((c,i)=>({combo:c,prob:i===0?.5:.5/119}));const m=raceMetrics(d,combos[0]);
 assert.ok(Math.abs(m.log_loss-Math.log(2))<1e-12);assert.equal(m.top1,1);assert.equal(m.top6,1);
 assert.ok(Math.abs(m.brier-(.25+119*(.5/119)**2))<1e-12);
 assert.ok(ece([[.3,1],[.3,0],[.3,0],[.3,0],[.3,1],[.3,0],[.3,0],[.3,0],[.3,1],[.3,0]]).ece<1e-12);}
// Walk-forward: warm-up until MIN_PRIOR_RACES, then each date uses only earlier dates.
{const rs=[];let i=0;for(const d of ['20261001','20261002','20261003','20261004'])for(let k=0;k<160;k++)rs.push(race(d,i++));
 const out=walkForward(rs);assert.equal(out.daily[0].status,'warm_up');assert.equal(out.daily[1].status,'warm_up');
 assert.equal(out.generated_from.first_test_date,'20261003');assert.equal(out.fits[0].prior_races,320);
 // Leakage guard: changing the outcomes of the last date does not change any fit used before it.
 const changed=rs.map(r=>r.date==='20261004'?{...r,outcome:{...r.outcome,result:combos[0]}}:r);
 const out2=walkForward(changed);assert.deepEqual(out2.fits.map(f=>f.temperature).slice(0,2),out.fits.map(f=>f.temperature).slice(0,2));
 for(const m of WF_POLICY.methods)assert.equal(out.summary[m].races,320);
 // Excluded / unsettled / invalid records are not used.
 const out3=walkForward([...rs,{...rs[0],excluded:{kind:'refund'}},{...rs[1],outcome:null},{...rs[2],baseline_distribution:rs[2].baseline_distribution.slice(1)}]);
 assert.equal(out3.generated_from.eligible_races,rs.length);}

// Isotonic with tied probabilities: aggregated before PAV, so the order of races and of tied tickets does not matter.
{const levels=[.001,.002,.004,.008,.016,.03];   // few distinct values -> many ties; races normalized to sum 1
 const mk=(i)=>{const raw=combos.map((c,k)=>levels[(k*7+i*3)%levels.length]),s=raw.reduce((a,x)=>a+x,0);
   return {date:'20261001',baseline_distribution:combos.map((c,k)=>({combo:c,prob:raw[k]/s})),outcome:{result:combos[(i*53+11)%120]}};};
 const rs=[];for(let i=0;i<10;i++)rs.push(mk(i));
 const shuffle=(a,seed)=>{const b=[...a];let x=seed;for(let i=b.length-1;i>0;i--){x=(x*1103515245+12345)%2147483648;const j=x%(i+1);[b[i],b[j]]=[b[j],b[i]];}return b;};
 const base=fitIsotonic(rs),probe=rs[0].baseline_distribution;
 const variants=[[...rs].reverse(),shuffle(rs,3),rs.map(r=>({...r,baseline_distribution:[...r.baseline_distribution].reverse()})),shuffle(rs,9).map(r=>({...r,baseline_distribution:shuffle(r.baseline_distribution,5)}))];
 for(const v of variants){const a=base.apply(probe),b=fitIsotonic(v).apply(probe);assert.ok(Math.max(...a.map((x,i)=>Math.abs(x.prob-b.find(y=>y.combo===x.combo).prob)))<1e-15,'order changed the isotonic fit');}
 // Aggregated value of a tied probability = hits / count when it is its own block (no pooling needed).
 const tied=new Map();for(const r of rs)for(const x of r.baseline_distribution){const t=tied.get(x.prob)||{y:0,w:0};t.y+=Number(x.combo===r.outcome.result);t.w++;tied.set(x.prob,t);}
 assert.equal(base.distinct_inputs,tied.size);
 const xs=[...tied.keys()].sort((a,b)=>a-b);let prev=-1;for(const x of xs){const v=base.map(x);assert.ok(Number.isFinite(v)&&v>=prev-1e-15,'monotone, finite');prev=v;}
 const c=base.apply(probe);assert.equal(c.length,120);assert.ok(Math.abs(c.reduce((s,x)=>s+x.prob,0)-1)<1e-12);assert.ok(c.every(x=>Number.isFinite(x.prob)&&x.prob>0));}
// A single tied group with mixed labels gets exactly hits/count (before the floor).
{const rs=[0,1,2,3].map(i=>({baseline_distribution:combos.map(c=>({combo:c,prob:1/120})),outcome:{result:combos[i]}}));
 const I=fitIsotonic(rs);assert.equal(I.blocks,1);assert.ok(Math.abs(I.map(1/120)-4/480)<1e-15);}
console.log('walk-forward calibration OK: isotonic order-invariant with tied probabilities (aggregated before weighted PAV),  temperature recovery, Platt/isotonic validity and monotonicity, metrics, warm-up, prior-dates-only fits (no leakage from later outcomes), eligibility filter');
