import {auditRecord} from './shadow_diagnostics.mjs';

// Fixed bins describe existing snapshots; they never select new bets or fit rules.
export const ODDS_DIAGNOSTIC_POLICY=Object.freeze({version:'saved-odds-diagnostics-v1',max_odds_age_ms:600000,
  odds_edges:[0,10,20,50,100,500,Infinity],probability_edges:[0,.01,.03,.05,.1,.2,1.0000001]});
const closeMs=r=>Date.parse(String(r.closed_at).replace(' ','T')+'+09:00');
const validCombo=x=>typeof x==='string'&&/^[1-6]-[1-6]-[1-6]$/.test(x)&&new Set(x.split('-')).size===3;
function empty(){return {tickets:0,hits:0,predicted_sum:0,investment:0,payout:0,expected_payout:0,races:new Set(),dates:new Set()};}
function add(a,x,r,financial){
  a.tickets++;a.hits+=Number(x.combo===r.outcome.result);a.predicted_sum+=x.prob;a.races.add(`${r.date}_${r.stadium}_${r.race}`);a.dates.add(r.date);
  if(financial){a.investment+=x.stake;a.expected_payout+=x.prob*x.odds*x.stake;a.payout+=x.combo===r.outcome.result?r.outcome.amount*x.stake/100:0;}
}
function finish(a,financial){return {tickets:a.tickets,races:a.races.size,dates:a.dates.size,hits:a.hits,
  predicted_probability:a.tickets?a.predicted_sum/a.tickets:null,observed_ticket_hit_rate:a.tickets?a.hits/a.tickets:null,
  ...(financial?{investment:a.investment,payout:a.payout,profit:a.payout-a.investment,roi:a.investment?a.payout/a.investment:null,
    estimated_roi:a.investment?a.expected_payout/a.investment:null}:{})};}
function scope(financial){return {financial,total:empty(),odds:ODDS_DIAGNOSTIC_POLICY.odds_edges.slice(0,-1).map(empty),probability:ODDS_DIAGNOSTIC_POLICY.probability_edges.slice(0,-1).map(empty)};}
function bin(edges,x){return edges.findIndex((lo,i)=>i<edges.length-1&&x>=lo&&x<edges[i+1]);}
function addScope(s,items,r){for(const x of items){add(s.total,x,r,s.financial);add(s.odds[bin(ODDS_DIAGNOSTIC_POLICY.odds_edges,x.odds)],x,r,s.financial);add(s.probability[bin(ODDS_DIAGNOSTIC_POLICY.probability_edges,x.prob)],x,r,s.financial);}}
function finalize(s){const group=(axis,edges)=>s[axis].map((a,i)=>({lower:edges[i],upper:Number.isFinite(edges[i+1])?Math.min(edges[i+1],axis==='probability'?1:Infinity):null,...finish(a,s.financial)}));
  return {summary:finish(s.total,s.financial),by_odds:group('odds',ODDS_DIAGNOSTIC_POLICY.odds_edges),by_probability:group('probability',ODDS_DIAGNOSTIC_POLICY.probability_edges)};}

export function oddsDiagnostics(records){
  const scopes={all_combinations:scope(false),six_equal:scope(true),ev_saved:scope(true)};
  const counts={records:Object.keys(records).length,eligible_races:0,invalid_or_other_cohort:0,not_settled_or_excluded:0,invalid_outcome:0,
    odds_missing_stale_or_postclose:0,odds_incomplete:0,ev_unavailable_or_inconsistent:0};
  for(const r of Object.values(records)){
    if(r.cohort!=='expert-shadow-official-v1'||auditRecord(r).length){counts.invalid_or_other_cohort++;continue;}
    if(!r.outcome||r.cancelled||r.excluded){counts.not_settled_or_excluded++;continue;}
    if(!validCombo(r.outcome.result)||!Number.isFinite(r.outcome.amount)||r.outcome.amount<=0){counts.invalid_outcome++;continue;}
    const at=Date.parse(r.odds_snapshot_at),saved=Date.parse(r.saved_at);
    if(!Number.isFinite(at)||at>saved||at>=closeMs(r)||saved-at>ODDS_DIAGNOSTIC_POLICY.max_odds_age_ms){counts.odds_missing_stale_or_postclose++;continue;}
    const d=r.baseline_distribution;
    if(d.some(x=>!Number.isFinite(x.odds)||x.odds<=0)){counts.odds_incomplete++;continue;}
    counts.eligible_races++;addScope(scopes.all_combinations,d,r);
    const selected=new Set(r.baseline_picks);addScope(scopes.six_equal,d.filter(x=>selected.has(x.combo)).map(x=>({...x,stake:100})),r);
    const ev=r.value_arms?.baseline,map=new Map(d.map(x=>[x.combo,x]));
    if(ev?.status!=='shadow_estimate_uncalibrated'||!Array.isArray(ev.items)||new Set(ev.items.map(x=>x.combo)).size!==ev.items.length||
      ev.items.some(x=>!map.has(x.combo)||x.prob!==map.get(x.combo).prob||x.odds!==map.get(x.combo).odds||!Number.isFinite(x.stake)||x.stake<=0)||
      ev.investment!==ev.items.reduce((sum,x)=>sum+x.stake,0)){counts.ev_unavailable_or_inconsistent++;continue;}
    addScope(scopes.ev_saved,ev.items,r);
  }
  return {policy:{...ODDS_DIAGNOSTIC_POLICY,odds_edges:ODDS_DIAGNOSTIC_POLICY.odds_edges.map(x=>Number.isFinite(x)?x:null)},counts,
    scopes:Object.fromEntries(Object.entries(scopes).map(([k,s])=>[k,finalize(s)])),production_changed:false,
    interpretation:'Descriptive saved preclose snapshots only. Six equal and saved baseline EV are separate shadow scopes. Hit rate is per ticket, not per race. Actual payout uses official result; expected return uses saved odds and uncalibrated probability. Full 120-odds coverage required for a common cohort; counts show exclusions. Tickets within a race are dependent. No fitting, new forecasts, rule changes or promotion.'};
}
