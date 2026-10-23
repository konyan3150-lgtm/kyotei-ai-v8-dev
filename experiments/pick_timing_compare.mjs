// Reproducible comparison: production V8 6 picks (saved in the morning) vs the last valid repaired-shadow snapshot
// before close, on the same settled races. Usage:
//   node experiments/pick_timing_compare.mjs <production server-predictions.json> [<archive 2026xx.json> ...]
// Production files come from kyotei-ai-v8-live at a fixed SHA (git show <sha>:dev/server-predictions.json, and the
// monthly archive). The shadow archive is this repository's dev/expert-shadow-repaired-archive at its checked-out SHA.
import fs from 'node:fs';
import path from 'node:path';
import {snapshots,validSnapshot,hasExhibition} from './revision_history.mjs';
import {loadArchive} from './walkforward_calibration.mjs';
const key=(d,s,r)=>`${d}_${String(Number(s)).padStart(2,'0')}_${String(Number(r)).padStart(2,'0')}`;
export function comparePickTiming(prodRecords,shadowRecords){
  const P={};for(const r of Object.values(prodRecords))if(r?.date)P[key(r.date,r.stadium,r.race)]=r;
  const excluded={},add=k=>excluded[k]=(excluded[k]||0)+1,rows=[];
  for(const r of shadowRecords){
    const k=key(r.date,r.stadium,r.race);
    if(r.excluded||r.cancelled){add('shadow_excluded_or_cancelled');continue;}
    if(!r.outcome?.result){add('shadow_unsettled');continue;}
    const p=P[k];
    if(!p){add('no_production_record');continue;}
    if(p.excluded||p.cancelled){add('production_excluded_or_cancelled');continue;}
    if(!p.settled||!p.result){add('production_unsettled');continue;}
    if(p.result!==r.outcome.result){add('result_mismatch');continue;}
    const v=snapshots(r).filter(s=>validSnapshot(s,r));if(!v.length){add('no_valid_shadow_snapshot');continue;}
    const fin=v.at(-1),pp=p.modes?.hit?.picks||[];
    if(pp.length!==6){add('production_picks_invalid');continue;}
    rows.push({key:k,date:r.date,result:r.outcome.result,prod_hit:pp.includes(r.outcome.result),shadow_hit:fin.baseline_picks.includes(r.outcome.result),
      shared:fin.baseline_picks.filter(x=>pp.includes(x)).length,exhibition:hasExhibition(fin),initial_hit:v[0].baseline_picks.includes(r.outcome.result)});
  }
  const sum=xs=>{const n=xs.length,a=xs.filter(x=>x.prod_hit).length,b=xs.filter(x=>x.shadow_hit).length,po=xs.filter(x=>x.prod_hit&&!x.shadow_hit).length,so=xs.filter(x=>x.shadow_hit&&!x.prod_hit).length;
    const diff=(b-a)/n,se=Math.sqrt(po+so-(so-po)**2/n)/n;   // paired difference of proportions, races treated as independent
    return {races:n,production:a/n,shadow:b/n,diff_shadow_minus_production:diff,ci95_race_independent:[diff-1.96*se,diff+1.96*se],production_only:po,shadow_only:so,mean_shared_picks:n?xs.reduce((t,x)=>t+x.shared,0)/n:null};};
  return {all:sum(rows),with_exhibition:sum(rows.filter(x=>x.exhibition)),without_exhibition:sum(rows.filter(x=>!x.exhibition)),
    shadow_initial_hit_rate:rows.filter(x=>x.initial_hit).length/rows.length,dates:[...new Set(rows.map(x=>x.date))].length,excluded,keys:rows.map(x=>x.key)};
}
if(import.meta.url===`file://${process.argv[1]}`){
  const prod={};for(const f of process.argv.slice(2)){const d=JSON.parse(fs.readFileSync(f,'utf8'));Object.assign(prod,d.records||d);}
  const out=comparePickTiming(prod,loadArchive(path.join(import.meta.dirname,'../dev/expert-shadow-repaired-archive')));
  const {keys,...rest}=out;console.log(JSON.stringify(rest,null,1));
  if(process.env.KEYS_OUT)fs.writeFileSync(process.env.KEYS_OUT,keys.join('\n')+'\n');
}
