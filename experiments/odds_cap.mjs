import {EV_POLICY,evTickets} from './ev_drift.mjs';
import {riskMetrics} from './variant_risk.mjs';
import {auditRecord} from './shadow_diagnostics.mjs';

// Fixed before observing any future result. Caps are not tuned afterwards.
// Each capped arm uses the unchanged shadow EV rule (probability x 0.75 x odds >= 1.08, max 4 x 100 yen),
// but only considers tickets whose saved preclose odds are below the cap.
export const ODDS_CAP_POLICY=Object.freeze({version:'odds-cap-prospective-v1',starts_at:'2026-10-10T15:00:00Z',caps:Object.freeze([100,50,30]),ev_policy:EV_POLICY.version,
  min_ev:EV_POLICY.minEv,max_tickets:EV_POLICY.maxTickets,stake:EV_POLICY.stake,min_test_dates:5,min_test_races:150});
const ARMS=['reference',...ODDS_CAP_POLICY.caps.map(c=>'cap_'+c)];

export function oddsCapCapture(r){
  if(!r||!Number.isFinite(Date.parse(r.saved_at))||Date.parse(r.saved_at)<Date.parse(ODDS_CAP_POLICY.starts_at))return null;
  if(r.cohort!=='expert-shadow-official-v1'||auditRecord(r).length)return null;
  const savedDate=new Date(Date.parse(r.saved_at)+9*3600000).toISOString().slice(0,10).replaceAll('-','');
  if(r.date!==savedDate||String(r.closed_at).slice(0,10).replaceAll('-','')!==r.date)return null;
  const distribution=r.baseline_distribution;
  if(!Array.isArray(distribution)||distribution.length!==120)return null;
  const reference=evTickets(distribution,distribution,r.odds_snapshot_at,r.saved_at);
  if(reference.status!=='shadow_estimate_uncalibrated')return null;
  const pick=x=>({items:x.items,investment:x.investment});
  const arms={reference:pick(reference)};
  for(const cap of ODDS_CAP_POLICY.caps){
    const capped=evTickets(distribution.filter(x=>Number.isFinite(x.odds)&&x.odds<cap),distribution,r.odds_snapshot_at,r.saved_at);
    arms['cap_'+cap]=pick(capped);
  }
  return {version:ODDS_CAP_POLICY.version,captured_at:r.saved_at,odds_snapshot_at:r.odds_snapshot_at,arms};
}

export function oddsCapValid(r){
  const saved=r.odds_cap_shadow;
  if(!saved||saved.version!==ODDS_CAP_POLICY.version||saved.captured_at!==r.saved_at)return false;
  const close=Date.parse(String(r.closed_at).replace(' ','T')+'+09:00');
  if(!Number.isFinite(close)||Date.parse(r.saved_at)>=close)return false;
  return JSON.stringify(saved)===JSON.stringify(oddsCapCapture(r));
}

export function oddsCapReport(records){
  const rs=Object.values(records).filter(r=>!r.cancelled&&!r.excluded&&r.outcome&&!r.outcome.excluded&&/^([1-6])-([1-6])-([1-6])$/.test(r.outcome.result)&&new Set(r.outcome.result.split('-')).size===3&&Number.isSafeInteger(r.outcome.amount)&&r.outcome.amount>0&&oddsCapValid(r));
  const dates=[...new Set(rs.map(r=>r.date))].sort();
  const ready=dates.length>=ODDS_CAP_POLICY.min_test_dates&&rs.length>=ODDS_CAP_POLICY.min_test_races;
  const report={policy:ODDS_CAP_POLICY,status:ready?'future_comparison_ready':'collecting_future',test_dates:dates,test_races:rs.length,ready_for_review:ready,production_changed:false,
    interpretation:'Fixed odds caps on the unchanged shadow EV rule, captured preclose on the same races. Settled with actual official payouts. Caps are not retuned from results; no retrofitting of earlier races and no automatic production adoption.',arms:{}};
  for(const arm of ARMS){
    const events=rs.map(r=>{const saved=r.odds_cap_shadow.arms[arm],win=saved.items.find(x=>x.combo===r.outcome.result);
      return {date:r.date,closed_at:r.closed_at,stadium:r.stadium,race:r.race,investment:saved.investment,payout:win?r.outcome.amount*win.stake/100:0,hit:!!win};});
    const bought=events.filter(x=>x.investment>0),investment=events.reduce((s,x)=>s+x.investment,0),payout=events.reduce((s,x)=>s+x.payout,0),hits=bought.filter(x=>x.hit).length;
    report.arms[arm]={eligible_races:rs.length,bought_races:bought.length,skipped_races:rs.length-bought.length,hits,hit_rate:bought.length?hits/bought.length:null,
      investment,payout,profit:payout-investment,roi:investment?payout/investment:null,risk:riskMetrics(bought)};
  }
  return report;
}
