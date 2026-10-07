import assert from 'node:assert/strict';
import {observedInputs,preserveRevision,markCancelled,realtimeSummary,applyPreclosePreview} from './realtime_shadow.mjs';
import {evaluate,settle} from './expert_shadow.mjs';
const state=observedInputs({preview:{wind_speed:null,wave_height:'',racers:{1:{start_timing:0,exhibition_time:'6.8'}}}});
assert.equal(state.water.wind_speed,null);assert.equal(state.exhibition[1].start_timing,0);
assert.equal(state.exhibition[1].exhibition_time,6.8);assert.equal(state.exhibition[1].lap_time,null);
const race={closed_at:'2026-10-03 12:00:00',preview:{racers:{1:{start_timing:0}}}};
assert.equal(applyPreclosePreview(race,{fetched_at:'2026-10-03T02:54:00Z',racers:{1:{start_timing:.05,exhibition_time:6.8}}},new Date('2026-10-03T02:55:00Z')),true);
assert.equal(race.preview.racers[1].start_timing,0);assert.equal(race.preview.racers[1].exhibition_time,6.8);
assert.equal(applyPreclosePreview(race,{fetched_at:'2026-10-03T03:01:00Z'},new Date('2026-10-03T02:55:00Z')),false);
const original={date:'20261003',stadium:'1',race:'1',closed_at:'2026-10-03 12:00:00',saved_at:'2026-10-03T02:50:00Z',
  rank_probabilities:[{lane:'1',p:[.5,.2,.2]}],expert:{weights:{inside:.5}},baseline_distribution:[{combo:'1-2-3',odds:20}],value_arms:{},input_state:state};
const first=preserveRevision(null,original);assert.equal(first.revision_number,1);
const same=preserveRevision(first,{...original,saved_at:'2026-10-03T02:51:00Z'});assert.deepEqual(same,first);
const second=preserveRevision(first,{...original,saved_at:'2026-10-03T02:52:00Z',input_state:{...state,water:{...state.water,wind_speed:5}}});
assert.equal(second.revisions.length,1);assert.equal(second.revisions[0].saved_at,first.saved_at);
assert.deepEqual(second.change_reasons,['water_changed']);assert.equal(first.revisions.length,0);
assert.throws(()=>preserveRevision(second,{...original,saved_at:'2026-10-03T03:00:00Z'}));
assert.throws(()=>preserveRevision(second,{...original,saved_at:'2026-10-03T02:49:00Z'}));
assert.throws(()=>preserveRevision(second,{...original,race:'2',saved_at:'2026-10-03T02:55:00Z'}));
const delayed=preserveRevision(first,{...original,closed_at:'2026-10-03 12:05:00',saved_at:'2026-10-03T02:55:00Z'});
assert.deepEqual(delayed.change_reasons,['close_time_changed']);
assert.equal(delayed.revisions[0].closed_at,original.closed_at);
assert.equal(first.closed_at,original.closed_at);
const earlier=preserveRevision(first,{...original,closed_at:'2026-10-03 11:58:00',saved_at:'2026-10-03T02:55:00Z'});
assert.equal(earlier.closed_at,'2026-10-03 11:58:00');
assert.throws(()=>preserveRevision(first,{...original,closed_at:'2026-10-03 12:05:00',saved_at:'2026-10-03T03:00:00Z'}),e=>e.code==='REVISION_IDENTITY_MISMATCH'&&e.differences.closed_at.previous===original.closed_at);
assert.throws(()=>preserveRevision(first,{...original,closed_at:'2026-10-03 11:54:00',saved_at:'2026-10-03T02:55:00Z'}),/before close/);
for(const [field,value] of [['date','20261004'],['stadium','2'],['race','2']]){
 assert.throws(()=>preserveRevision(first,{...original,[field]:value,saved_at:'2026-10-03T02:55:00Z'}),e=>e.code==='REVISION_IDENTITY_MISMATCH'&&e.differences[field].next===value);
}
const summary=realtimeSummary({a:second});assert.equal(summary.preserved_previous_snapshots,1);assert.equal(summary.change_reasons.water_changed,1);
assert.equal(markCancelled(second,{cancelled:false}),false);
assert.equal(markCancelled(second,{cancelled:true,source:'official test'}),true);
assert.equal(settle(second,{combination:'1-2-3',amount:1000}),false);
assert.equal(preserveRevision(second,original),second);
const report=evaluate({a:second});assert.equal(report.cancelled,1);assert.equal(report.pending,0);assert.equal(report.arms.baseline.investment,0);
console.log('Realtime tests passed: numeric missingness, change history, immutable snapshots, time gates, cancellation and exclusion.');
