// Case 5 follow-up (definition fixed in dev/exhibition-ablation-plan.md before implementation).
//   ① current model (saved rank probabilities), ② same with the exhibition-measurement factor removed (p / ef),
//   ③ exhibition-correction-v1 from PR #50 (unchanged). Same races, same pre-close snapshot.
import fs from 'node:fs';
import path from 'node:path';
import {snapshots,validSnapshot,hasExhibition} from './revision_history.mjs';
import {loadArchive} from './walkforward_calibration.mjs';
import {distA} from './trifecta_ordering.mjs';
import {features,fitPosition,corrected,EX_POLICY} from './exhibition_correction.mjs';
import {exhibitionFactors,engineMakeBets} from './engine_8286a978_excerpt.mjs';

export const ABL_POLICY=Object.freeze({version:'exhibition-ablation-v1',window:EX_POLICY.window,minPriorRaces:EX_POLICY.minPriorRaces,eps:1e-15});
const lanes=['1','2','3','4','5','6'],closeMs=r=>Date.parse(String(r.closed_at).replace(' ','T')+'+09:00');
// Exhibition factor exactly as the frozen engine computes it, from the snapshot's observed exhibition only.
export function exFactor(exhibition){
  const r={racers:Object.fromEntries(lanes.map(l=>[l,{}])),preview:{racers:exhibition||{}}},rows=lanes.map(k=>({k}));
  return Object.fromEntries(lanes.map((l,i)=>[l,exhibitionFactors(r,rows)[i]]));
}
export const removeEx=(P,ef)=>Object.fromEntries(lanes.map(l=>[l,P[l].map(v=>v/ef[l])]));
const rowsOf=P=>lanes.map(k=>({k,p:P[k]}));
const ll=(d,res)=>-Math.log(Math.max(d.find(x=>x.combo===res)?.prob||0,ABL_POLICY.eps));
const top6=d=>[...d].sort((a,b)=>b.prob-a.prob||a.combo.localeCompare(b.combo)).slice(0,6).map(x=>x.combo);

export function ablationReport(records){
  const W=ABL_POLICY.window,all=[],excl={not_settled_or_excluded:0,outside_window:0,no_valid_snapshot:0,incomplete_exhibition:0},bias={incomplete_exhibition:{races:0,hits:0},warm_up:{races:0,hits:0}};
  const prov={snapshot_before_close:0,official_preview_at_recorded:0,official_preview_at_before_saved:0,original_exhibition_at_recorded:0,original_exhibition_at_before_saved:0,lead_minutes:{'0-5':0,'5-10':0,'10-15':0,'15-20':0}};
  for(const r of records){
    if(r.cohort!=='expert-shadow-official-v1')continue;
    if(r.excluded||r.cancelled||!r.outcome?.result){excl.not_settled_or_excluded++;continue;}
    if(!(r.date>=W.from&&r.date<=W.to)){excl.outside_window++;continue;}
    const v=snapshots(r).filter(s=>validSnapshot(s,r)&&Array.isArray(s.rank_probabilities)&&s.rank_probabilities.length===6);if(!v.length){excl.no_valid_snapshot++;continue;}
    const s=v.at(-1);
    if(!hasExhibition(s)){excl.incomplete_exhibition++;bias.incomplete_exhibition.races++;bias.incomplete_exhibition.hits+=top6(s.baseline_distribution).includes(r.outcome.result);continue;}
    all.push({r,s,date:r.date,result:r.outcome.result,P:Object.fromEntries(s.rank_probabilities.map(x=>[String(x.lane),x.p])),X:features(s.input_state.exhibition),close:String(r.closed_at)});
  }
  all.sort((a,b)=>a.date.localeCompare(b.date)||a.close.localeCompare(b.close));
  const dates=[...new Set(all.map(x=>x.date))],M=['m1','m2','m3'],hits={m1:0,m2:0,m3:0,mb1:0,mb2:0},L={m1:0,m2:0,m3:0},pairs={},daily={},mbRepro={checked:0,reproduced:0};let n=0,nMb=0;
  const cmp=(k,px,py,res)=>{const p=pairs[k]=pairs[k]||{races:0,changed_tickets:0,races_changed:0,only_first:0,only_second:0};p.races++;const ch=py.filter(t=>!px.includes(t)).length;
    p.changed_tickets+=ch;p.races_changed+=ch>0;const hx=px.includes(res),hy=py.includes(res);if(hx&&!hy)p.only_first++;if(hy&&!hx)p.only_second++;};
  for(const date of dates){
    const prior=all.filter(x=>x.date<date),test=all.filter(x=>x.date===date);
    if(prior.length<ABL_POLICY.minPriorRaces){for(const x of test){bias.warm_up.races++;bias.warm_up.hits+=top6(x.s.baseline_distribution).includes(x.result);}continue;}
    const TH=[0,1,2].map(m=>fitPosition(prior,m)),day=daily[date]={races:test.length,m1:0,m2:0,m3:0};
    for(const x of test){
      n++;const {r,s}=x,lead=(closeMs(r)-Date.parse(s.saved_at))/60000;prov.snapshot_before_close+=lead>0;prov.lead_minutes[lead<5?'0-5':lead<10?'5-10':lead<15?'10-15':'15-20']++;
      for(const f of ['official_preview_at','original_exhibition_at'])if(s[f]){prov[f+'_recorded']++;prov[f+'_before_saved']+=Date.parse(s[f])<=Date.parse(s.saved_at);}
      const ef=exFactor(s.input_state.exhibition),P2=removeEx(x.P,ef),d={m1:s.baseline_distribution,m2:distA(P2,[1,1,1]),m3:corrected(x,TH)},picks=Object.fromEntries(M.map(k=>[k,top6(d[k])]));
      for(const k of M){L[k]+=ll(d[k],x.result);const h=picks[k].includes(x.result);hits[k]+=h;day[k]+=h;}
      cmp('m1_vs_m2',picks.m1,picks.m2,x.result);cmp('m1_vs_m3',picks.m1,picks.m3,x.result);
      // Secondary: engine makeBets ('hit'). Only where the copied function reproduces the saved picks from ①.
      const mb1=engineMakeBets(rowsOf(x.P),6,'hit').map(b=>b.combo);mbRepro.checked++;
      if(JSON.stringify(mb1)===JSON.stringify(s.baseline_picks)){mbRepro.reproduced++;nMb++;const mb2=engineMakeBets(rowsOf(P2),6,'hit').map(b=>b.combo);
        hits.mb1+=mb1.includes(x.result);hits.mb2+=mb2.includes(x.result);cmp('makeBets_m1_vs_m2',mb1,mb2,x.result);}
    }
  }
  const rate=(h,k)=>k?h/k:null,z=p=>(p.only_second-p.only_first)/Math.sqrt(p.only_first+p.only_second||1);
  const dd=k=>{const v=Object.values(daily).map(x=>x[k]-x.m1);return {more:v.filter(x=>x>0).length,same:v.filter(x=>!x).length,fewer:v.filter(x=>x<0).length};};
  return {policy:ABL_POLICY,dates_window:dates,tested_races:n,tested_dates:Object.keys(daily).length,exclusions:excl,
    selection_bias:{incomplete_exhibition:{...bias.incomplete_exhibition,m1_top6_hit_rate:rate(bias.incomplete_exhibition.hits,bias.incomplete_exhibition.races)},warm_up:{...bias.warm_up,m1_top6_hit_rate:rate(bias.warm_up.hits,bias.warm_up.races)}},
    provenance:prov,log_loss:Object.fromEntries(M.map(k=>[k,n?L[k]/n:null])),
    pick6_top:Object.fromEntries(M.map(k=>[k,{hits:hits[k],hit_rate:rate(hits[k],n)}])),
    makebets:{reproduction:mbRepro,races:nMb,m1:{hits:hits.mb1,hit_rate:rate(hits.mb1,nMb)},m2:{hits:hits.mb2,hit_rate:rate(hits.mb2,nMb)}},
    pairs:Object.fromEntries(Object.entries(pairs).map(([k,p])=>[k,{...p,mcnemar_z_exploratory:z(p)}])),daily_vs_m1:{m2:dd('m2'),m3:dd('m3')},daily,production_changed:false,
    interpretation:'Exploratory follow-up after PR #50, window 10/03-10/22 seen in earlier exploration (not an unused evaluation). ② is the comparison with the exhibition-measurement multiplier removed (not all exhibition-related information: course entry, tilt and wind stay). ③ also rescales the original probabilities (alpha), so ①-③ differences are not exhibition-only effects. Per-value fetch times exist only for official_preview_at / original_exhibition_at; the program API fetch time is not recorded per race. No adoption.'};
}

if(import.meta.url===`file://${process.argv[1]}`){
  const root=path.resolve(import.meta.dirname,'..'),out=ablationReport(loadArchive(path.join(root,'dev/expert-shadow-repaired-archive')));
  fs.mkdirSync(path.join(root,'dev/exhibition-ablation'),{recursive:true});fs.writeFileSync(path.join(root,'dev/exhibition-ablation/report.json'),JSON.stringify(out,null,1)+'\n');
  const {daily,...rest}=out;console.log(JSON.stringify(rest,null,1));
}
