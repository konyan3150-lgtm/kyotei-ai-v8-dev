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
console.log('walk-forward calibration OK: temperature recovery, Platt/isotonic validity and monotonicity, metrics, warm-up, prior-dates-only fits (no leakage from later outcomes), eligibility filter');
