import assert from 'node:assert/strict';
import worker,{tick} from './worker.mjs';
const now=Date.parse('2026-10-06T03:00:00Z'),old=new Date(now-3600000).toISOString();
function harness({runs=[],checked=old,dispatchStatus=204,failRead=false}={}){
 const calls=[];return {calls,request:async(url,options)=>{
  calls.push({url,options});if(options.method==='POST')return {status:dispatchStatus};
  if(failRead)return {ok:false,status:503};
  if(url.includes('/runs?'))return {ok:true,json:async()=>({workflow_runs:runs})};
  return {ok:true,json:async()=>({encoding:'base64',content:Buffer.from(JSON.stringify({health:{checked_at:checked}})).toString('base64')})};
 }};
}
const enabled={GITHUB_TOKEN:'test-token',DISPATCH_ENABLED:'true'};
let h=harness();assert.equal((await tick({}, {now,request:h.request})).status,'dry_run_would_dispatch');assert.equal(h.calls.some(x=>x.options.method==='POST'),false);
h=harness();assert.equal((await tick(enabled,{now,request:h.request})).status,'dispatched');assert.equal(h.calls.filter(x=>x.options.method==='POST').length,1);assert.equal(JSON.parse(h.calls.at(-1).options.body).ref,'main');assert.ok(h.calls.every(x=>x.url.includes('/konyan3150-lgtm/kyotei-ai-v8-dev/')));
h=harness();await assert.rejects(tick({DISPATCH_ENABLED:'true'},{now,request:h.request}),/credential/);
for(const status of ['queued','in_progress','waiting','pending','requested']){h=harness({runs:[{head_branch:'main',status}]});assert.equal((await tick(enabled,{now,request:h.request})).status,'already_running');assert.equal(h.calls.length,1)}
h=harness({runs:[{head_branch:'main',status:'completed',updated_at:new Date(now-60000).toISOString()}]});assert.equal((await tick(enabled,{now,request:h.request})).status,'recent_run');
h=harness({checked:new Date(now-60000).toISOString()});assert.equal((await tick(enabled,{now,request:h.request})).status,'fresh');
h=harness({checked:'invalid'});await assert.rejects(tick(enabled,{now,request:h.request}),/timestamp/);
h=harness({failRead:true});await assert.rejects(tick(enabled,{now,request:h.request}),/503/);
h=harness({dispatchStatus:403});await assert.rejects(tick(enabled,{now,request:h.request}),/403/);
h=harness();assert.equal((await tick(enabled,{now:Date.parse('2026-10-06T15:00:00Z'),request:h.request})).status,'outside_hours');assert.equal(h.calls.length,0);
assert.equal(worker.fetch().status,404);
console.log('External scheduler gates passed: DEV-only target, dry run, credential gate, active/recent/fresh suppression, failed reads, dispatch failure, JST hours and closed HTTP endpoint.');
