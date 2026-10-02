const mean=xs=>xs.length?xs.reduce((s,x)=>s+x,0)/xs.length:null;
const closeMs=r=>Date.parse(String(r.closed_at).replace(' ','T')+'+09:00');
export function auditRecord(r){
  const errors=[],saved=Date.parse(r.saved_at),close=closeMs(r);
  if(!Number.isFinite(saved)||!Number.isFinite(close)||saved>=close)errors.push('invalid_capture_time');
  for(const arm of ['baseline','candidate']){
    const d=r[arm+'_distribution'];
    if(!Array.isArray(d)||d.length!==120){errors.push(arm+'_missing_full_distribution');continue}
    if(new Set(d.map(x=>x.combo)).size!==120||d.some(x=>!/^([1-6])-([1-6])-([1-6])$/.test(x.combo)||new Set(x.combo.split('-')).size!==3))errors.push(arm+'_invalid_combinations');
    if(d.some(x=>!Number.isFinite(x.prob)||x.prob<0||x.prob>1)||Math.abs(d.reduce((s,x)=>s+x.prob,0)-1)>1e-8)errors.push(arm+'_invalid_probability_mass');
    const picks=r[arm+'_picks'];
    if(!Array.isArray(picks)||picks.length!==6||new Set(picks).size!==6||picks.some(x=>!d.some(t=>t.combo===x)))errors.push(arm+'_invalid_picks');
  }
  return errors;
}
export function reliability(records,arm){
  const edges=[0,.05,.1,.2,.3,.5,1.0000001],bins=edges.slice(0,-1).map((lower,i)=>({lower,upper:Math.min(1,edges[i+1]),races:0,predicted_sum:0,hits:0}));
  for(const r of records){
    const top=r[arm+'_distribution'].reduce((a,b)=>b.prob>a.prob?b:a),i=edges.findIndex((v,j)=>j<edges.length-1&&top.prob>=v&&top.prob<edges[j+1]);
    const b=bins[i];b.races++;b.predicted_sum+=top.prob;b.hits+=Number(top.combo===r.outcome.result);
  }
  const result=bins.map(b=>({lower:b.lower,upper:b.upper,races:b.races,predicted_probability:b.races?b.predicted_sum/b.races:null,observed_hit_rate:b.races?b.hits/b.races:null}));
  return {event:'highest-score trifecta combination hits; one observation per race',races:records.length,
    ece:records.length?result.reduce((s,b)=>s+(b.races?b.races/records.length*Math.abs(b.predicted_probability-b.observed_hit_rate):0),0):null,
    status:records.length>=100?'descriptive':'insufficient_sample',bins:result};
}
function summarize(rs){
  const arms={};
  for(const arm of ['baseline','candidate']){
    const m=rs.map(r=>r.outcome.metrics[arm]),investment=m.reduce((s,x)=>s+x.investment,0),payout=m.reduce((s,x)=>s+x.payout,0);
    arms[arm]={races:rs.length,hit_rate:mean(m.map(x=>Number(x.hit))),investment,payout,roi:investment?payout/investment:null,
      log_loss:mean(m.map(x=>x.log_loss)),brier:mean(m.map(x=>x.brier))};
  }
  return {races:rs.length,arms};
}
function rng(){let seed=123456789;return()=>{seed=(1664525*seed+1013904223)>>>0;return seed/4294967296}}
export function pairedIntervals(rs){
  const dates=[...new Set(rs.map(r=>r.date))].sort();
  if(dates.length<5||rs.length<100)return {status:'insufficient_sample',dates:dates.length,races:rs.length,required_dates:5,required_races:100,intervals:null};
  const blocks=dates.map(d=>rs.filter(r=>r.date===d)),random=rng(),samples={hit_rate:[],log_loss:[],brier:[],roi:[]};
  for(let i=0;i<1000;i++){
    const sample=Array.from({length:blocks.length},()=>blocks[Math.floor(random()*blocks.length)]).flat(),summary=summarize(sample);
    for(const metric of Object.keys(samples))samples[metric].push(summary.arms.candidate[metric]-summary.arms.baseline[metric]);
  }
  const intervals=Object.fromEntries(Object.entries(samples).map(([k,xs])=>{xs.sort((a,b)=>a-b);return [k,{lower:xs[24],upper:xs[974]}]}));
  return {status:'descriptive_interval',method:'1000 paired bootstrap samples of whole date blocks; 95% percentile interval',dates:dates.length,races:rs.length,
    direction:'candidate minus baseline; negative log loss/Brier is better, positive hit rate/ROI is better',intervals,
    limitation:'Exploratory monitoring only; intervals do not adjust for repeated inspection or candidate selection.'};
}
export function diagnostics(records){
  const entries=Object.entries(records),invalid=entries.map(([key,r])=>({key,errors:auditRecord(r)})).filter(x=>x.errors.length),bad=new Set(invalid.map(x=>x.key));
  const valid=entries.filter(([key])=>!bad.has(key)).map(([,r])=>r),settled=valid.filter(r=>!r.cancelled&&r.outcome?.metrics?.baseline&&r.outcome?.metrics?.candidate);
  const group=fn=>Object.fromEntries([...new Set(settled.map(fn))].sort().map(k=>[k,summarize(settled.filter(r=>fn(r)===k))]));
  return {integrity:{saved:entries.length,valid:valid.length,invalid:invalid.length,errors:invalid},
    reliability:Object.fromEntries(['baseline','candidate'].map(arm=>[arm,reliability(settled,arm)])),
    by_date:group(r=>r.date),by_stadium:group(r=>String(r.stadium)),by_expert:group(r=>r.expert?.active||'unknown'),paired_intervals:pairedIntervals(settled),
    promotion:'No automatic production promotion. Future chronological holdout evaluation is still required.'};
}
