// Case 3: trifecta construction (definitions fixed in dev/trifecta-ordering-plan.md before implementation).
//   base  q(i,j,k) ∝ p1(i) p2(j) p3(k)                       (the saved baseline distribution)
//   A     q(i,j,k) ∝ p1(i)^a p2(j)^b p3(k)^c                  (a,b,c by maximum likelihood on earlier dates only)
//   B     Harville from p1 only: p1(i) p1(j)/(1-p1(i)) p1(k)/(1-p1(i)-p1(j))
// Walk-forward inside the first 20 dates; six picks: saved baseline_picks (makeBets), top 6 of base, top 6 of A / B.
import fs from 'node:fs';
import path from 'node:path';
import {snapshots,validSnapshot} from './revision_history.mjs';
import {loadArchive} from './walkforward_calibration.mjs';

export const ORDER_POLICY=Object.freeze({version:'trifecta-ordering-v1',maxDates:20,minPriorRaces:300,range:[0.25,4],eps:1e-15});
const lanes=['1','2','3','4','5','6'],combos=[];for(const a of lanes)for(const b of lanes)for(const c of lanes)if(a!==b&&a!==c&&b!==c)combos.push([a,b,c]);
const rp=s=>Object.fromEntries(s.rank_probabilities.map(x=>[String(x.lane),x.p]));
export function distA(P,[a,b,c]){
  const w=combos.map(([i,j,k])=>Math.max(P[i][0],1e-12)**a*Math.max(P[j][1],1e-12)**b*Math.max(P[k][2],1e-12)**c),s=w.reduce((t,x)=>t+x,0);
  return combos.map(([i,j,k],n)=>({combo:`${i}-${j}-${k}`,prob:w[n]/s}));
}
export function distHarville(P){
  const p=Object.fromEntries(lanes.map(l=>[l,Math.max(P[l][0],1e-12)])),t=lanes.reduce((s,l)=>s+p[l],0);for(const l of lanes)p[l]/=t;
  const out=combos.map(([i,j,k])=>({combo:`${i}-${j}-${k}`,prob:p[i]*p[j]/Math.max(1-p[i],1e-12)*p[k]/Math.max(1-p[i]-p[j],1e-12)})),s=out.reduce((t,x)=>t+x.prob,0);
  return out.map(x=>({...x,prob:x.prob/s}));
}
const ll=(d,res)=>-Math.log(Math.max(d.find(x=>x.combo===res)?.prob||0,ORDER_POLICY.eps));
// Coordinate-wise golden-section search on log exponents (3 rounds), maximizing likelihood on the training races.
export function fitA(train){
  const f=e=>train.reduce((t,r)=>t+ll(distA(r.P,e),r.result),0);
  let e=[1,1,1];const lo=Math.log(ORDER_POLICY.range[0]),hi=Math.log(ORDER_POLICY.range[1]),g=(Math.sqrt(5)-1)/2;
  for(let round=0;round<3;round++)for(let d=0;d<3;d++){
    let a=lo,b=hi,c=b-g*(b-a),x=a+g*(b-a);const at=v=>{const t=[...e];t[d]=Math.exp(v);return f(t);};let fc=at(c),fx=at(x);
    for(let i=0;i<30;i++){if(fc<fx){b=x;x=c;fx=fc;c=b-g*(b-a);fc=at(c);}else{a=c;c=x;fc=fx;x=a+g*(b-a);fx=at(x);}}
    e[d]=Math.exp((a+b)/2);
  }
  return e;
}
const top6=d=>[...d].sort((a,b)=>b.prob-a.prob||a.combo.localeCompare(b.combo)).slice(0,6).map(x=>x.combo);

export function orderingReport(records){
  const rs=[];
  for(const r of records){
    if(r.cohort!=='expert-shadow-official-v1'||r.excluded||r.cancelled||!r.outcome?.result)continue;
    const v=snapshots(r).filter(s=>validSnapshot(s,r)&&Array.isArray(s.rank_probabilities)&&s.rank_probabilities.length===6);if(!v.length)continue;
    const s=v.at(-1);rs.push({date:r.date,result:r.outcome.result,P:rp(s),base:s.baseline_distribution,makeBets:s.baseline_picks,close:String(r.closed_at)});
  }
  rs.sort((a,b)=>a.date.localeCompare(b.date)||a.close.localeCompare(b.close));
  const dates=[...new Set(rs.map(r=>r.date))].slice(0,ORDER_POLICY.maxDates),win=new Set(dates),R=rs.filter(r=>win.has(r.date));
  const names=['makeBets','base_top6','A_top6','B_top6'],acc=Object.fromEntries(['base','A','B'].map(k=>[k,{ll:0,set_prob:0}])),hits=Object.fromEntries(names.map(k=>[k,0]));
  const pair={},fits=[],daily={};let n=0;
  const cmp=(x,y,picksX,picksY,res)=>{const k=`${x}_vs_${y}`,p=pair[k]=pair[k]||{changed_tickets:0,races_changed:0,only_first:0,only_second:0};const ch=picksY.filter(t=>!picksX.includes(t)).length;
    p.changed_tickets+=ch;p.races_changed+=ch>0;const hx=picksX.includes(res),hy=picksY.includes(res);if(hx&&!hy)p.only_first++;if(hy&&!hx)p.only_second++;};
  for(const date of dates){
    const prior=R.filter(r=>r.date<date),test=R.filter(r=>r.date===date);
    if(prior.length<ORDER_POLICY.minPriorRaces)continue;
    const e=fitA(prior);fits.push({date,a:e[0],b:e[1],c:e[2],prior_races:prior.length});
    const day=daily[date]={races:test.length,makeBets:0,base_top6:0,A_top6:0,B_top6:0};
    for(const r of test){
      n++;const dA=distA(r.P,e),dB=distHarville(r.P),picks={makeBets:r.makeBets,base_top6:top6(r.base),A_top6:top6(dA),B_top6:top6(dB)};
      for(const [k,d] of [['base',r.base],['A',dA],['B',dB]]){acc[k].ll+=ll(d,r.result);}
      for(const [k,d,p] of [['base',r.base,picks.base_top6],['A',dA,picks.A_top6],['B',dB,picks.B_top6]])acc[k].set_prob+=d.filter(x=>p.includes(x.combo)).reduce((t,x)=>t+x.prob,0);
      for(const k of names){const h=picks[k].includes(r.result);hits[k]+=h;day[k]+=h;}
      for(const [x,y] of [['makeBets','A_top6'],['makeBets','B_top6'],['base_top6','A_top6'],['base_top6','B_top6']])cmp(x,y,picks[x],picks[y],r.result);
    }
  }
  return {policy:ORDER_POLICY,dates_window:dates,tested_races:n,tested_dates:Object.keys(daily).length,fits,
    log_loss:Object.fromEntries(Object.entries(acc).map(([k,v])=>[k,n?v.ll/n:null])),
    pick6:Object.fromEntries(names.map(k=>[k,{hit_rate:n?hits[k]/n:null,hits:hits[k]}])),
    pick6_set_predicted:Object.fromEntries(Object.entries(acc).map(([k,v])=>[k,n?v.set_prob/n:null])),
    pairs:pair,daily,production_changed:false,
    interpretation:'Exploratory, first 20 dates only, walk-forward (fits on earlier dates only). No method is adopted from this.'};
}

if(import.meta.url===`file://${process.argv[1]}`){
  const root=path.resolve(import.meta.dirname,'..'),out=orderingReport(loadArchive(path.join(root,'dev/expert-shadow-repaired-archive')));
  fs.mkdirSync(path.join(root,'dev/trifecta-ordering'),{recursive:true});fs.writeFileSync(path.join(root,'dev/trifecta-ordering/report.json'),JSON.stringify(out,null,1)+'\n');
  const {daily,...rest}=out;console.log(JSON.stringify({...rest,fits:out.fits.map(f=>[f.date,+f.a.toFixed(3),+f.b.toFixed(3),+f.c.toFixed(3)])},null,0));
}
