import assert from 'node:assert/strict';
import {snapshots,stagesOf,hasExhibition,compareRace,revisionReport} from './revision_history.mjs';

const combos=[];for(const a of '123456')for(const b of '123456')for(const c of '123456')if(a!==b&&a!==c&&b!==c)combos.push(`${a}-${b}-${c}`);
const dist=(top,odds=20)=>combos.map(c=>({combo:c,prob:c===top?.31:.69/119,odds}));
const picks=top=>[top,...combos.filter(c=>c!==top).slice(-5)];
const ex={};for(const k of '123456')ex[k]={exhibition_time:6.8};
const snap=(n,savedAt,top,{exh=false,odds=20,oddsAt}={})=>({revision_number:n,saved_at:savedAt,odds_snapshot_at:oddsAt||new Date(Date.parse(savedAt)-120000).toISOString(),
  baseline_distribution:dist(top,odds),candidate_distribution:dist(top,odds),baseline_picks:picks(top),candidate_picks:picks(top),
  input_state:{water:{},exhibition:exh?ex:null},engine_commit:'e1',collector_version:'v3'});
const base={cohort:'expert-shadow-official-v1',date:'20261020',stadium:'1',race:'1',closed_at:'2026-10-20 10:30:00',outcome:{result:'1-2-3',amount:2000}};
// close 01:30Z; initial 00:30Z (no exhibition), exhibition 01:00Z, final 01:25Z
const s1=snap(1,'2026-10-20T00:30:00Z','4-5-6'),s2=snap(2,'2026-10-20T01:00:00Z','1-2-3',{exh:true}),s3=snap(3,'2026-10-20T01:25:00Z','1-2-3',{exh:true,odds:30});
const r={...base,...s3,revisions:[s2,s1]};

assert.deepEqual(snapshots(r).map(s=>s.revision_number),[1,2,3]);
assert.ok(!hasExhibition(s1)&&hasExhibition(s2));
const st=stagesOf(r);assert.equal(st.category,'compared');assert.equal(st.exhibition,'after_initial');
assert.equal(st.stages.initial.revision_number,1);assert.equal(st.stages.post_exhibition.revision_number,2);assert.equal(st.stages.final.revision_number,3);
// Classification, nothing filled in.
assert.equal(stagesOf({...base,...s1,revisions:[]}).category,'no_revision');
assert.equal(stagesOf({...base,...s3,revisions:[s2]}).category,'initial_missing_or_invalid');                          // no revision 1
assert.equal(stagesOf({...base,...s3,revisions:[s2,{...s1,baseline_distribution:s1.baseline_distribution.slice(1)}]}).category,'initial_missing_or_invalid');
assert.equal(stagesOf({...base,...s2,revisions:[s1],saved_at:'2026-10-20T01:35:00Z'}).category,'final_missing_or_invalid'); // saved after close: never used
assert.equal(stagesOf({...base,...snap(2,'2026-10-20T01:00:00Z','1-2-3'),revisions:[s1]}).exhibition,'never');
assert.equal(stagesOf({...base,...s3,revisions:[{...s1,input_state:{exhibition:ex}}]}).exhibition,'at_initial');
// Comparison of one race: probability side, operational with each snapshot's own odds, same-odds with the later odds.
const c=compareRace(r,s1,s3);
assert.ok(c.probability.to.log_loss<c.probability.from.log_loss);assert.equal(c.probability.to.set_hit,1);assert.equal(c.probability.from.set_hit,0);
assert.ok(Math.abs(c.probability.to.set_prob-(.31+5*.69/119))<1e-12);
assert.equal(c.operational.from.pick6.investment,600);assert.equal(c.operational.to.pick6.payout,2000);
assert.equal(c.operational.to.ev.status,'ok');assert.equal(c.operational.to.ev.payout,2000);       // .31*.75*30 >= 1.08 -> bought, hit
assert.equal(c.same_odds.from.status,'ok');
assert.ok(Math.abs(c.to.minutes_to_close-5)<1e-9);assert.ok(Math.abs(c.to.odds_age_minutes-2)<1e-9);
// Stale own odds at the earlier snapshot: operational is "unavailable" (not filled with later odds).
const stale={...s1,odds_snapshot_at:'2026-10-20T00:10:00Z'};const c2=compareRace(r,stale,s3);assert.equal(c2.operational.from.ev.status,'odds_unavailable_or_stale');assert.equal(c2.operational.from.ev.investment,0);
// Report: pairs on the same races, categories, excluded/unsettled races ignored, records unchanged.
const before=JSON.stringify(r);
const rep=revisionReport([r,{...r,race:'2',revisions:[]},{...r,race:'3',excluded:{kind:'refund'}},{...r,race:'4',outcome:null}]);
assert.equal(JSON.stringify(r),before);
assert.equal(rep.settled_races,2);assert.deepEqual(rep.categories,{compared:1,no_revision:1});
assert.equal(rep.pairs['initial->final'].races,1);assert.equal(rep.pairs['initial->post_exhibition'].races,1);assert.equal(rep.pairs['post_exhibition->final'].races,1);
assert.equal(rep.production_changed,false);
// Odds availability: reasons in a fixed order, four classes, both-ok subset.
{const {oddsAvailability}=await import('./revision_history.mjs');
 assert.equal(oddsAvailability({...s1,odds_snapshot_at:null}),'no_snapshot');
 assert.equal(oddsAvailability({...s1,odds_snapshot_at:'2026-10-20T00:31:00Z'}),'future');
 assert.equal(oddsAvailability({...s1,odds_snapshot_at:'2026-10-20T00:19:00Z'}),'stale_over_10min');
 assert.equal(oddsAvailability({...s1,baseline_distribution:s1.baseline_distribution.map((x,i)=>i?x:{...x,odds:null})}),'incomplete_120');
 assert.equal(oddsAvailability(s1),'ok');
 const staleFinal={...s3,odds_snapshot_at:'2026-10-20T01:10:00Z'};
 const rows=[{...r,race:'5',...staleFinal,revisions:[s2,s1]},r];
 const p=revisionReport(rows).pairs['initial->final'];
 assert.deepEqual(p.odds_availability.classes,{both_ok:1,from_only:1,to_only:0,neither:0});
 assert.deepEqual(p.odds_availability.reasons.to,{stale_over_10min:1,ok:1});
 assert.equal(p.odds_availability.later_unusable.races,1);assert.equal(p.odds_availability.later_unusable.odds_age_minutes_median,15);
 assert.equal(p.odds_availability.both_ok_operational.ev.from.races,1);assert.ok(Number.isFinite(p.log_loss_diff.se_race_level));}
console.log('revision history OK: odds availability classes and reasons, both-ok subset,  stage definitions (initial / post-exhibition / final before close), classification without filling, same-race pairs, probability vs operational vs same-odds comparisons, stale odds kept unavailable');
