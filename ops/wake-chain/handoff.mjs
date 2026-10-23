// Midday hand-over for the production update loop.
// The update loop stops at its 5.5 h run limit (about 12:19 JST when it starts at 07:00). Its pending successor in the
// shared concurrency group can be replaced by another workflow's pending run (Recover), so no update runs until a late
// `schedule` start (10/20-10/23: about 2 h without odds updates). The loop's workflow then dispatches this hand-over
// waker, which runs in its own group and:
//   1. waits until the parent update run has completed (it is still running its final steps when it dispatches us),
//   2. waits until no run of the shared group is queued or running (e.g. Recover), so the dispatch neither replaces
//      a pending Recover nor gets replaced by it right away,
//   3. stops if another update run is active or started within RECENT (someone else already took over),
//   4. dispatches the update and confirms that the dispatch created a run (accepted) — same rules as the wake chain,
//   5. waits until that run has actually started (in_progress, or completed with a non-cancelled conclusion);
//      if it was cancelled before starting (replaced in the group), it goes back to 2, at most MAX_ATTEMPTS times.
// Everything is bounded in time; every decision is written to the summary/annotations; failures fail this run.
import {ACTIVE,targetDecision,dispatchConfirmed,DEFAULTS} from './wake.mjs';

export const HANDOFF=Object.freeze({parentWaitMs:20*60000,idleWaitMs:20*60000,startWaitMs:15*60000,pollMs:30000,maxAttempts:3,recentMs:10*60000});

async function until(fn,{now,sleep,timeoutMs,pollMs,what}){
  const deadline=now()+timeoutMs;
  while(true){const v=await fn();if(v)return v;if(now()>=deadline)throw Error(`${what} not reached within ${Math.round(timeoutMs/60000)} min`);await sleep(pollMs);}
}

export async function handoff({gh,now=Date.now,sleep,log=()=>{},self,limits={}}){
  const L={...HANDOFF,...limits},{targetWorkflow,allowedTargets,groupWorkflows,parentId}=self;
  if(!allowedTargets.includes(targetWorkflow))throw Error(`target workflow not allowed: ${targetWorkflow}`);
  if(parentId==null||parentId===''||!Number.isSafeInteger(Number(parentId))||Number(parentId)<=0)throw Error('parent run id required');
  const out={mode:'handoff',target_workflow:targetWorkflow,parent_run:Number(parentId),attempts:[]};
  const opt={now,sleep,pollMs:L.pollMs};
  // 1. parent finished (its loop already ended; its last steps may still run)
  const parent=await until(async()=>{const r=await gh.run(parentId);return r.status==='completed'?r:null;},{...opt,timeoutMs:L.parentWaitMs,what:'parent run completion'});
  out.parent_conclusion=parent.conclusion;
  for(let attempt=1;attempt<=L.maxAttempts;attempt++){
    const a={attempt};out.attempts.push(a);
    // 2. group idle (nothing queued or running in any workflow of the shared concurrency group)
    await until(async()=>{
      for(const wf of groupWorkflows){const runs=await gh.runs(wf);if(runs.some(r=>ACTIVE.has(r.status)&&r.id!==Number(parentId)))return false;}
      return true;
    },{...opt,timeoutMs:L.idleWaitMs,what:'idle concurrency group'});
    a.group_idle_at=new Date(now()).toISOString();
    // 3. someone else already started the update?
    // Ignore the parent, our own earlier dispatches and runs cancelled before doing anything (they did not update).
    const mine=new Set(out.attempts.map(x=>x.run).filter(Boolean));
    const others=(await gh.runs(targetWorkflow)).filter(r=>r.id!==Number(parentId)&&!mine.has(r.id)&&!(r.status==='completed'&&r.conclusion==='cancelled'));
    const d=targetDecision(others,now(),{recentMs:L.recentMs});
    if(d.decision!=='dispatch')return {...out,result:d.decision,target_run:d.run};
    // 4. dispatch accepted = a new run exists
    const since=now();
    const {run,dispatch_errors}=await dispatchConfirmed(gh,targetWorkflow,undefined,{...opt,confirmMs:DEFAULTS.confirmMs});
    a.dispatched_at=new Date(since).toISOString();a.run=run.id;if(dispatch_errors.length)a.dispatch_errors=dispatch_errors;
    // 5. actually started?
    const started=await until(async()=>{const r=await gh.run(run.id);
      if(r.status==='in_progress'||(r.status==='completed'&&r.conclusion!=='cancelled'))return {state:'started',run:r};
      if(r.status==='completed'&&r.conclusion==='cancelled')return {state:'cancelled_before_start',run:r};
      return null;},{...opt,timeoutMs:L.startWaitMs,what:`start of run ${run.id}`});
    a.state=started.state;a.run_started_at=started.run.run_started_at||null;
    if(started.state==='started')return {...out,result:'started',target_run:run.id,run_started_at:started.run.run_started_at||null};
    log(`run ${run.id} was cancelled before it started (replaced in the concurrency group); attempt ${attempt}/${L.maxAttempts}`);
  }
  throw Object.assign(Error(`update was cancelled before starting ${L.maxAttempts} times`),{out});
}

if(import.meta.url===`file://${process.argv[1]}`){
  const fs=await import('node:fs'),{github}=await import('./wake.mjs');const env=process.env;
  const summary=t=>{if(env.GITHUB_STEP_SUMMARY)fs.appendFileSync(env.GITHUB_STEP_SUMMARY,t+'\n');};
  const limits=env.HANDOFF_POLL_MS?{pollMs:Number(env.HANDOFF_POLL_MS)}:{};
  const self={targetWorkflow:env.HANDOFF_TARGET,allowedTargets:(env.HANDOFF_ALLOWED||'').split(',').filter(Boolean),groupWorkflows:(env.HANDOFF_GROUP||'').split(',').filter(Boolean),parentId:env.HANDOFF_PARENT};
  try{
    const r=await handoff({gh:github({token:env.GITHUB_TOKEN,repo:env.GITHUB_REPOSITORY}),sleep:ms=>new Promise(res=>setTimeout(res,ms)),log:m=>console.log(m),self,limits});
    console.log(`::notice title=handoff ${r.result}::${JSON.stringify(r)}`);summary('### update hand-over\n\n```json\n'+JSON.stringify(r,null,2)+'\n```');
  }catch(e){const m=String(e?.message||e);console.log(`::error title=handoff failed::${m}${e?.out?' '+JSON.stringify(e.out):''}`);summary('### update hand-over FAILED\n\n'+m);process.exit(1);}
}
