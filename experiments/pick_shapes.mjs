// Fixed before computing: six-ticket shapes from the saved pre-close distribution of the last valid shadow snapshot.
import {snapshots,validSnapshot} from './revision_history.mjs';
import {loadArchive} from './walkforward_calibration.mjs';
const marg=(d,pos)=>{const m={};for(const x of d){const k=x.combo.split('-')[pos];m[k]=(m[k]||0)+x.prob;}return Object.entries(m).sort((a,b)=>b[1]-a[1]||a[0]-b[0]).map(x=>x[0]);};
const shapes={
  current_picks:(d,s)=>s.baseline_picks,
  top6_prob:d=>[...d].sort((a,b)=>b.prob-a.prob||a.combo.localeCompare(b.combo)).slice(0,6).map(x=>x.combo),
  first_fixed_2_3_from_top3:d=>{const w=marg(d,0),a=w[0],o=w.filter(k=>k!==a).slice(0,3),out=[];for(const x of o)for(const y of o)if(x!==y)out.push(`${a}-${x}-${y}`);return out;},
  top2_exacta_both_ways_x3:d=>{const w=marg(d,0),[a,b]=w,o=w.filter(k=>k!==a&&k!==b).slice(0,3),out=[];for(const [x,y] of [[a,b],[b,a]])for(const z of o)out.push(`${x}-${y}-${z}`);return out;},
};
const acc={};let n=0;
for(const r of loadArchive(new URL('../dev/expert-shadow-repaired-archive',import.meta.url).pathname)){
  if(!r.outcome?.result||r.excluded||r.cancelled||!(r.outcome.amount>0))continue;
  const v=snapshots(r).filter(s=>validSnapshot(s,r));if(!v.length)continue;const s=v.at(-1),d=s.baseline_distribution;n++;
  for(const [k,f] of Object.entries(shapes)){const p=f(d,s);if(p.length!==6||new Set(p).size!==6)throw Error(k);const a=acc[k]=acc[k]||{hit:0,pay:0,prob:0,days:{}};
    const h=p.includes(r.outcome.result);a.hit+=h;a.pay+=h?r.outcome.amount:0;a.prob+=d.filter(x=>p.includes(x.combo)).reduce((t,x)=>t+x.prob,0);
    const dd=a.days[r.date]=a.days[r.date]||[0,0];dd[0]+=h;dd[1]++;}
}
const base=acc.current_picks;
for(const [k,a] of Object.entries(acc)){const better=Object.keys(a.days).filter(d=>a.days[d][0]>base.days[d][0]).length,worse=Object.keys(a.days).filter(d=>a.days[d][0]<base.days[d][0]).length;
  console.log(k.padEnd(28),'races',n,'hit',(a.hit/n*100).toFixed(1)+'%','model prob',(a.prob/n*100).toFixed(1)+'%','ROI(600/R)',(a.pay/(600*n)*100).toFixed(1)+'%','days better/worse vs current',better+'/'+worse);}
