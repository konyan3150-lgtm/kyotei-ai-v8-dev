import {auditRecord} from './shadow_diagnostics.mjs';
export const ODDS_DETERIORATION_POLICY=Object.freeze({version:'saved-odds-deterioration-v1',max_odds_age_ms:600000});
const closeMs=r=>Date.parse(String(r.closed_at).replace(' ','T')+'+09:00');
const combo=x=>typeof x==='string'&&/^[1-6]-[1-6]-[1-6]$/.test(x)&&new Set(x.split('-')).size===3;
function ratioSummary(values){
 const sorted=values.slice().sort((a,b)=>a-b),n=sorted.length,quantile=p=>n?sorted[Math.floor((n-1)*p)]:null;
 return {observations:n,median:quantile(.5),p10:quantile(.1),p90:quantile(.9),below_saved_odds:values.filter(x=>x<1).length,
  at_least_10_percent_lower:values.filter(x=>x<=.9).length,at_least_20_percent_lower:values.filter(x=>x<=.8).length};
}
function event(r,items){
 const win=items.find(x=>x.combo===r.outcome.result),investment=items.reduce((s,x)=>s+x.stake,0);
 return {date:r.date,investment,tickets:items.length,hit:Number(!!win),expected:items.reduce((s,x)=>s+x.prob*x.odds*x.stake,0),
  saved_odds_realized:win?win.odds*win.stake:0,actual:win?r.outcome.amount*win.stake/100:0,
  winning_ratio:win?r.outcome.amount/100/win.odds:null};
}
function summarize(events){
 const total=k=>events.reduce((s,x)=>s+x[k],0),investment=total('investment'),actual=total('actual'),saved=total('saved_odds_realized'),expected=total('expected'),largest=Math.max(0,...events.map(x=>x.actual));
 const result={eligible_races:events.length,bought_races:events.filter(x=>x.investment>0).length,tickets:total('tickets'),hits:total('hit'),investment,
  actual_payout:actual,saved_odds_realized_payout:saved,estimated_payout:expected,actual_roi:investment?actual/investment:null,
  saved_odds_realized_roi:investment?saved/investment:null,estimated_roi:investment?expected/investment:null,
  payout_ratio_actual_to_saved_odds:saved?actual/saved:null,
  odds_movement_roi_percentage_points:investment?100*(actual-saved)/investment:null,
  probability_and_sampling_residual_percentage_points:investment?100*(saved-expected)/investment:null,
  winning_ticket_ratios:ratioSummary(events.filter(x=>x.hit).map(x=>x.winning_ratio)),
  concentration:{largest_payout:largest,largest_payout_share:actual?largest/actual:null,
   roi_if_largest_payout_zeroed:investment?(actual-largest)/investment:null,
   interpretation:'Stress only: zero the largest race payout while retaining every original stake. No historical record is changed.'}};
 return result;
}
export function oddsDeterioration(records){
 const counts={records:Object.keys(records).length,invalid_or_other_cohort:0,not_settled_or_excluded:0,invalid_outcome:0,odds_missing_stale_or_postclose:0,odds_incomplete:0,eligible_races:0,ev_unavailable_or_inconsistent:0};
 const scopes={six_equal:[],ev_saved:[]},winningRatios=[];
 for(const r of Object.values(records)){
  if(r.cohort!=='expert-shadow-official-v1'||auditRecord(r).length){counts.invalid_or_other_cohort++;continue;}
  if(!r.outcome||r.cancelled||r.excluded){counts.not_settled_or_excluded++;continue;}
  if(!combo(r.outcome.result)||!Number.isFinite(r.outcome.amount)||r.outcome.amount<=0){counts.invalid_outcome++;continue;}
  const at=Date.parse(r.odds_snapshot_at),saved=Date.parse(r.saved_at);
  if(!Number.isFinite(at)||at>saved||at>=closeMs(r)||saved-at>ODDS_DETERIORATION_POLICY.max_odds_age_ms){counts.odds_missing_stale_or_postclose++;continue;}
  const d=r.baseline_distribution,map=new Map(d.map(x=>[x.combo,x]));
  if(d.some(x=>!Number.isFinite(x.odds)||x.odds<=0)){counts.odds_incomplete++;continue;}
  counts.eligible_races++;winningRatios.push(r.outcome.amount/100/map.get(r.outcome.result).odds);
  scopes.six_equal.push(event(r,r.baseline_picks.map(c=>({...map.get(c),stake:100}))));
  const ev=r.value_arms?.baseline;
  if(ev?.status!=='shadow_estimate_uncalibrated'||!Array.isArray(ev.items)||new Set(ev.items.map(x=>x.combo)).size!==ev.items.length||
   ev.items.some(x=>!map.has(x.combo)||x.prob!==map.get(x.combo).prob||x.odds!==map.get(x.combo).odds||!Number.isFinite(x.stake)||x.stake<=0)||ev.investment!==ev.items.reduce((s,x)=>s+x.stake,0)){counts.ev_unavailable_or_inconsistent++;continue;}
  scopes.ev_saved.push(event(r,ev.items));
 }
 return {policy:ODDS_DETERIORATION_POLICY,counts,all_observed_winning_combinations:ratioSummary(winningRatios),
  scopes:Object.fromEntries(Object.entries(scopes).map(([key,events])=>[key,{...summarize(events),by_date:Object.fromEntries([...new Set(events.map(x=>x.date))].sort().map(date=>[date,summarize(events.filter(x=>x.date===date))]))}])),
  production_changed:false,interpretation:'Read-only decomposition using original saved selections. Saved-odds realized payout uses observed hits and preclose odds, not a new forecast or claim that odds were locked. Actual minus saved-odds realized return measures payout movement on winning tickets. Saved-odds realized minus estimated return mixes probability error, selection and sampling noise; it does not identify causal calibration error. Losing-ticket final odds cannot be recovered from official payouts. Winning-only ratios cannot establish a universal odds haircut. No fitting, retrospective bets or promotion.'};
}
