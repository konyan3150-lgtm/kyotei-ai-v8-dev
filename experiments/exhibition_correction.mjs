// Case 5: learned exhibition correction (definition fixed in dev/exhibition-correction-plan.md before implementation).
//   p'_m(i) ∝ exp(α_m log p_m(i) + β_m·x_i), m = 1st/2nd/3rd, fitted by L2-penalized maximum likelihood on earlier dates only.
//   q'(i,j,k) ∝ p'_1(i) p'_2(j) p'_3(k); six picks = top 6 of q'.
import fs from 'node:fs';
import path from 'node:path';
import {snapshots,validSnapshot,hasExhibition} from './revision_history.mjs';
import {loadArchive} from './walkforward_calibration.mjs';
import {distA} from './trifecta_ordering.mjs';

export const EX_POLICY=Object.freeze({version:'exhibition-correction-v1',window:Object.freeze({from:'20261003',to:'20261022',dates:20}),minPriorRaces:300,lambda:10,eps:1e-15,
  features:Object.freeze(['exhibition_time','start_timing','lap_time','turn_time','straight_time','entry_shift'])});
const lanes=['1','2','3','4','5','6'],combos=[];for(const a of lanes)for(const b of lanes)for(const c of lanes)if(a!==b&&a!==c&&b!==c)combos.push([a,b,c]);
const D=1+EX_POLICY.features.length;

// Within-race features per lane: z-scores of the five times with the sign flipped (smaller is better), and course - lane.
export function features(ex){
  const out=Object.fromEntries(lanes.map(l=>[l,[]]));
  for(const f of EX_POLICY.features.slice(0,5)){
    const v=lanes.map(l=>Number(ex?.[l]?.[f])),ok=v.filter(Number.isFinite);
    const mu=ok.length?ok.reduce((a,x)=>a+x,0)/ok.length:0,sd=ok.length>1?Math.sqrt(ok.reduce((a,x)=>a+(x-mu)**2,0)/ok.length):0;
    lanes.forEach((l,i)=>out[l].push(Number.isFinite(v[i])&&sd>0?-(v[i]-mu)/sd:0));
  }
  for(const l of lanes){const c=Number(ex?.[l]?.course_number);out[l].push(Number.isFinite(c)?c-Number(l):0);}
  return out;
}
const rows=(r,m)=>lanes.map(l=>[Math.log(Math.max(r.P[l][m],1e-12)),...r.X[l]]);
const softmax=(Z,th)=>{const u=Z.map(z=>z.reduce((a,x,k)=>a+x*th[k],0)),mx=Math.max(...u),e=u.map(x=>Math.exp(x-mx)),s=e.reduce((a,x)=>a+x,0);return e.map(x=>x/s);};
function solve(A,b){const n=b.length,M=A.map((r,i)=>[...r,b[i]]);for(let i=0;i<n;i++){let p=i;for(let k=i+1;k<n;k++)if(Math.abs(M[k][i])>Math.abs(M[p][i]))p=k;[M[i],M[p]]=[M[p],M[i]];
  for(let k=i+1;k<n;k++){const f=M[k][i]/M[i][i];for(let j=i;j<=n;j++)M[k][j]-=f*M[i][j];}}const x=Array(n).fill(0);for(let i=n-1;i>=0;i--){let s=M[i][n];for(let j=i+1;j<n;j++)s-=M[i][j]*x[j];x[i]=s/M[i][i];}return x;}
// Newton's method on the convex penalized negative log-likelihood (prior θ0 = [1,0,...,0]).
export function fitPosition(train,m,lambda=EX_POLICY.lambda){
  const th0=[1,...Array(D-1).fill(0)];let th=[...th0];
  for(let it=0;it<50;it++){
    const g=th.map((t,k)=>lambda*(t-th0[k])),H=th.map((_,i)=>th.map((_,j)=>i===j?lambda:0));
    for(const r of train){const Z=rows(r,m),pi=softmax(Z,th),y=lanes.indexOf(r.result.split('-')[m]),zb=Array(D).fill(0);
      Z.forEach((z,i)=>z.forEach((x,k)=>zb[k]+=pi[i]*x));for(let k=0;k<D;k++)g[k]+=zb[k]-Z[y][k];
      Z.forEach((z,i)=>{for(let a=0;a<D;a++)for(let b=0;b<D;b++)H[a][b]+=pi[i]*(z[a]-zb[a])*(z[b]-zb[b]);});}
    const step=solve(H,g);th=th.map((t,k)=>t-step[k]);if(Math.max(...step.map(Math.abs))<1e-9)break;
  }
  return th;
}
export function corrected(r,TH){
  const Pp=Object.fromEntries(lanes.map(l=>[l,[]]));
  for(let m=0;m<3;m++){const pi=softmax(rows(r,m),TH[m]);lanes.forEach((l,i)=>Pp[l][m]=pi[i]);}
  return distA(Pp,[1,1,1]);
}
const ll=(d,res)=>-Math.log(Math.max(d.find(x=>x.combo===res)?.prob||0,EX_POLICY.eps));
const top6=d=>[...d].sort((a,b)=>b.prob-a.prob||a.combo.localeCompare(b.combo)).slice(0,6).map(x=>x.combo);

export function exhibitionReport(records){
  const W=EX_POLICY.window,all=[];let noEx=0;
  for(const r of records){
    if(r.cohort!=='expert-shadow-official-v1'||r.excluded||r.cancelled||!r.outcome?.result||!(r.date>=W.from&&r.date<=W.to))continue;
    const v=snapshots(r).filter(s=>validSnapshot(s,r)&&Array.isArray(s.rank_probabilities)&&s.rank_probabilities.length===6);if(!v.length)continue;
    const s=v.at(-1);if(!hasExhibition(s)){noEx++;continue;}
    all.push({date:r.date,result:r.outcome.result,P:Object.fromEntries(s.rank_probabilities.map(x=>[String(x.lane),x.p])),X:features(s.input_state.exhibition),
      base:s.baseline_distribution,makeBets:s.baseline_picks,close:String(r.closed_at)});
  }
  all.sort((a,b)=>a.date.localeCompare(b.date)||a.close.localeCompare(b.close));
  const dates=[...new Set(all.map(r=>r.date))],names=['makeBets','base_top6','ex_top6'],hits={makeBets:0,base_top6:0,ex_top6:0},L={base:0,ex:0},S={base:0,ex:0},pairs={},fits=[],daily={};let n=0;
  const cmp=(x,y,px,py,res)=>{const k=`${x}_vs_${y}`,p=pairs[k]=pairs[k]||{changed_tickets:0,races_changed:0,only_first:0,only_second:0};const ch=py.filter(t=>!px.includes(t)).length;
    p.changed_tickets+=ch;p.races_changed+=ch>0;const hx=px.includes(res),hy=py.includes(res);if(hx&&!hy)p.only_first++;if(hy&&!hx)p.only_second++;};
  for(const date of dates){
    const prior=all.filter(r=>r.date<date),test=all.filter(r=>r.date===date);if(prior.length<EX_POLICY.minPriorRaces)continue;
    const TH=[0,1,2].map(m=>fitPosition(prior,m));fits.push({date,prior_races:prior.length,theta:TH.map(t=>t.map(x=>+x.toFixed(4)))});
    const day=daily[date]={races:test.length,makeBets:0,base_top6:0,ex_top6:0};
    for(const r of test){
      n++;const q=corrected(r,TH),picks={makeBets:r.makeBets,base_top6:top6(r.base),ex_top6:top6(q)};
      L.base+=ll(r.base,r.result);L.ex+=ll(q,r.result);
      S.base+=r.base.filter(x=>picks.base_top6.includes(x.combo)).reduce((t,x)=>t+x.prob,0);S.ex+=q.filter(x=>picks.ex_top6.includes(x.combo)).reduce((t,x)=>t+x.prob,0);
      for(const k of names){const h=picks[k].includes(r.result);hits[k]+=h;day[k]+=h;}
      cmp('base_top6','ex_top6',picks.base_top6,picks.ex_top6,r.result);cmp('makeBets','ex_top6',picks.makeBets,picks.ex_top6,r.result);
    }
  }
  return {policy:EX_POLICY,dates_window:dates,races_with_exhibition:all.length,races_without_exhibition:noEx,tested_races:n,tested_dates:Object.keys(daily).length,
    theta_order:['alpha_log_p',...EX_POLICY.features],fits,log_loss:{base:n?L.base/n:null,ex:n?L.ex/n:null},
    pick6:Object.fromEntries(names.map(k=>[k,{hits:hits[k],hit_rate:n?hits[k]/n:null}])),pick6_set_predicted:{base:n?S.base/n:null,ex:n?S.ex/n:null},pairs,daily,production_changed:false,
    interpretation:'Exploratory, fixed window 10/03-10/22 (seen in earlier exploration, not an unused evaluation), walk-forward fits on earlier dates only. McNemar is exploratory (no adjustment for within-day correlation or multiple comparisons). No adoption.'};
}

if(import.meta.url===`file://${process.argv[1]}`){
  const root=path.resolve(import.meta.dirname,'..'),out=exhibitionReport(loadArchive(path.join(root,'dev/expert-shadow-repaired-archive')));
  const W=EX_POLICY.window,expect=[];for(let d=Date.UTC(+W.from.slice(0,4),+W.from.slice(4,6)-1,+W.from.slice(6));;d+=864e5){const x=new Date(d).toISOString().slice(0,10).replace(/-/g,'');expect.push(x);if(x===W.to)break;}
  if(expect.length!==W.dates||out.dates_window.some(d=>!expect.includes(d)))throw new Error('window mismatch');
  fs.mkdirSync(path.join(root,'dev/exhibition-correction'),{recursive:true});fs.writeFileSync(path.join(root,'dev/exhibition-correction/report.json'),JSON.stringify(out,null,1)+'\n');
  const {daily,fits,...rest}=out;console.log(JSON.stringify(rest));console.log('first fit',JSON.stringify(fits[0]));console.log('last fit',JSON.stringify(fits.at(-1)));
  for(const [k,v] of Object.entries(out.pairs))console.log(k,'McNemar z',((v.only_second-v.only_first)/Math.sqrt(v.only_first+v.only_second||1)).toFixed(2));
  const d=Object.values(daily).map(x=>x.ex_top6-x.base_top6);console.log('days ex vs base more/same/fewer',d.filter(x=>x>0).length,d.filter(x=>!x).length,d.filter(x=>x<0).length);
}
