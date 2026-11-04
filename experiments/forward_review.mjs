// Review of two pre-registered forward tests (conservative_ev, odds_calibration) at a fixed cutoff.
// Uses the unchanged report functions on the archive; adds only the items the plans ask for in the review
// (bootstrap shares, daily differences) and, for odds_calibration, the six-pick hit rate promised for case 2.
// No arm, threshold or model is changed; no adoption decision is made here.
import fs from 'node:fs';
import path from 'node:path';
import {conservativeEvReport,CONSERVATIVE_ARMS} from './conservative_ev.mjs';
import {oddsCalibrationReport,validateOddsCalibrationModel} from './odds_calibration.mjs';
import {loadArchive} from './walkforward_calibration.mjs';

export const REVIEW_POLICY=Object.freeze({version:'forward-review-2026-11-04',cutoff_date:'20261103',bootstrap:Object.freeze({resamples:10000,seed:20261104})});
const rng=seed=>()=>(seed=(seed*1103515245+12345)%2147483648)/2147483648;
// Share of resamples with ROI < 1. unit = race (as the plan says) or date (sensitivity for within-day correlation).
export function bootstrapRoiBelow1(events,unit,{resamples,seed}=REVIEW_POLICY.bootstrap){
  const groups=unit==='date'?Object.values(events.reduce((g,e)=>((g[e.date]=g[e.date]||[]).push(e),g),{})):events.map(e=>[e]);
  const sums=groups.map(g=>[g.reduce((s,e)=>s+e.investment,0),g.reduce((s,e)=>s+e.payout,0)]),r=rng(seed);let below=0,n=0;
  for(let i=0;i<resamples;i++){let inv=0,pay=0;for(let k=0;k<sums.length;k++){const x=sums[Math.floor(r()*sums.length)];inv+=x[0];pay+=x[1];}if(inv>0){n++;below+=pay<inv;}}
  return {unit,groups:groups.length,resamples:n,share_roi_below_1:n?below/n:null};
}
const top6=d=>[...d].sort((a,b)=>b.prob-a.prob||a.combo.localeCompare(b.combo)).slice(0,6).map(x=>x.combo);

export function forwardReview(records,model){
  const R=records.filter(r=>r.date<=REVIEW_POLICY.cutoff_date);
  // conservative_ev
  const cev=conservativeEvReport(R),valid=Object.values(R).filter(r=>r.conservative_ev_shadow&&cev.test_dates.includes(r.date));
  const evs=arm=>R.filter(r=>r.conservative_ev_shadow).map(r=>{const s=r.conservative_ev_shadow.arms[arm],w=s.items.find(x=>x.combo===r.outcome?.result);return {date:r.date,key:`${r.date}_${r.stadium}_${r.race}`,investment:s.investment,payout:w?r.outcome.amount*w.stake/100:0};});
  // restrict bootstrap to the races the report counted (same filter: re-derive keys from report by date set and settled outcome)
  const counted=new Set();{const rep=conservativeEvReport(R);for(const r of R){if(!r.conservative_ev_shadow)continue;const one=conservativeEvReport([r]);if(one.test_races===1)counted.add(`${r.date}_${r.stadium}_${r.race}`);}if(counted.size!==rep.test_races)throw new Error('counted mismatch');}
  const boot={};for(const arm of CONSERVATIVE_ARMS){const e=evs(arm).filter(x=>counted.has(x.key)&&x.investment>0);boot[arm]={race:bootstrapRoiBelow1(e,'race'),date:bootstrapRoiBelow1(e,'date')};}
  // odds_calibration
  validateOddsCalibrationModel(model);
  const oc=oddsCalibrationReport(R,{model});
  const ocRaces=R.filter(r=>{const one=oddsCalibrationReport([r],{model});return one.test_races===1;});
  if(ocRaces.length!==oc.test_races)throw new Error('odds_calibration race mismatch');
  const six={base_top6:0,calibrated_top6:0,saved_picks:0},pair={changed_tickets:0,races_changed:0,base_only:0,calibrated_only:0},daily={};let expCal=0,hitCal=0;
  for(const r of ocRaces){
    const b=top6(r.baseline_distribution),c=top6(r.odds_calibration_shadow.distribution),res=r.outcome.result,hb=b.includes(res),hc=c.includes(res),hs=(r.baseline_picks||[]).includes(res);
    six.base_top6+=hb;six.calibrated_top6+=hc;six.saved_picks+=hs;const ch=c.filter(x=>!b.includes(x)).length;pair.changed_tickets+=ch;pair.races_changed+=ch>0;pair.base_only+=hb&&!hc;pair.calibrated_only+=hc&&!hb;
    const d=daily[r.date]=daily[r.date]||{races:0,base_top6:0,calibrated_top6:0};d.races++;d.base_top6+=hb;d.calibrated_top6+=hc;
    for(const t of r.odds_calibration_shadow.value.items){expCal+=t.prob;hitCal+=t.combo===res;}
  }
  const dd=Object.values(daily).map(x=>x.calibrated_top6-x.base_top6);
  const ocEvents=arm=>ocRaces.map(r=>{const m=arm==='raw'?r.outcome.value_metrics.baseline:r.outcome.odds_calibration;return {date:r.date,investment:m.investment,payout:m.payout};}).filter(e=>e.investment>0);
  return {policy:REVIEW_POLICY,production_changed:false,
    conservative_ev:{status:cev.status,test_dates:cev.test_dates,test_races:cev.test_races,arms:cev.arms,bootstrap:boot},
    odds_calibration:{status:oc.status,selected:oc.selected,model_fitted_at:oc.model_fitted_at,test_dates:oc.test_dates,test_races:oc.test_races,arms:oc.arms,
      calibrated_ev_expected_vs_actual_hits:{expected:expCal,actual:hitCal},
      bootstrap:Object.fromEntries(['raw','calibrated'].map(a=>[a,{race:bootstrapRoiBelow1(ocEvents(a),'race'),date:bootstrapRoiBelow1(ocEvents(a),'date')}])),
      pick6:{races:ocRaces.length,...six,pairs:{...pair,mcnemar_z_exploratory:(pair.calibrated_only-pair.base_only)/Math.sqrt(pair.base_only+pair.calibrated_only||1)},
        days_calibrated_more_same_fewer:[dd.filter(x=>x>0).length,dd.filter(x=>!x).length,dd.filter(x=>x<0).length],daily}},
    interpretation:'Review at a fixed cutoff (complete dates through 2026-11-03). Bootstrap shares are shares of resamples, not probabilities of future loss; race-level resampling ignores same-day/same-venue factors, date-level resampling has few units. pick6 for odds_calibration is an added descriptive comparison (case 2), not part of the original EV comparison. No adoption.'};
}

if(import.meta.url===`file://${process.argv[1]}`){
  const root=path.resolve(import.meta.dirname,'..'),model=JSON.parse(fs.readFileSync(path.join(root,'dev/probability-calibration/odds-aware-v1.json'),'utf8'));
  const out=forwardReview(loadArchive(path.join(root,'dev/expert-shadow-repaired-archive')),model.model||model);
  fs.mkdirSync(path.join(root,'dev/forward-review'),{recursive:true});fs.writeFileSync(path.join(root,'dev/forward-review/2026-11-04.json'),JSON.stringify(out,null,1)+'\n');
  const f=x=>x==null?'—':(+x).toFixed(3);const c=out.conservative_ev,o=out.odds_calibration;
  console.log('CEV',c.status,c.test_dates.length,'dates',c.test_races,'races');
  for(const [k,a] of Object.entries(c.arms))console.log(k,a.bought_races,a.tickets,a.hits,f(a.expected_hits),a.investment,a.payout,f(a.roi),f(a.roi_without_top1),f(a.roi_without_top2),a.largest_payout,a.profit_minus_reference,a.risk?.max_drawdown,'boot race',f(c.bootstrap[k].race.share_roi_below_1),'date',f(c.bootstrap[k].date.share_roi_below_1));
  console.log('ODDS',o.status,o.test_dates.length,'dates',o.test_races,'races',JSON.stringify(o.selected));
  for(const [k,a] of Object.entries(o.arms))console.log(k,a.bought_races,a.skipped_races,a.hits,a.investment,a.payout,f(a.roi),f(a.log_loss),f(a.brier),a.risk?.max_drawdown,'boot race',f(o.bootstrap[k].race.share_roi_below_1),'date',f(o.bootstrap[k].date.share_roi_below_1));
  console.log('cal EV exp/act',f(o.calibrated_ev_expected_vs_actual_hits.expected),o.calibrated_ev_expected_vs_actual_hits.actual);
  const {daily,...p}=o.pick6;console.log('pick6',JSON.stringify(p));
}
