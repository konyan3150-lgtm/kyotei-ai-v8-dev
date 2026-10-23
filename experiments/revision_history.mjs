// Revision history analysis (exploratory; definitions fixed in dev/revision-history-plan.md before looking at results).
// Each repaired-shadow record keeps its earlier snapshots in r.revisions and the latest one in the record itself.
// Stages (chosen from pre-close information only; results are labels for evaluation, never for choosing snapshots):
//   initial          the snapshot with revision_number 1
//   post_exhibition  the earliest snapshot whose input_state has exhibition data for all six boats, when the
//                    initial snapshot did not have it yet
//   final            the last snapshot saved before close
// A snapshot is valid when auditRecord() accepts it (saved before close, 120 combinations, probability mass, picks).
// Pairs: initial->final, initial->post_exhibition, post_exhibition->final, each only on races where both snapshots
// exist, are valid and differ. Races are classified (no revision, invalid initial/final, exhibition never/at initial)
// and nothing is filled in afterwards.
// Two separate comparisons per pair:
//   probability   log loss, Brier, top-1 hit and the 6-pick set (hit, probability) on the same races
//   decision      (a) operational: each snapshot with its own saved odds (shadow EV rule, odds at most 10 minutes
//                 old at that snapshot's save time) and its own 6 picks; (b) same-odds: both snapshots' probabilities
//                 with the final snapshot's odds, so only the probability change differs.
// Payouts are the official trifecta payouts. Final odds are never treated as known at an earlier snapshot except in
// the explicitly labelled same-odds analysis, which is not an operational result.
import fs from 'node:fs';
import path from 'node:path';
import {auditRecord} from './shadow_diagnostics.mjs';
import {evTickets} from './ev_drift.mjs';
import {raceMetrics,loadArchive} from './walkforward_calibration.mjs';

export const REVISION_POLICY=Object.freeze({version:'revision-history-v1',stages:['initial','post_exhibition','final'],
  pairs:[['initial','final'],['initial','post_exhibition'],['post_exhibition','final']],stake:100});

const closeMs=r=>Date.parse(String(r.closed_at).replace(' ','T')+'+09:00');
export function snapshots(r){
  const {revisions,...current}=r;
  return [...(revisions||[]),current].filter(Boolean).sort((a,b)=>(a.revision_number||0)-(b.revision_number||0));
}
export const hasExhibition=s=>{const e=s?.input_state?.exhibition;return !!e&&['1','2','3','4','5','6'].every(k=>Number.isFinite(e[k]?.exhibition_time));};
export const validSnapshot=(s,r)=>!auditRecord({...s,closed_at:r.closed_at}).length&&Date.parse(s.saved_at)<closeMs(r);

export function stagesOf(r){
  const snaps=snapshots(r);
  if(snaps.length<2)return {category:'no_revision',snapshots:snaps.length};
  const initial=snaps.find(s=>s.revision_number===1),final=[...snaps].reverse().find(s=>Date.parse(s.saved_at)<closeMs(r));
  if(!initial||!validSnapshot(initial,r))return {category:'initial_missing_or_invalid',snapshots:snaps.length};
  if(!final||!validSnapshot(final,r)||final===initial)return {category:'final_missing_or_invalid',snapshots:snaps.length};
  const stages={initial,final};let exhibition='never';
  if(hasExhibition(initial))exhibition='at_initial';
  else{const e=snaps.find(s=>s.revision_number>1&&hasExhibition(s)&&Date.parse(s.saved_at)<closeMs(r));if(e&&validSnapshot(e,r)){stages.post_exhibition=e;exhibition='after_initial';}else if(e)exhibition='invalid';}
  return {category:'compared',snapshots:snaps.length,exhibition,stages};
}

// Why a snapshot has no usable odds for the EV rule (same checks as evTickets, in a fixed order). 'ok' only means the
// odds are usable; whether the EV rule then buys anything is a separate question (a skip with valid inputs).
export function oddsAvailability(s){
  if(!s.odds_snapshot_at||!Number.isFinite(Date.parse(s.odds_snapshot_at)))return 'no_snapshot';
  const age=Date.parse(s.saved_at)-Date.parse(s.odds_snapshot_at);
  if(age<0)return 'future';
  if(age>10*60000)return 'stale_over_10min';
  const n=(s.baseline_distribution||[]).filter(x=>Number.isFinite(x.odds)&&x.odds>0).length;
  if(n<120)return 'incomplete_120';
  return 'ok';
}
function meta(s,r){
  return {saved_at:s.saved_at,minutes_to_close:(closeMs(r)-Date.parse(s.saved_at))/60000,odds_age_minutes:s.odds_snapshot_at?(Date.parse(s.saved_at)-Date.parse(s.odds_snapshot_at))/60000:null,
    engine_commit:s.engine_commit||null,collector_version:s.collector_version||null,revision_number:s.revision_number,odds:oddsAvailability(s),change_reasons:s.change_reasons||[]};
}
function probSide(s,r){
  const m=raceMetrics(s.baseline_distribution,r.outcome.result),picks=new Set(s.baseline_picks);
  return {log_loss:m.log_loss,brier:m.brier,top1:m.top1,set_hit:Number(picks.has(r.outcome.result)),set_prob:s.baseline_distribution.filter(x=>picks.has(x.combo)).reduce((a,x)=>a+x.prob,0)};
}
function evSide(dist,oddsDist,oddsAt,savedAt,r){
  const t=evTickets(dist,oddsDist,oddsAt,savedAt);
  if(t.status!=='shadow_estimate_uncalibrated')return {status:t.status,investment:0,payout:0,hit:false,tickets:0};
  const w=t.items.find(x=>x.combo===r.outcome.result);
  return {status:'ok',investment:t.investment,payout:w?r.outcome.amount*w.stake/100:0,hit:!!w,tickets:t.items.length};
}
function pick6Side(s,r){const hit=s.baseline_picks.includes(r.outcome.result);return {investment:6*REVISION_POLICY.stake,payout:hit?r.outcome.amount:0,hit};}

export function compareRace(r,a,b){
  const A=a,B=b,fin=b;   // same-odds analysis uses the later snapshot's odds (the final one for *->final pairs)
  return {date:r.date,stadium:r.stadium,race:r.race,from:meta(A,r),to:meta(B,r),
    probability:{from:probSide(A,r),to:probSide(B,r)},
    operational:{from:{ev:evSide(A.baseline_distribution,A.baseline_distribution,A.odds_snapshot_at,A.saved_at,r),pick6:pick6Side(A,r)},
                 to:{ev:evSide(B.baseline_distribution,B.baseline_distribution,B.odds_snapshot_at,B.saved_at,r),pick6:pick6Side(B,r)}},
    same_odds:{from:evSide(A.baseline_distribution,fin.baseline_distribution,fin.odds_snapshot_at,fin.saved_at,r),to:evSide(B.baseline_distribution,fin.baseline_distribution,fin.odds_snapshot_at,fin.saved_at,r)}};
}

const sum=(xs,f)=>xs.reduce((a,x)=>a+f(x),0);
function money(xs){const inv=sum(xs,x=>x.investment),pay=sum(xs,x=>x.payout);return {races:xs.length,bought:xs.filter(x=>x.investment>0).length,hits:xs.filter(x=>x.hit).length,investment:inv,payout:pay,roi:inv?pay/inv:null,unavailable:xs.filter(x=>x.status&&x.status!=='ok').length};}
const median=xs=>{const v=xs.filter(Number.isFinite).sort((a,b)=>a-b);return v.length?v[Math.floor(v.length/2)]:null;};
function availability(rows){
  const both=rows.filter(x=>x.from.odds==='ok'&&x.to.odds==='ok'),cls={both_ok:both.length,from_only:0,to_only:0,neither:0},reasons={from:{},to:{}};
  for(const x of rows){
    if(x.from.odds==='ok'&&x.to.odds!=='ok')cls.from_only++;else if(x.from.odds!=='ok'&&x.to.odds==='ok')cls.to_only++;else if(x.from.odds!=='ok'&&x.to.odds!=='ok')cls.neither++;
    for(const side of ['from','to'])reasons[side][x[side].odds]=(reasons[side][x[side].odds]||0)+1;
  }
  // Unusable odds at the later snapshot: how old the odds were at save time, how close to the race, and why the snapshot was saved.
  const bad=rows.filter(x=>x.to.odds!=='ok'),why={};for(const x of bad)for(const c of x.to.change_reasons)why[c]=(why[c]||0)+1;
  const staleAge=bad.filter(x=>x.to.odds==='stale_over_10min').map(x=>x.to.odds_age_minutes);
  return {classes:cls,reasons,later_unusable:{races:bad.length,odds_age_minutes_median:median(staleAge),odds_age_minutes_max:staleAge.length?Math.max(...staleAge):null,
      minutes_to_close_median:median(bad.map(x=>x.to.minutes_to_close)),same_odds_snapshot_as_earlier:bad.filter(x=>x.to.odds!=='no_snapshot'&&x.from.saved_at&&x.to.odds_age_minutes!=null&&
      x.from.odds_age_minutes!=null&&Date.parse(x.to.saved_at)-x.to.odds_age_minutes*60000===Date.parse(x.from.saved_at)-x.from.odds_age_minutes*60000).length,change_reasons:why},
    both_ok_operational:{ev:{from:money(both.map(x=>x.operational.from.ev)),to:money(both.map(x=>x.operational.to.ev))},pick6:{from:money(both.map(x=>x.operational.from.pick6)),to:money(both.map(x=>x.operational.to.pick6))}}};
}
export function summarizePair(rows){
  const n=rows.length,pf=rows.map(x=>x.probability.from),pt=rows.map(x=>x.probability.to);
  const mean=(xs,k)=>n?sum(xs,x=>x[k])/n:null;
  const byDate={};for(const x of rows){(byDate[x.date]=byDate[x.date]||{races:0,ll:0}).races++;byDate[x.date].ll+=x.probability.to.log_loss-x.probability.from.log_loss;}
  return {races:n,
    probability:{log_loss:{from:mean(pf,'log_loss'),to:mean(pt,'log_loss')},brier:{from:mean(pf,'brier'),to:mean(pt,'brier')},top1_hit:{from:mean(pf,'top1'),to:mean(pt,'top1')},
      pick6_set_hit:{from:mean(pf,'set_hit'),to:mean(pt,'set_hit')},pick6_set_prob:{from:mean(pf,'set_prob'),to:mean(pt,'set_prob')},
      dates:Object.keys(byDate).length,dates_to_better:Object.values(byDate).filter(d=>d.ll<0).length,daily_mean_ll_diff:Object.fromEntries(Object.entries(byDate).map(([d,v])=>[d,v.ll/v.races]))},
    operational:{ev:{from:money(rows.map(x=>x.operational.from.ev)),to:money(rows.map(x=>x.operational.to.ev))},pick6:{from:money(rows.map(x=>x.operational.from.pick6)),to:money(rows.map(x=>x.operational.to.pick6))}},
    same_odds_ev:{from:money(rows.map(x=>x.same_odds.from)),to:money(rows.map(x=>x.same_odds.to))},
    odds_availability:availability(rows),
    log_loss_diff:(()=>{const d=rows.map(x=>x.probability.to.log_loss-x.probability.from.log_loss),n=d.length,m=n?d.reduce((a,x)=>a+x,0)/n:null,sd=n>1?Math.sqrt(d.reduce((a,x)=>a+(x-m)**2,0)/(n-1)):null;
      return {mean:m,se_race_level:sd!=null?sd/Math.sqrt(n):null,note:'Race-level SE ignores within-day correlation.'};})(),
    timing:{from_minutes_to_close_median:median(rows.map(x=>x.from.minutes_to_close)),to_minutes_to_close_median:median(rows.map(x=>x.to.minutes_to_close)),
      from_odds_age_median:median(rows.map(x=>x.from.odds_age_minutes)),to_odds_age_median:median(rows.map(x=>x.to.odds_age_minutes)),
      engine_changed:rows.filter(x=>x.from.engine_commit!==x.to.engine_commit).length}};
}

export function revisionReport(records){
  const settled=records.filter(r=>r&&r.cohort==='expert-shadow-official-v1'&&!r.excluded&&!r.cancelled&&r.outcome?.result&&Number.isSafeInteger(r.outcome.amount)&&r.outcome.amount>0);
  const categories={},exhibition={},pairs=Object.fromEntries(REVISION_POLICY.pairs.map(([a,b])=>[`${a}->${b}`,[]]));
  for(const r of settled){
    const s=stagesOf(r);categories[s.category]=(categories[s.category]||0)+1;
    if(s.category!=='compared')continue;
    exhibition[s.exhibition]=(exhibition[s.exhibition]||0)+1;
    for(const [a,b] of REVISION_POLICY.pairs){const A=s.stages[a],B=s.stages[b];if(A&&B&&A!==B)pairs[`${a}->${b}`].push(compareRace(r,A,B));}
  }
  return {policy:REVISION_POLICY,settled_races:settled.length,categories,exhibition_timing:exhibition,
    pairs:Object.fromEntries(Object.entries(pairs).map(([k,rows])=>[k,summarizePair(rows)])),production_changed:false,
    interpretation:'Exploratory, limited to races with revision records (not all races). Same races per pair. Improvements cannot be attributed to exhibition data alone: odds, times, water and other inputs change between snapshots. Unusable odds (no snapshot, over 10 minutes, future, incomplete) are kept apart from skips with valid inputs. Probability and decision comparisons are separate. Operational = each snapshot with its own saved odds; same-odds = probabilities only, with the later snapshot odds (not an operational result). Missing/invalid snapshots are classified, never filled in.'};
}

if(import.meta.url===`file://${process.argv[1]}`){
  const root=path.resolve(import.meta.dirname,'..');
  const out=revisionReport(loadArchive(path.join(root,'dev/expert-shadow-repaired-archive')));
  const dir=path.join(root,'dev/revision-history');fs.mkdirSync(dir,{recursive:true});
  fs.writeFileSync(path.join(dir,'report.json'),JSON.stringify(out,null,1)+'\n');
  console.log(JSON.stringify({settled:out.settled_races,categories:out.categories,exhibition:out.exhibition_timing}));
  const f=(x,d=4)=>x==null?'—':Number(x).toFixed(d);
  for(const [k,p] of Object.entries(out.pairs)){
    console.log(`${k}: ${p.races}R LL ${f(p.probability.log_loss.from)}->${f(p.probability.log_loss.to)} (better ${p.probability.dates_to_better}/${p.probability.dates} dates) set hit ${f(p.probability.pick6_set_hit.from,3)}->${f(p.probability.pick6_set_hit.to,3)}`);
    for(const [n,m] of [['op ev',p.operational.ev],['op pick6',p.operational.pick6],['same-odds ev',p.same_odds_ev]])
      console.log(`   ${n}: from ${m.from.bought}R ${m.from.hits}hit ROI ${f(m.from.roi,3)} (n/a ${m.from.unavailable}) -> to ${m.to.bought}R ${m.to.hits}hit ROI ${f(m.to.roi,3)} (n/a ${m.to.unavailable})`);
    const av=p.odds_availability;console.log(`   odds availability: ${JSON.stringify(av.classes)} reasons from ${JSON.stringify(av.reasons.from)} to ${JSON.stringify(av.reasons.to)}`);
    console.log(`   later unusable: ${JSON.stringify(av.later_unusable)}`);
    console.log(`   both-ok op ev: from ${av.both_ok_operational.ev.from.bought}R ${av.both_ok_operational.ev.from.hits}hit ROI ${f(av.both_ok_operational.ev.from.roi,3)} -> to ${av.both_ok_operational.ev.to.bought}R ${av.both_ok_operational.ev.to.hits}hit ROI ${f(av.both_ok_operational.ev.to.roi,3)}; LL diff ${f(p.log_loss_diff.mean)} SE ${f(p.log_loss_diff.se_race_level)}`);
    console.log(`   timing: to-close ${f(p.timing.from_minutes_to_close_median,1)}->${f(p.timing.to_minutes_to_close_median,1)} min, odds age ${f(p.timing.from_odds_age_median,1)}->${f(p.timing.to_odds_age_median,1)} min, engine changed ${p.timing.engine_changed}`);
  }
}
