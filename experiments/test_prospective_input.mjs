import assert from 'node:assert/strict';
import {verifyInput,verifyStore,sha256,COHORT,checkedOutcome,reopenUnconfirmed} from './prospective_input.mjs';
const data={through:'2026-10-01',starts:0,racers_count:0,racers:{},global_course:{},prospective_cohort:COHORT};const bytes=JSON.stringify(data);
const audit={status:'verified',cohort:COHORT,snapshot_sha256:sha256(bytes),through:data.through,starts:0,base_through:data.through,base_starts:0,appended_days:[]};
assert.equal(verifyInput(data,audit,'20261002',bytes).cohort,COHORT);
assert.throws(()=>verifyInput(data,audit,'20261003',bytes),/yesterday/);
assert.throws(()=>verifyInput(data,audit,'20261001',bytes),/yesterday/);
assert.throws(()=>verifyInput(data,audit,'20261002',bytes+' '),/Unverified/);
assert.throws(()=>verifyStore({records:{}}),/cohort/);
assert.throws(()=>verifyStore({cohort:COHORT,records:{x:{date:'20261002',cohort:COHORT,input_provenance:{cohort:COHORT,history_through:'2026-10-02'}}}}),/provenance/);
verifyStore({cohort:COHORT,records:{x:{date:'20261002',cohort:COHORT,input_provenance:{cohort:COHORT,history_through:'2026-10-01'}}}});
console.log('Prospective gates passed: cohort separation, exact previous-day history, tamper rejection.');

const race={boats:[1,2,3,4,5,6].map(n=>({racer_boat_number:n,racer_place_number:n})),payouts:{trifecta:[{combination:'1-2-3',amount:1200}]}};
assert.equal(checkedOutcome(race).amount,1200);race.boats[5].racer_place_number=14;assert.equal(checkedOutcome(race).exclude,true);assert.equal(checkedOutcome(null).pending,true);
const {snapshot,evaluate}=await import('./repaired_expert_shadow.mjs');
const rows=[1,2,3,4,5,6].map(k=>({k:String(k),p:[.2,.2,.2]}));
const excluded=snapshot({race:{date:'20261003',closed_at:'2026-10-03 10:00:00'},rows,expert:{version:2,weights:{},active:'normal'},date:'20261003',stadium:1,number:1,now:new Date('2026-10-03T00:50:00Z'),makeBets:()=>['1-2-3','1-2-4','1-2-5','1-2-6','1-3-2','1-3-4'].map(combo=>({combo}))});
excluded.excluded={reason:'special_result_or_possible_refund'};excluded.outcome={excluded:true};
const report=evaluate({x:excluded});assert.equal(report.excluded,1);assert.equal(report.invalid,0);assert.equal(report.settled,0);assert.equal(report.pending,0);
console.log('Special-result exclusion remains outside paired diagnostics and ROI.');

const placeholder={boats:[1,2,3,4,5,6].map(n=>({racer_boat_number:n,racer_place_number:null})),payouts:{trifecta:[]}};assert.equal(checkedOutcome(placeholder).pending,true);assert.equal(checkedOutcome(placeholder).exclude,undefined);
placeholder.payouts.trifecta=[{combination:'1-2-3',amount:1200}];assert.equal(checkedOutcome(placeholder).pending,true);
const old={records:{x:{excluded:{reason:'special_result_or_possible_refund'},outcome:{excluded:true},baseline_picks:['1-2-3']}}};assert.equal(reopenUnconfirmed(old),1);assert.equal(old.records.x.outcome,undefined);assert.equal(old.records.x.settlement_reviews.length,1);assert.deepEqual(old.records.x.baseline_picks,['1-2-3']);assert.equal(reopenUnconfirmed(old),0);
console.log('Incomplete placeholder results stay pending; unconfirmed exclusions reopen once with preserved review history.');
