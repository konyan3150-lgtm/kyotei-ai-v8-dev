import {EV_POLICY,evTickets} from './ev_drift.mjs';
import {riskMetrics} from './variant_risk.mjs';
import {auditRecord} from './shadow_diagnostics.mjs';

// Fixed on 2026-10-12 from shadow data 2026-10-03..12 (680 settled races), before any race it will judge.
// Two observed problems with EV on saved preclose odds:
//  1. Odds fall before close: winning tickets paid a median 0.88x their saved odds (0.57x for EV picks).
//  2. The raw probabilities overrate longshots: observed / predicted hit rate by saved-odds band was
//     <10x 1.862, 10-20x 1.364, 20-50x 1.082, 50-100x 0.930, 100-500x 0.609, 500x+ 0.406.
// Arms (all use the unchanged EV rule: probability x 0.75 x odds >= 1.08, max 4 x 100 yen):
//  band_cal           probabilities multiplied by the fixed band ratio, renormalized to 1 per race
//  band_cal_final085  band_cal plus odds x 0.85 (expected fall to the final odds)
//  final_085_cap50    raw probabilities, odds x 0.85, only tickets below 50x
// Ratios and factors are not retuned from future results; no retrofitting and no automatic production adoption.
export const FINAL_ODDS_POLICY=Object.freeze({version:'final-odds-ev-prospective-v1',starts_at:'2026-10-12T15:00:00Z',
  band_edges:Object.freeze([10,20,50,100,500]),band_ratios:Object.freeze([1.862,1.364,1.082,0.93,0.609,0.406]),
  arms:Object.freeze({band_cal:Object.freeze({calibrate:true,factor:1,cap:null}),band_cal_final085:Object.freeze({calibrate:true,factor:.85,cap:null}),
    final_085_cap50:Object.freeze({calibrate:false,factor:.85,cap:50})}),
  ev_policy:EV_POLICY.version,min_ev:EV_POLICY.minEv,max_tickets:EV_POLICY.maxTickets,stake:EV_POLICY.stake,min_test_dates:5,min_test_races:150});
const ARMS=['reference',...Object.keys(FINAL_ODDS_POLICY.arms)];

export function bandRatio(odds){
  const i=FINAL_ODDS_POLICY.band_edges.findIndex(edge=>odds<edge);
  return FINAL_ODDS_POLICY.band_ratios[i<0?FINAL_ODDS_POLICY.band_ratios.length-1:i];
}
function arm(distribution,{calibrate=false,factor=1,cap=null},r){
  let probs=distribution;
  if(calibrate){
    const raw=distribution.map(x=>({...x,prob:x.prob*bandRatio(x.odds)})),mass=raw.reduce((s,x)=>s+x.prob,0);
    if(!(mass>0))return null;
    probs=raw.map(x=>({...x,prob:x.prob/mass}));
  }
  const pool=probs.filter(x=>cap==null||x.odds<cap);
  const scaled=distribution.map(x=>({...x,odds:x.odds*factor}));
  const t=evTickets(pool,scaled,r.odds_snapshot_at,r.saved_at);
  if(t.status!=='shadow_estimate_uncalibrated')return null;
  const saved=new Map(distribution.map(x=>[x.combo,x]));
  return {items:t.items.map(x=>({combo:x.combo,raw_prob:saved.get(x.combo).prob,prob:x.prob,saved_odds:saved.get(x.combo).odds,expected_final_odds:x.odds,discounted_ev:x.discounted_ev,stake:x.stake})),investment:t.investment};
}

export function finalOddsCapture(r){
  if(!r||!Number.isFinite(Date.parse(r.saved_at))||Date.parse(r.saved_at)<Date.parse(FINAL_ODDS_POLICY.starts_at))return null;
  if(r.cohort!=='expert-shadow-official-v1'||auditRecord(r).length)return null;
  const savedDate=new Date(Date.parse(r.saved_at)+9*3600000).toISOString().slice(0,10).replaceAll('-','');
  if(r.date!==savedDate||String(r.closed_at).slice(0,10).replaceAll('-','')!==r.date)return null;
  const distribution=r.baseline_distribution;
  if(!Array.isArray(distribution)||distribution.length!==120||distribution.some(x=>!Number.isFinite(x.odds)||x.odds<=0||!Number.isFinite(x.prob)))return null;
  const arms={reference:arm(distribution,{},r)};
  if(!arms.reference)return null;
  for(const [name,spec] of Object.entries(FINAL_ODDS_POLICY.arms))arms[name]=arm(distribution,spec,r);
  return {version:FINAL_ODDS_POLICY.version,captured_at:r.saved_at,odds_snapshot_at:r.odds_snapshot_at,arms};
}

export function finalOddsValid(r){
  const saved=r.final_odds_shadow;
  if(!saved||saved.version!==FINAL_ODDS_POLICY.version||saved.captured_at!==r.saved_at)return false;
  const close=Date.parse(String(r.closed_at).replace(' ','T')+'+09:00');
  if(!Number.isFinite(close)||Date.parse(r.saved_at)>=close)return false;
  return JSON.stringify(saved)===JSON.stringify(finalOddsCapture(r));
}

export function finalOddsReport(records){
  const rs=Object.values(records).filter(r=>!r.cancelled&&!r.excluded&&r.outcome&&!r.outcome.excluded&&/^([1-6])-([1-6])-([1-6])$/.test(r.outcome.result)&&new Set(r.outcome.result.split('-')).size===3&&Number.isSafeInteger(r.outcome.amount)&&r.outcome.amount>0&&finalOddsValid(r));
  const dates=[...new Set(rs.map(r=>r.date))].sort();
  const ready=dates.length>=FINAL_ODDS_POLICY.min_test_dates&&rs.length>=FINAL_ODDS_POLICY.min_test_races;
  const report={policy:FINAL_ODDS_POLICY,status:ready?'future_comparison_ready':'collecting_future',test_dates:dates,test_races:rs.length,ready_for_review:ready,production_changed:false,
    interpretation:'Fixed odds-band probability ratios and/or expected-final odds factors applied before the unchanged shadow EV rule, captured preclose on the same races and settled with actual official payouts. Ratios and factors are not retuned; no retrofitting and no automatic production adoption.',arms:{}};
  for(const name of ARMS){
    const events=rs.map(r=>{const saved=r.final_odds_shadow.arms[name],win=saved.items.find(x=>x.combo===r.outcome.result);
      return {date:r.date,closed_at:r.closed_at,stadium:r.stadium,race:r.race,investment:saved.investment,payout:win?r.outcome.amount*win.stake/100:0,hit:!!win,
        final_to_saved:win?r.outcome.amount/100/win.saved_odds:null};});
    const bought=events.filter(x=>x.investment>0),investment=events.reduce((s,x)=>s+x.investment,0),payout=events.reduce((s,x)=>s+x.payout,0),hits=bought.filter(x=>x.hit).length;
    const ratios=events.map(x=>x.final_to_saved).filter(Number.isFinite).sort((a,b)=>a-b);
    report.arms[name]={eligible_races:rs.length,bought_races:bought.length,skipped_races:rs.length-bought.length,hits,hit_rate:bought.length?hits/bought.length:null,
      investment,payout,profit:payout-investment,roi:investment?payout/investment:null,largest_payout:Math.max(0,...events.map(x=>x.payout)),
      winning_final_to_saved_median:ratios.length?ratios[Math.floor((ratios.length-1)/2)]:null,risk:riskMetrics(bought)};
  }
  return report;
}
