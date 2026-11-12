// Race-selection forward test (pre-registered in dev/race-selection-plan.md before this code).
// Same races; every arm buys the saved makeBets six picks x 100 yen, or skips the race (profit 0).
//   all     buy every eligible race
//   conc40  buy only if the saved model probability of the six picks sums to >= 0.2867 (primary)
//   lane1   buy only if lane 1's saved first-place probability >= 0.7701
import {auditRecord} from './shadow_diagnostics.mjs';
import {riskMetrics} from './variant_risk.mjs';

export const RACE_SELECTION_POLICY=Object.freeze({version:'race-selection-prospective-v1',starts_at:'2026-11-12T15:00:00Z',stake:100,picks:6,max_odds_age_ms:600000,
  thresholds:Object.freeze({conc40_min_pick_prob:0.2867,lane1_min_first_prob:0.7701}),arms:Object.freeze(['all','conc40','lane1']),primary:'conc40',
  review:Object.freeze({min_dates:14,min_primary_races:400,report_by:'2026-12-13'}),bootstrap:Object.freeze({resamples:10000,seed:20261113})});
const closeMs=r=>Date.parse(String(r.closed_at).replace(' ','T')+'+09:00');
const jstDate=at=>new Date(Date.parse(at)+9*3600000).toISOString().slice(0,10).replaceAll('-','');

// Features from the saved pre-close snapshot only; null when the record is not eligible.
export function selectionFeatures(r){
  const P=RACE_SELECTION_POLICY,saved=Date.parse(r.saved_at),at=Date.parse(r.odds_snapshot_at),d=r.baseline_distribution,picks=r.baseline_picks;
  if(r.cohort!=='expert-shadow-official-v1'||!Number.isFinite(saved)||saved<Date.parse(P.starts_at)||auditRecord(r).length)return null;
  if(r.date!==jstDate(r.saved_at)||saved>=closeMs(r)||!Number.isFinite(at)||at>saved||at>=closeMs(r)||saved-at>P.max_odds_age_ms)return null;
  if(!Array.isArray(d)||d.length!==120||new Set(d.map(x=>x.combo)).size!==120||d.some(x=>!(Number.isFinite(x.odds)&&x.odds>0)||!Number.isFinite(x.prob)))return null;
  if(!Array.isArray(picks)||picks.length!==6||new Set(picks).size!==6)return null;
  const m=new Map(d.map(x=>[x.combo,x.prob]));if(picks.some(c=>!m.has(c)))return null;
  const l1=(r.rank_probabilities||[]).find(x=>String(x.lane)==='1')?.p?.[0];if(!Number.isFinite(l1))return null;
  const pickProb=picks.reduce((s,c)=>s+m.get(c),0);
  return {pick_prob:pickProb,lane1_first_prob:l1,buy:{all:true,conc40:pickProb>=P.thresholds.conc40_min_pick_prob,lane1:l1>=P.thresholds.lane1_min_first_prob}};
}
const settled=r=>!r.cancelled&&!r.excluded&&r.outcome&&!r.outcome.excluded&&/^[1-6]-[1-6]-[1-6]$/.test(r.outcome.result)&&new Set(r.outcome.result.split('-')).size===3&&Number.isSafeInteger(r.outcome.amount)&&r.outcome.amount>0;
const rng=seed=>()=>(seed=(seed*1103515245+12345)%2147483648)/2147483648;

export function raceSelectionReport(records){
  const P=RACE_SELECTION_POLICY,excluded={not_eligible:0,not_settled_or_refund:0},rs=[];
  for(const r of Object.values(records)){
    if(r.cohort!=='expert-shadow-official-v1'||!(Date.parse(r.saved_at)>=Date.parse(P.starts_at)))continue;
    const f=selectionFeatures(r);if(!f){excluded.not_eligible++;continue;}if(!settled(r)){excluded.not_settled_or_refund++;continue;}rs.push({r,f});
  }
  rs.sort((a,b)=>String(a.r.closed_at).localeCompare(String(b.r.closed_at))||Number(a.r.stadium)-Number(b.r.stadium)||Number(a.r.race)-Number(b.r.race));
  const dates=[...new Set(rs.map(x=>x.r.date))].sort(),arms={},byDate={};
  for(const a of P.arms){
    const e=rs.filter(x=>x.f.buy[a]).map(({r})=>{const hit=r.baseline_picks.includes(r.outcome.result);return {date:r.date,closed_at:String(r.closed_at),stadium:r.stadium,race:r.race,investment:P.picks*P.stake,payout:hit?r.outcome.amount*P.stake/100:0,hit};});
    const inv=e.reduce((s,x)=>s+x.investment,0),pay=e.reduce((s,x)=>s+x.payout,0),pays=e.filter(x=>x.hit).map(x=>x.payout).sort((x,y)=>y-x);
    arms[a]={bought_races:e.length,skipped_races:rs.length-e.length,hits:pays.length,hit_rate:e.length?pays.length/e.length:null,investment:inv,payout:pay,profit:pay-inv,roi:inv?pay/inv:null,
      roi_without_top1:inv?(pay-(pays[0]||0))/inv:null,roi_without_top2:inv?(pay-(pays[0]||0)-(pays[1]||0))/inv:null,largest_payout:pays[0]||0,risk:riskMetrics(e)};
    byDate[a]={};for(const x of e){const d=byDate[a][x.date]=byDate[a][x.date]||{races:0,hits:0,investment:0,payout:0};d.races++;d.hits+=x.hit;d.investment+=x.investment;d.payout+=x.payout;}
  }
  const daily=Object.fromEntries(dates.map(d=>[d,Object.fromEntries(P.arms.map(a=>{const x=byDate[a][d];return [a,x?{...x,roi:x.payout/x.investment,hit_rate:x.hits/x.races}:null];}))]));
  // Date-level bootstrap of the difference (arm - all) in pooled ROI and hit rate.
  const vs={};
  for(const a of P.arms.filter(a=>a!=='all')){
    const units=dates.map(d=>[byDate[a][d]||{races:0,hits:0,investment:0,payout:0},byDate.all[d]]),r=rng(P.bootstrap.seed);let roiLe0=0,hitLe0=0,n=0;
    for(let i=0;i<(units.length?P.bootstrap.resamples:0);i++){const s=[0,0,0,0,0,0,0,0];for(let k=0;k<units.length;k++){const [x,y]=units[Math.floor(r()*units.length)];s[0]+=x.investment;s[1]+=x.payout;s[2]+=x.races;s[3]+=x.hits;s[4]+=y.investment;s[5]+=y.payout;s[6]+=y.races;s[7]+=y.hits;}
      if(!s[0]||!s[4])continue;n++;roiLe0+=s[1]/s[0]-s[5]/s[4]<=0;hitLe0+=s[3]/s[2]-s[7]/s[6]<=0;}
    const better=k=>dates.filter(d=>daily[d][a]&&daily[d][a][k]>daily[d].all[k]).length;
    vs[a]={roi_difference:arms[a].roi!=null&&arms.all.roi!=null?arms[a].roi-arms.all.roi:null,hit_rate_difference:arms[a].hit_rate!=null&&arms.all.hit_rate!=null?arms[a].hit_rate-arms.all.hit_rate:null,
      days_roi_higher:better('roi'),days_hit_rate_higher:better('hit_rate'),days_with_purchases:dates.filter(d=>daily[d][a]).length,
      date_bootstrap_share_roi_difference_le_0:n?roiLe0/n:null,date_bootstrap_share_hit_rate_difference_le_0:n?hitLe0/n:null};
  }
  const ready=dates.length>=P.review.min_dates&&arms[P.primary].bought_races>=P.review.min_primary_races;
  return {policy:P,status:ready?'review_point_reached':'collecting_future',test_dates:dates,test_races:rs.length,excluded,ready_for_review:ready,production_changed:false,arms,versus_all:vs,daily,
    interpretation:'Pre-registered (dev/race-selection-plan.md). Fixed thresholds from data saved on or before 2026-11-04; evaluation only on races saved from 2026-11-13 00:00 JST. Skipping reduces investment, so profit differences are not ROI improvements. Bootstrap shares are shares of date resamples, not probabilities. No adoption.'};
}
