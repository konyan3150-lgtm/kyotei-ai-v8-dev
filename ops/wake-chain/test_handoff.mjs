import assert from 'node:assert/strict';
import {handoff,HANDOFF} from './handoff.mjs';
import {handoffGate,GATE} from './handoff_gate.mjs';

const MIN=60000,jst=(h,m=0)=>Date.UTC(2026,9,23,h-9,m);
// Fake GitHub with a clock; runs change state by scripted events at given times.
function world({start=jst(12,20),runs={},events=[],dispatchFails=0,onDispatch}){
  let t=start,id=5000;const dispatched=[];
  const all=()=>Object.values(runs).flat();
  const tick=()=>{for(const e of events)if(!e.done&&t>=e.at){e.done=true;e.do(runs,t);}};
  const gh={
    runs:async wf=>{tick();return (runs[wf]||[]).map(r=>({...r}));},
    run:async rid=>{tick();const r=all().find(x=>x.id===Number(rid));if(!r)throw Error('no run');return {...r};},
    dispatch:async wf=>{tick();if(dispatchFails-->0)throw Object.assign(Error('HTTP 502'),{status:502});const r={id:++id,status:'queued',event:'workflow_dispatch',created_at:new Date(t).toISOString()};(runs[wf]=runs[wf]||[]).unshift(r);dispatched.push({wf,at:t,id:r.id});onDispatch?.(r,t,runs);}
  };
  return {gh,now:()=>t,sleep:async ms=>{t+=ms;},dispatched,runs,get t(){return t}};
}
const self={targetWorkflow:'update.yml',allowedTargets:['update.yml'],groupWorkflows:['update.yml','recover.yml'],parentId:100};
const parentRunning=()=>({id:100,status:'in_progress',created_at:new Date(jst(7)).toISOString(),run_started_at:new Date(jst(7)).toISOString()});

// 1) Parent still finishing, Recover pending in the group: waits for both, then dispatches, and the run starts.
{const w=world({runs:{'update.yml':[parentRunning()],'recover.yml':[{id:200,status:'queued',created_at:new Date(jst(12)).toISOString()}]},
  events:[{at:jst(12,21),do:r=>{r['update.yml'][0].status='completed';r['update.yml'][0].conclusion='success';r['recover.yml'][0].status='in_progress';}},
          {at:jst(12,23),do:r=>{r['recover.yml'][0].status='completed';r['recover.yml'][0].conclusion='success';}}],
  onDispatch:(run,t)=>{run.status='in_progress';run.run_started_at=new Date(t+20000).toISOString();}});
 const r=await handoff({...w,self});assert.equal(r.result,'started');assert.equal(w.dispatched.length,1);
 assert.ok(w.dispatched[0].at>=jst(12,23),'dispatched only after the group was idle');assert.equal(r.parent_conclusion,'success');}
// 2) Dispatched run is cancelled before starting (replaced by a new Recover): waits for idle again and dispatches once more.
{let n=0;const w=world({runs:{'update.yml':[{...parentRunning(),status:'completed',conclusion:'success'}],'recover.yml':[]},
  onDispatch:(run,t,runs)=>{n++;if(n===1){run.status='completed';run.conclusion='cancelled';runs['recover.yml'].unshift({id:300,status:'in_progress',created_at:new Date(t).toISOString()});
      w2.events.push({at:t+2*MIN,do:r=>{r['recover.yml'][0].status='completed';r['recover.yml'][0].conclusion='success';}});}
    else{run.status='in_progress';run.run_started_at=new Date(t).toISOString();}}});
 var w2={events:[]};const ev=w2.events;w.gh.runs=(orig=>async wf=>{for(const e of ev)if(!e.done&&w.t>=e.at){e.done=true;e.do(w.runs);}return orig(wf);})(w.gh.runs);
 const r=await handoff({...w,self});assert.equal(r.result,'started');assert.equal(w.dispatched.length,2);
 assert.equal(r.attempts[0].state,'cancelled_before_start');assert.equal(r.attempts[1].state,'started');}
// 3) Someone else already started an update (schedule): no dispatch.
{const w=world({runs:{'update.yml':[{id:150,status:'completed',conclusion:'success',run_started_at:new Date(jst(12,18)).toISOString(),created_at:new Date(jst(12,18)).toISOString()},{...parentRunning(),status:'completed',conclusion:'success'}],'recover.yml':[]}});
 const r=await handoff({...w,self});assert.equal(r.result,'recent_run');assert.equal(w.dispatched.length,0);}
// 4) Bounded: parent never finishes / group never idle / always cancelled -> fail, at most MAX_ATTEMPTS dispatches.
{const w=world({runs:{'update.yml':[parentRunning()],'recover.yml':[]}});await assert.rejects(handoff({...w,self}),/parent run completion not reached/);assert.equal(w.dispatched.length,0);}
{const w=world({runs:{'update.yml':[{...parentRunning(),status:'completed',conclusion:'success'}],'recover.yml':[{id:201,status:'in_progress',created_at:'x'}]}});
 await assert.rejects(handoff({...w,self}),/idle concurrency group not reached/);assert.equal(w.dispatched.length,0);}
{const w=world({runs:{'update.yml':[{...parentRunning(),status:'completed',conclusion:'success'}],'recover.yml':[]},onDispatch:run=>{run.status='completed';run.conclusion='cancelled';}});
 await assert.rejects(handoff({...w,self}),/cancelled before starting 3 times/);assert.equal(w.dispatched.length,HANDOFF.maxAttempts);}
// 5) Dispatch answered 502 but created the run: confirmed once, not dispatched twice; target not allowlisted fails; parent id required.
{const w=world({runs:{'update.yml':[{...parentRunning(),status:'completed',conclusion:'success'}],'recover.yml':[]},onDispatch:(run,t)=>{run.status='in_progress';}});
 const orig=w.gh.dispatch;let first=true;w.gh.dispatch=async wf=>{await orig(wf);if(first){first=false;throw Object.assign(Error('HTTP 502'),{status:502});}};
 const r=await handoff({...w,self});assert.equal(r.result,'started');assert.equal(w.dispatched.length,1);assert.match(r.attempts[0].dispatch_errors[0],/502/);}
await assert.rejects(handoff({...world({}),self:{...self,targetWorkflow:'deploy.yml'}}),/not allowed/);
await assert.rejects(handoff({...world({}),self:{...self,parentId:null}}),/parent run id required/);

// Gate: only a normal run-time-limit stop, same JST date, before 21:00 JST, at most 3 per day.
const ok={reason:'run_time_limit',ok:true,journal_pending:false},start=new Date(jst(7)).toISOString();
assert.deepEqual(handoffGate({summary:ok,runStartedAt:start,now:jst(12,19),handoffsToday:0}),{handoff:true,reason:'run_time_limit'});
for(const reason of ['too_many_consecutive_failures','outside_racing_hours','late_races_finished','night_hard_limit','control_code_changed:x'])
  assert.equal(handoffGate({summary:{...ok,reason},runStartedAt:start,now:jst(12,19),handoffsToday:0}).handoff,false);
assert.equal(handoffGate({summary:{...ok,journal_pending:true},runStartedAt:start,now:jst(12,19),handoffsToday:0}).handoff,false);
assert.equal(handoffGate({summary:{...ok,ok:false},runStartedAt:start,now:jst(12,19),handoffsToday:0}).handoff,false);
assert.equal(handoffGate({summary:ok,runStartedAt:new Date(jst(7)-86400000).toISOString(),now:jst(12,19),handoffsToday:0}).reason,'date_changed');
assert.equal(handoffGate({summary:ok,runStartedAt:start,now:jst(21,5),handoffsToday:0}).reason,'too_late_in_day');
assert.equal(handoffGate({summary:ok,runStartedAt:start,now:jst(12,19),handoffsToday:GATE.maxPerDay}).reason,'daily_handoff_limit');
assert.equal(handoffGate({summary:ok,runStartedAt:start,now:jst(12,19),handoffsToday:NaN}).reason,'handoff_count_unknown');
assert.equal(handoffGate({summary:null,runStartedAt:start,now:jst(12,19),handoffsToday:0}).reason,'no_loop_summary');
console.log('handoff OK: waits for the parent and an idle group (pending Recover), dispatch accepted vs actually started, re-dispatch only after a cancel-before-start (max 3), already started elsewhere, bounded waits, 502 handling; gate only after a normal run-time-limit stop, same date, before 21:00, max 3/day');
