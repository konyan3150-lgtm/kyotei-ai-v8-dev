import assert from 'node:assert/strict';
import {safeProgram,settleable,bootstrap} from './compare_official_history.mjs';
const input={racers:{1:{number:4142,age:44,weight:53,rank_number:'B1',result:{place:1},course_number:6}},preview:{racers:{1:{course_number:6}}},result:{}};
const r=safeProgram(input,'20250730');assert.equal(r.date,'20250730');assert.equal(r.preview,undefined);assert.equal(r.result,undefined);assert.equal(r.racers[1].course_number,undefined);assert.equal(r.racers[1].result,undefined);
const race={boats:[1,2,3,4,5,6].map(n=>({racer_boat_number:n,racer_place_number:n})),payouts:{trifecta:[{combination:'1-2-3',amount:1000}]}};assert.equal(settleable(race).eligible,true);race.boats[5].racer_place_number=null;assert.equal(settleable(race).eligible,false);
const s={races:10,top1:5,hits:3,stake:6000,payout:4000};const ci=bootstrap([{baseline:s,rolling:s}],50);for(const x of Object.values(ci))assert.deepEqual(x,{low:0,high:0});
console.log('Comparison tests passed: input allowlist, refund/special-result exclusion and paired date bootstrap.');
