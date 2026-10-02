export const EV_POLICY=Object.freeze({version:'shadow-ev-v1',probabilityDiscount:.75,minEv:1.08,maxTickets:4,stake:100,maxOddsAgeMs:10*60000});
export function evTickets(distribution,oddsDistribution,oddsAt,savedAt){
  const age=Date.parse(savedAt)-Date.parse(oddsAt);
  if(!Number.isFinite(age)||age<0||age>EV_POLICY.maxOddsAgeMs)return {status:'odds_unavailable_or_stale',items:[],investment:0};
  const odds=new Map(oddsDistribution.map(x=>[x.combo,x.odds]));
  const coverage=distribution.filter(x=>Number.isFinite(odds.get(x.combo))&&odds.get(x.combo)>0).length;
  if(!distribution.length||coverage<distribution.length)return {status:'odds_incomplete',items:[],investment:0,odds_coverage:coverage,expected_combinations:distribution.length};
  const items=distribution.map(x=>({...x,odds:odds.get(x.combo)})).filter(x=>Number.isFinite(x.prob)&&x.prob>0&&Number.isFinite(x.odds)&&x.odds>0)
    .map(x=>({combo:x.combo,prob:x.prob,odds:x.odds,estimated_ev:x.prob*x.odds,discounted_ev:x.prob*EV_POLICY.probabilityDiscount*x.odds,stake:EV_POLICY.stake}))
    .filter(x=>x.discounted_ev>=EV_POLICY.minEv).sort((a,b)=>b.discounted_ev-a.discounted_ev||a.combo.localeCompare(b.combo)).slice(0,EV_POLICY.maxTickets);
  return {status:'shadow_estimate_uncalibrated',items,investment:items.length*EV_POLICY.stake,policy:EV_POLICY.version};
}
const numericBins=[0,.05,.1,.2,.4,Infinity];
function histogram(values,categories){
  const counts=categories.map(()=>0);
  for(const x of values){const i=categories.indexOf(x);if(i>=0)counts[i]++}
  return counts.map(c=>(c+.5)/(values.length+.5*categories.length));
}
export function psi(reference,recent,categories){
  const a=histogram(reference,categories),b=histogram(recent,categories);
  return a.reduce((s,p,i)=>s+(b[i]-p)*Math.log(b[i]/p),0);
}
export function drift(records){
  const all=Object.values(records).filter(r=>!r.cancelled&&r.baseline_distribution?.length===120&&r.saved_at)
    .sort((a,b)=>a.saved_at.localeCompare(b.saved_at));
  const reference=all.slice(0,200),recent=all.slice(200).slice(-100);
  const base={reference_races:reference.length,recent_races:recent.length,reference_required:200,recent_required:50,
    policy:'first 200 fixed reference; latest 100 non-overlapping observations; PSI warning at 0.20; monitoring only'};
  if(reference.length<200||recent.length<50)return {...base,status:'collecting_reference',metrics:{}};
  const defs={top_probability:r=>Math.max(...r.baseline_distribution.map(x=>x.prob)),inside_probability:r=>r.baseline_distribution.filter(x=>x.combo.startsWith('1-')).reduce((s,x)=>s+x.prob,0)};
  const metrics={};
  for(const [name,f] of Object.entries(defs)){
    const toBin=r=>numericBins.findIndex((edge,i)=>i<numericBins.length-1&&f(r)>=edge&&f(r)<numericBins[i+1]);
    const value=psi(reference.map(toBin),recent.map(toBin),[0,1,2,3,4]);
    metrics[name]={psi:value,warning:value>=.20};
  }
  for(const [name,f] of Object.entries({expert_class:r=>r.expert?.active||'unknown',venue:r=>String(r.stadium)})){
    const categories=[...new Set(all.map(f))].sort();const value=psi(reference.map(f),recent.map(f),categories);
    metrics[name]={psi:value,warning:value>=.20};
  }
  return {...base,status:Object.values(metrics).some(x=>x.warning)?'distribution_change_detected':'stable',metrics,
    interpretation:'Changes can reflect venue or race mix; do not automatically retrain or change bets.'};
}
