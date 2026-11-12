// Exploration for dev/race-selection-plan.md (data saved on or before 2026-11-04 only). Writes per-race rows; summary in dev/race-selection/exploration.json.
import {loadArchive} from './walkforward_calibration.mjs';
import {auditRecord} from './shadow_diagnostics.mjs';
import fs from 'node:fs';
const closeMs=r=>Date.parse(String(r.closed_at).replace(' ','T')+'+09:00');
const R=loadArchive(new URL('../dev/expert-shadow-repaired-archive',import.meta.url).pathname);
const rows=[];const ex={};const inc=k=>ex[k]=(ex[k]||0)+1;
for(const r of R){
 if(r.date>"20261104")continue;
 if(r.cohort!=='expert-shadow-official-v1'){inc('cohort');continue;}
 if(r.cancelled||r.excluded||!r.outcome||r.outcome.excluded||!(r.outcome.amount>0)){inc('unsettled_refund');continue;}
 if(auditRecord(r).length){inc('audit');continue;}
 const at=Date.parse(r.odds_snapshot_at),sv=Date.parse(r.saved_at),d=r.baseline_distribution;
 if(!(at<=sv&&at<closeMs(r)&&sv-at<=600000&&sv<closeMs(r))||d.length!==120||d.some(x=>!(x.odds>0))){inc('odds');continue;}
 const mk=r.baseline_picks,top=[...d].sort((a,b)=>b.prob-a.prob),inv=d.reduce((s,x)=>s+1/x.odds,0);
 const P=Object.fromEntries(d.map(x=>[x.combo,x]));const mkp=mk.reduce((s,c)=>s+P[c].prob,0),mkq=mk.reduce((s,c)=>s+1/P[c].odds/inv,0);
 const hit=mk.includes(r.outcome.result);
 rows.push({date:r.date,stadium:r.stadium,race:Number(r.race),close:String(r.closed_at),hit,pay:hit?r.outcome.amount:0,
  mk_prob:mkp,mk_mkt:mkq,edge:mkp/mkq,top1:top[0].prob,top6:top.slice(0,6).reduce((s,x)=>s+x.prob,0),
  p1_lane1:(r.rank_probabilities||r.revisions?.at?.(-1)?.rank_probabilities||[]).find?.(x=>String(x.lane)==='1')?.p?.[0]??null,
  ev:mk.reduce((s,c)=>s+P[c].prob*P[c].odds,0)/6,mk_odds_med:[...mk.map(c=>P[c].odds)].sort((a,b)=>a-b)[3],takeout:1-1/inv});
}
fs.writeFileSync(process.argv[2],JSON.stringify(rows));
console.log(rows.length,ex,[...new Set(rows.map(r=>r.date))].length,rows[0]);
