// Market-blend six-pick forward test (pre-registered in dev/market-pick6-plan.md before this code).
//   ① saved makeBets, ② top 6 of the saved distribution, ③ top 6 by saved odds (market only),
//   ④ top 6 of the frozen odds-aware-v1 blend (temperature 0.75, market 75%). 6 x 100 yen each, every race.
import {auditRecord} from './shadow_diagnostics.mjs';
import {EV_POLICY} from './ev_drift.mjs';
import {oddsCalibratedDistribution,validateOddsCalibrationModel} from './odds_calibration.mjs';
import {riskMetrics} from './variant_risk.mjs';

export const MARKET_PICK6_POLICY=Object.freeze({version:'market-pick6-prospective-v1',starts_at:'2026-11-04T15:00:00Z',stake:100,picks:6,max_odds_age_ms:EV_POLICY.maxOddsAgeMs,
  arms:Object.freeze(['makeBets','base_top6','market_top6','blend75_top6']),
  contrasts:Object.freeze([['blend75_top6','makeBets'],['blend75_top6','market_top6'],['base_top6','makeBets'],['base_top6','market_top6'],['blend75_top6','base_top6']]),
  review:Object.freeze({min_dates:14,min_races:700,report_by:'2026-12-05'}),bootstrap:Object.freeze({resamples:10000,seed:20261105})});
const closeMs=r=>Date.parse(String(r.closed_at).replace(' ','T')+'+09:00');
const jstDate=at=>new Date(Date.parse(at)+9*3600000).toISOString().slice(0,10).replaceAll('-','');
const byProb=d=>[...d].sort((a,b)=>b.prob-a.prob||a.combo.localeCompare(b.combo)).slice(0,6).map(x=>x.combo);
const byOdds=d=>[...d].sort((a,b)=>a.odds-b.odds||a.combo.localeCompare(b.combo)).slice(0,6).map(x=>x.combo);

export function marketPick6Capture(r,model){
  const P=MARKET_PICK6_POLICY;
  if(!r||!model)return null;
  try{validateOddsCalibrationModel(model);}catch{return null;}
  const saved=Date.parse(r.saved_at),at=Date.parse(r.odds_snapshot_at),d=r.baseline_distribution;
  if(!Number.isFinite(saved)||saved<Date.parse(P.starts_at)||r.cohort!=='expert-shadow-official-v1'||auditRecord(r).length)return null;
  if(r.date!==jstDate(r.saved_at)||saved>=closeMs(r))return null;
  if(!Number.isFinite(at)||at>saved||at>=closeMs(r)||saved-at>P.max_odds_age_ms)return null;
  if(!Array.isArray(d)||d.length!==120||new Set(d.map(x=>x.combo)).size!==120||d.some(x=>!Number.isFinite(x.odds)||x.odds<=0||!Number.isFinite(x.prob)))return null;
  if(!Array.isArray(r.baseline_picks)||r.baseline_picks.length!==6||new Set(r.baseline_picks).size!==6)return null;
  const blend=oddsCalibratedDistribution(d,model);
  return {version:P.version,captured_at:r.saved_at,odds_snapshot_at:r.odds_snapshot_at,model_fingerprint:model.train_fingerprint,model_fitted_at:model.fitted_at,
    temperature:model.temperature,market_weight:model.market_weight,
    arms:{makeBets:[...r.baseline_picks],base_top6:byProb(d),market_top6:byOdds(d),blend75_top6:byProb(blend)}};
}
export function marketPick6Valid(r,model){
  const s=r.market_pick6_shadow;
  return !!s&&s.version===MARKET_PICK6_POLICY.version&&s.captured_at===r.saved_at&&JSON.stringify(s)===JSON.stringify(marketPick6Capture(r,model));
}
const settled=r=>!r.cancelled&&!r.excluded&&r.outcome&&!r.outcome.excluded&&/^([1-6])-([1-6])-([1-6])$/.test(r.outcome.result)&&new Set(r.outcome.result.split('-')).size===3&&Number.isSafeInteger(r.outcome.amount)&&r.outcome.amount>0;
const rng=seed=>()=>(seed=(seed*1103515245+12345)%2147483648)/2147483648;

export function marketPick6Report(records,model){
  const P=MARKET_PICK6_POLICY,all=Object.values(records).filter(r=>r.market_pick6_shadow);
  const excluded={not_settled_or_refund:0,invalid_capture:0};
  const rs=[];for(const r of all){if(!marketPick6Valid(r,model)){excluded.invalid_capture++;continue;}if(!settled(r)){excluded.not_settled_or_refund++;continue;}rs.push(r);}
  rs.sort((a,b)=>String(a.closed_at).localeCompare(String(b.closed_at))||Number(a.stadium)-Number(b.stadium)||Number(a.race)-Number(b.race));
  const dates=[...new Set(rs.map(r=>r.date))].sort();
  const ev=arm=>rs.map(r=>{const hit=r.market_pick6_shadow.arms[arm].includes(r.outcome.result);
    return {key:`${r.date}_${r.stadium}_${r.race}`,date:r.date,closed_at:String(r.closed_at),stadium:r.stadium,race:r.race,investment:P.picks*P.stake,payout:hit?r.outcome.amount*P.stake/100:0,hit};});
  const E=Object.fromEntries(P.arms.map(a=>[a,ev(a)])),arms={};
  for(const a of P.arms){const e=E[a],inv=e.reduce((s,x)=>s+x.investment,0),pay=e.reduce((s,x)=>s+x.payout,0),pays=e.filter(x=>x.hit).map(x=>x.payout).sort((x,y)=>y-x),hits=pays.length;
    arms[a]={races:e.length,hits,hit_rate:e.length?hits/e.length:null,investment:inv,payout:pay,profit:pay-inv,roi:inv?pay/inv:null,
      roi_without_top1:inv?(pay-(pays[0]||0))/inv:null,roi_without_top2:inv?(pay-(pays[0]||0)-(pays[1]||0))/inv:null,largest_payout:pays[0]||0,risk:riskMetrics(e)};}
  const contrasts={};
  for(const [x,y] of P.contrasts){
    const byDate={};let onlyX=0,onlyY=0,diff=0;
    E[x].forEach((ex,i)=>{const ey=E[y][i],d=(ex.payout-ex.investment)-(ey.payout-ey.investment);diff+=d;byDate[ex.date]=(byDate[ex.date]||0)+d;if(ex.hit&&!ey.hit)onlyX++;if(ey.hit&&!ex.hit)onlyY++;});
    const days=Object.values(byDate),r=rng(P.bootstrap.seed);let le0=0;
    if(days.length)for(let i=0;i<P.bootstrap.resamples;i++){let s=0;for(let k=0;k<days.length;k++)s+=days[Math.floor(r()*days.length)];le0+=s<=0;}
    contrasts[`${x}_minus_${y}`]={profit_difference:diff,daily_difference:byDate,days_better_same_worse:[days.filter(v=>v>0).length,days.filter(v=>v===0).length,days.filter(v=>v<0).length],
      only_first_hit:onlyX,only_second_hit:onlyY,mcnemar_z_exploratory:(onlyX-onlyY)/Math.sqrt(onlyX+onlyY||1),
      date_bootstrap_share_difference_le_0:days.length?le0/P.bootstrap.resamples:null};
  }
  const ready=dates.length>=P.review.min_dates&&rs.length>=P.review.min_races;
  return {policy:P,status:ready?'review_point_reached':'collecting_future',test_dates:dates,test_races:rs.length,excluded,ready_for_review:ready,production_changed:false,arms,contrasts,
    interpretation:'Pre-registered (dev/market-pick6-plan.md). Primary metric: ROI per arm; main contrasts blend75-makeBets and blend75-market. Same races, same saved pre-close odds, official payouts. Bootstrap shares are shares of date resamples, not probabilities of future results. Earlier races (including the 632 exploratory races) are not included. No adoption.'};
}
