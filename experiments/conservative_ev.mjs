import {EV_POLICY,evTickets} from './ev_drift.mjs';
import {riskMetrics} from './variant_risk.mjs';
import {auditRecord} from './shadow_diagnostics.mjs';

// Conservative EV / skip rules: prospective test, fixed on 2026-10-16 before any race it judges (dev/conservative-ev-plan.md).
// "Conservative" here is a fixed scenario, NOT a statistical confidence bound: tickets outside the model's 10 most
// likely combinations, or with model probability below 2%, are treated as having no usable edge (probability floor 0),
// because the exploratory walk-forward (10/07-10/16) found EV-selected tickets hit far less often than predicted.
// The observed ratio there (0.39) is NOT used as a correction factor. All arms use the unchanged shadow EV rule
// (probability x 0.75 x saved odds >= 1.08, max 4 x 100 yen, odds at most 10 minutes old) on their allowed tickets;
// a race with no allowed ticket is a skip (profit 0). Separate from the frozen odds_cap / final_odds_ev / calibration tests.
export const CONSERVATIVE_EV_POLICY=Object.freeze({version:'conservative-ev-prospective-v1',fixed_at:'2026-10-16T11:55:00Z',starts_at:'2026-10-16T15:00:00Z',
  primary_arm:'top10_cap50',top_k:10,min_prob:0.02,odds_cap:50,ev_policy:EV_POLICY.version,discount:EV_POLICY.probabilityDiscount,min_ev:EV_POLICY.minEv,
  max_tickets:EV_POLICY.maxTickets,stake:EV_POLICY.stake,max_odds_age_ms:EV_POLICY.maxOddsAgeMs,
  review:Object.freeze({min_dates:10,min_primary_bought_races:300,report_by:'2026-11-15'})});
export const CONSERVATIVE_ARMS=Object.freeze(['reference','cap50','top10','top10_cap50','min_prob_2pct']);

const topSet=(d,k)=>new Set([...d].sort((a,b)=>b.prob-a.prob||a.combo.localeCompare(b.combo)).slice(0,k).map(x=>x.combo));
export function conservativeEvCapture(r){
  const P=CONSERVATIVE_EV_POLICY;
  if(!r||!Number.isFinite(Date.parse(r.saved_at))||Date.parse(r.saved_at)<Date.parse(P.starts_at))return null;
  if(r.cohort!=='expert-shadow-official-v1'||auditRecord(r).length)return null;
  const savedDate=new Date(Date.parse(r.saved_at)+9*3600000).toISOString().slice(0,10).replaceAll('-','');
  if(r.date!==savedDate||String(r.closed_at).slice(0,10).replaceAll('-','')!==r.date)return null;
  const d=r.baseline_distribution;
  if(!Array.isArray(d)||d.length!==120)return null;
  const reference=evTickets(d,d,r.odds_snapshot_at,r.saved_at);
  if(reference.status!=='shadow_estimate_uncalibrated')return null;   // stale, incomplete or future odds: not captured
  const top=topSet(d,P.top_k),cap=x=>Number.isFinite(x.odds)&&x.odds<P.odds_cap;
  const run=filter=>{const t=evTickets(d.filter(filter),d,r.odds_snapshot_at,r.saved_at);return {items:t.items,investment:t.investment};};
  return {version:P.version,captured_at:r.saved_at,odds_snapshot_at:r.odds_snapshot_at,arms:{
    reference:{items:reference.items,investment:reference.investment},
    cap50:run(cap),top10:run(x=>top.has(x.combo)),top10_cap50:run(x=>top.has(x.combo)&&cap(x)),min_prob_2pct:run(x=>x.prob>=P.min_prob)}};
}

export function conservativeEvValid(r){
  const saved=r.conservative_ev_shadow;
  if(!saved||saved.version!==CONSERVATIVE_EV_POLICY.version||saved.captured_at!==r.saved_at)return false;
  const close=Date.parse(String(r.closed_at).replace(' ','T')+'+09:00');
  if(!Number.isFinite(close)||Date.parse(r.saved_at)>=close)return false;
  return JSON.stringify(saved)===JSON.stringify(conservativeEvCapture(r));   // re-derivable from the saved preclose inputs
}

export function conservativeEvReport(records){
  const P=CONSERVATIVE_EV_POLICY;
  const rs=Object.values(records).filter(r=>!r.cancelled&&!r.excluded&&r.outcome&&!r.outcome.excluded&&/^([1-6])-([1-6])-([1-6])$/.test(r.outcome.result)&&new Set(r.outcome.result.split('-')).size===3&&Number.isSafeInteger(r.outcome.amount)&&r.outcome.amount>0&&conservativeEvValid(r));
  const dates=[...new Set(rs.map(r=>r.date))].sort();
  const events=arm=>rs.map(r=>{const s=r.conservative_ev_shadow.arms[arm],win=s.items.find(x=>x.combo===r.outcome.result);
    return {key:`${r.date}_${r.stadium}_${r.race}`,date:r.date,closed_at:r.closed_at,stadium:r.stadium,race:r.race,investment:s.investment,payout:win?r.outcome.amount*win.stake/100:0,hit:!!win,
      tickets:s.items.length,predicted_hits:s.items.reduce((a,x)=>a+x.prob,0)};});
  const ref=events('reference'),refProfit=new Map(ref.map(e=>[e.key,e.payout-e.investment]));
  const arms={};
  for(const arm of CONSERVATIVE_ARMS){
    const ev=events(arm),bought=ev.filter(x=>x.investment>0),investment=ev.reduce((s,x)=>s+x.investment,0),payout=ev.reduce((s,x)=>s+x.payout,0),hits=bought.filter(x=>x.hit).length;
    const pays=bought.filter(x=>x.hit).map(x=>x.payout).sort((a,b)=>b-a);
    const diffByDate={};for(const e of ev){diffByDate[e.date]=(diffByDate[e.date]||0)+(e.payout-e.investment)-refProfit.get(e.key);}
    arms[arm]={eligible_races:rs.length,bought_races:bought.length,skipped_races:rs.length-bought.length,tickets:bought.reduce((s,x)=>s+x.tickets,0),hits,
      expected_hits:bought.reduce((s,x)=>s+x.predicted_hits,0),hit_rate_per_bought_race:bought.length?hits/bought.length:null,
      investment,payout,profit:payout-investment,roi:investment?payout/investment:null,
      roi_without_top1:investment?(payout-(pays[0]||0))/investment:null,roi_without_top2:investment?(payout-(pays[0]||0)-(pays[1]||0))/investment:null,largest_payout:pays[0]||0,
      profit_minus_reference:ev.reduce((s,e)=>s+(e.payout-e.investment)-refProfit.get(e.key),0),profit_minus_reference_by_date:diffByDate,risk:riskMetrics(bought)};
  }
  const primary=arms[P.primary_arm];
  const ready=dates.length>=P.review.min_dates&&primary.bought_races>=P.review.min_primary_bought_races;
  return {policy:P,status:ready?'review_point_reached':'collecting_future',test_dates:dates,test_races:rs.length,ready_for_review:ready,production_changed:false,arms,
    interpretation:'Prospective fixed rules on the same preclose-captured races; skips count as profit 0. Reaching the review point is not adoption. Zero purchases are reported as a result, never relaxed. Bootstrap shares are shares of resamples, not probabilities of future loss.'};
}
