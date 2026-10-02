import assert from 'node:assert/strict';
import {historicalOutcome} from './historical_outcome.mjs';
const race=()=>({boats:[
  {racer_boat_number:3,racer_course_number:3,racer_place_number:1},
  {racer_boat_number:6,racer_course_number:5,racer_place_number:2},
  {racer_boat_number:2,racer_course_number:2,racer_place_number:3},
  {racer_boat_number:4,racer_course_number:4,racer_place_number:14}],
  payouts:{trifecta:[{combination:'3-6-2',amount:91110}]}});
assert.deepEqual(historicalOutcome(race()),{eligible:true,combo:'3-6-2',amount:91110,winner:'3'});
let r=race();r.payouts.trifecta[0].combination='3-5-2';assert.equal(historicalOutcome(r).reason,'result_payout_mismatch');
r=race();r.boats[1].racer_place_number=1;assert.equal(historicalOutcome(r).reason,'missing_or_tied_top_three');
r=race();r.payouts.trifecta=[];assert.equal(historicalOutcome(r).eligible,false);
r=race();r.boats[1].racer_boat_number=3;assert.equal(historicalOutcome(r).reason,'invalid_boat_numbers');
r=race();r.payouts.trifecta[0].amount=null;assert.equal(historicalOutcome(r).eligible,false);
assert.equal(historicalOutcome({boats:[]}).eligible,false);
console.log('Historical outcome tests passed: boat/course distinction, exact payout matching, ties and cancellations excluded.');
