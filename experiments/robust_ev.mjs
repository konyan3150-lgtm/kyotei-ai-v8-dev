import {EV_POLICY,evTickets} from './ev_drift.mjs';
import {riskMetrics} from './variant_risk.mjs';

// Fixed before observing future results. This is a scenario, not a confidence bound.
export const ROBUST_EV_POLICY=Object.freeze({version:'robust-ev-prospective-v1',starts_at:'2026-10-08T14:30:00Z',probability_factor:.9,odds_factor:.9,min_ev:EV_POLICY.minEv,max_tickets:EV_POLICY.maxTickets,stake:EV_POLICY.stake,min_test_dates:5,min_test_races:150});
export function robustEvCapture(distribution,odds,oddsAt,savedAt){
  if(Date.parse(savedAt)<Date.parse(ROBUST_EV_POLICY.starts_at))return null;
  const reference=evTickets(distribution,odds,oddsAt,savedAt);
  if(reference.status!=='shadow_estimate_uncalibrated')return null;
  const conservative=reference.items.filter(x=>x.discounted_ev*ROBUST_EV_POLICY.probability_factor*ROBUST_EV_POLICY.odds_factor>=ROBUST_EV_POLICY.min_ev).map(x=>({...x,scenario_ev:x.discounted_ev*ROBUST_EV_POLICY.probability_factor*ROBUST_EV_POLICY.odds_factor}));
  return {version:ROBUST_EV_POLICY.version,captured_at:savedAt,reference:{items:reference.items,investment:reference.investment},conservative:{items:conservative,investment:conservative.reduce((s,x)=>s+x.stake,0)}};
}
export function robustEvValid(r){
  const c=r.odds_calibration_shadow,b=c?.robust_ev;
  if(!b||!Number.isFinite(Date.parse(r.saved_at))||Date.parse(r.saved_at)<Date.parse(ROBUST_EV_POLICY.starts_at))return false;
  const expected=robustEvCapture(c.distribution,r.baseline_distribution,r.odds_snapshot_at,r.saved_at);
  return JSON.stringify(b)===JSON.stringify(expected);
}
export function robustEvReport(records){
  const rs=records.filter(r=>!r.cancelled&&!r.excluded&&r.outcome&&Number.isFinite(r.outcome.amount)&&r.outcome.amount>0&&robustEvValid(r));
  const dates=[...new Set(rs.map(r=>r.date))].sort();
  const report={policy:ROBUST_EV_POLICY,status:'collecting_future',test_dates:dates,test_races:rs.length,ready_for_review:dates.length>=5&&rs.length>=150,production_changed:false,interpretation:'Fixed calibrated EV comparison, same eligible races and 400 yen maximum per race. Additional 10% probability and 10% odds reductions are hypothetical stress scenarios, not statistical confidence bounds. Use actual settled payouts. Never retrofit missing captures or auto-promote.'};
  if(report.ready_for_review)report.status='future_comparison_ready';
  report.arms={};
  for(const arm of ['reference','conservative']){
    const events=rs.map(r=>{const saved=r.odds_calibration_shadow.robust_ev[arm],winner=saved.items.find(x=>x.combo===r.outcome.result);return {...r,investment:saved.investment,payout:winner?r.outcome.amount*winner.stake/100:0,hit:!!winner};});
    const bought=events.filter(x=>x.investment>0),investment=events.reduce((s,x)=>s+x.investment,0),payout=events.reduce((s,x)=>s+x.payout,0),hits=bought.filter(x=>x.hit).length;
    report.arms[arm]={eligible_races:rs.length,bought_races:bought.length,skipped_races:rs.length-bought.length,hits,hit_rate:bought.length?hits/bought.length:null,investment,payout,profit:payout-investment,roi:investment?payout/investment:null,risk:riskMetrics(bought)};
  }
  return report;
}
