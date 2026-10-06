import assert from 'node:assert/strict';
import {collectCycles} from './run_shadow_cycles.mjs';
function harness(failures=[]){
 let time=0,n=0;const events=[],states=[];
 return {events,states,args:{now:()=>time,collect:async()=>{events.push('collect');n++;time+=1000;if(failures.includes(n))throw Error('network')},checkpoint:async()=>events.push('checkpoint'),record:async s=>states.push(structuredClone(s)),wait:async ms=>{events.push('wait');time+=ms}}};
}
let h=harness();let s=await collectCycles(h.args);assert.equal(s.attempts.length,3);assert.equal(s.status,'ok');assert.deepEqual(h.events,['collect','checkpoint','wait','collect','checkpoint','wait','collect','checkpoint']);
h=harness([1]);s=await collectCycles(h.args);assert.equal(s.status,'recovered');assert.equal(s.attempts[0].error,'network');assert.equal(s.attempts[2].status,'success');
h=harness([1,2,3]);await assert.rejects(collectCycles(h.args),/incomplete/);assert.equal(h.states.length,3);
h=harness();await assert.rejects(collectCycles({...h.args,checkpoint:async()=>{throw Error('push failure')}}),/checkpoint_failed/);assert.equal(h.events.filter(x=>x==='collect').length,1);assert.equal(h.states.at(-1).attempts[0].checkpoint_error,'push failure');
h=harness();s=await collectCycles({...h.args,maxMs:500});assert.equal(s.attempts.length,1);assert.equal(h.events.includes('wait'),false);
await assert.rejects(collectCycles({...h.args,cycles:10}),/Invalid/);
console.log('Cycle checks passed: bounded passes, checkpoint before wait, recovered failures, terminal failure, push failure and time budget.');
