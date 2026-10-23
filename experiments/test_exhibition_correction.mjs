import assert from 'node:assert/strict';
import {features,fitPosition,corrected,exhibitionReport} from './exhibition_correction.mjs';
import {distA} from './trifecta_ordering.mjs';
const lanes='123456'.split('');let seed=11;const rnd=()=>(seed=(seed*1103515245+12345)%2147483648)/2147483648;
// Features: sign flipped (fastest exhibition time gets the largest value), missing -> 0, entry shift = course - lane.
{const ex=Object.fromEntries(lanes.map((l,i)=>[l,{exhibition_time:6.7+i*.02,start_timing:null,lap_time:37,course_number:l==='2'?1:Number(l)}]));const X=features(ex);
 assert.ok(X['1'][0]>X['6'][0]);assert.equal(X['1'][1],0);assert.equal(X['1'][2],0);assert.equal(X['2'][5],-1);assert.equal(X['3'][5],0);}
// θ = [1,0,..] reproduces the saved rank-product distribution.
const mkP=()=>{const P={};for(const l of lanes)P[l]=[0,0,0];for(let m=0;m<3;m++){const w=lanes.map(()=>rnd()+.05),s=w.reduce((a,x)=>a+x,0);lanes.forEach((l,i)=>P[l][m]=w[i]/s);}return P;};
{const P=mkP(),X=Object.fromEntries(lanes.map(l=>[l,[rnd(),rnd(),0,0,0,0]])),id=[1,0,0,0,0,0,0];const a=corrected({P,X},[id,id,id]),b=distA(P,[1,1,1]);
 a.forEach((x,i)=>assert.ok(Math.abs(x.prob-b[i].prob)<1e-12));}
// Recovers a planted exhibition effect on the winner.
{const train=[];for(let n=0;n<1500;n++){const P=mkP(),X=Object.fromEntries(lanes.map(l=>[l,[rnd()*2-1,0,0,0,0,0]]));
  const u=lanes.map(l=>Math.log(P[l][0])+1.5*X[l][0]),mx=Math.max(...u),e=u.map(x=>Math.exp(x-mx)),s=e.reduce((a,x)=>a+x,0);let r=rnd(),w=lanes[5];for(let i=0;i<6;i++){r-=e[i]/s;if(r<=0){w=lanes[i];break;}}
  const rest=lanes.filter(l=>l!==w);train.push({P,X,result:`${w}-${rest[0]}-${rest[1]}`});}
 const th=fitPosition(train,0,1);assert.ok(Math.abs(th[1]-1.5)<.3&&Math.abs(th[0]-1)<.2,`theta ${th}`);}
// Walk-forward: later outcomes do not change earlier fits; dates outside the window and races without exhibition are not used.
{const combos=[];for(const a of lanes)for(const b of lanes)for(const c of lanes)if(a!==b&&a!==c&&b!==c)combos.push(`${a}-${b}-${c}`);
 const mk=(date,i,res,withEx=true)=>{const P=mkP(),close=`2026-10-${date.slice(6)} 12:${String(i%60).padStart(2,'0')}:00`,dist=distA(P,[1,1,1]);
  return {cohort:'expert-shadow-official-v1',date,stadium:'1',race:String(i),closed_at:close,saved_at:new Date(Date.parse(close.replace(' ','T')+'+09:00')-600000).toISOString(),
   baseline_distribution:dist.map(x=>({...x,odds:10})),candidate_distribution:dist,baseline_picks:dist.slice(0,6).map(x=>x.combo),candidate_picks:dist.slice(0,6).map(x=>x.combo),
   rank_probabilities:lanes.map(l=>({lane:l,p:P[l]})),input_state:{exhibition:withEx?Object.fromEntries(lanes.map(l=>[l,{exhibition_time:6.7+rnd()*.2,start_timing:rnd()*.2,course_number:Number(l)}])):{}},outcome:{result:res,amount:1000}};};
 const recs=[];for(const d of ['20261003','20261004','20261005'])for(let i=0;i<160;i++)recs.push(mk(d,i,combos[(i*37)%120]));
 const extra=[mk('20261002',1,combos[0]),mk('20261023',1,combos[0]),mk('20261004',999,combos[0],false)];
 const r1=exhibitionReport([...recs,...extra]);assert.deepEqual(r1.dates_window,['20261003','20261004','20261005']);assert.equal(r1.races_without_exhibition,1);assert.equal(r1.tested_dates,1);
 const r2=exhibitionReport(recs.map(r=>r.date==='20261005'?{...r,outcome:{...r.outcome,result:combos[5]}}:r));assert.deepEqual(r2.fits,r1.fits);assert.equal(r1.production_changed,false);}
console.log('exhibition correction OK: features, identity at θ0, planted-effect recovery, prior-dates-only fits, fixed window, races without exhibition excluded');
