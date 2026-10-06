import fs from 'node:fs';
import path from 'node:path';
import {spawn} from 'node:child_process';
import {pathToFileURL} from 'node:url';

// Bounded in-job polling; no self-dispatch or indefinite runner.
export async function collectCycles({collect,checkpoint,record,wait,now=()=>Date.now(),cycles=3,intervalMs=60000,maxMs=8*60000}){
  if(!Number.isInteger(cycles)||cycles<1||cycles>3||intervalMs<0||maxMs<=0)throw Error('Invalid collection limits');
  const started=now(),state={schema:'kyotei-shadow-collection-run-v1',started_at:new Date(started).toISOString(),attempts:[],status:'running'};
  let successful=0,checkpointFailed=false;
  for(let i=0;i<cycles;i++){
    if(i&&now()-started>=maxMs)break;
    const attempt={number:i+1,started_at:new Date(now()).toISOString()};
    try{await collect();attempt.status='success';successful++;state.last_success_at=new Date(now()).toISOString()}
    catch(e){attempt.status='error';attempt.error=String(e.message||e).slice(0,1000)}
    attempt.finished_at=new Date(now()).toISOString();state.attempts.push(attempt);
    state.status=attempt.status==='success'?(state.attempts.some(x=>x.status==='error')?'recovered':'ok'):'needs_attention';
    state.checked_at=attempt.finished_at;
    await record(state);
    // Preserve each successful collection before waiting for another pass.
    // Also preserve failure diagnostics and any freshly prepared official history.
    try{await checkpoint()}
    catch(e){checkpointFailed=true;attempt.checkpoint_error=String(e.message||e).slice(0,1000);state.status='checkpoint_failed';await record(state);break}
    if(i+1<cycles&&now()-started+intervalMs<maxMs)await wait(intervalMs);else break;
  }
  if(!successful||state.attempts.at(-1)?.status!=='success'||checkpointFailed)throw Error('Shadow collection incomplete: '+state.status);
  return state;
}

function command(executable,args,cwd){
  return new Promise((resolve,reject)=>{
    const child=spawn(executable,args,{cwd,env:process.env,stdio:'inherit'});
    child.on('error',reject);child.on('exit',code=>code===0?resolve():reject(Error(executable+' exited '+code)));
  });
}
async function main(){
  const root=path.resolve(process.env.SHADOW_ROOT||'.');
  const git=(...args)=>command('git',args,root);
  const stateFile=path.join(root,'dev/shadow-collection-run.json');
  await git('config','user.name','github-actions[bot]');
  await git('config','user.email','41898282+github-actions[bot]@users.noreply.github.com');
  const checkpoint=async()=>{
    fs.mkdirSync(path.join(root,'dev/official-result-fallback'),{recursive:true});
    await git('add','dev/official-result-fallback/','dev/expert-shadow-repaired-archive/','dev/expert-shadow-repaired-evaluation.json','dev/racer-aptitude-prospective.json','dev/aptitude-prospective-audit.json','dev/aptitude-prospective-source/','dev/shadow-collection-run.json');
    await git('commit','-m','Checkpoint prospective collection and retry diagnostics');
    let error;
    for(let i=0;i<5;i++){
      try{await git('pull','--rebase','--autostash','origin','main');await git('push','origin','HEAD:main');return}
      catch(e){error=e}
    }
    throw error;
  };
  await collectCycles({collect:()=>command(process.execPath,[path.join(root,'experiments/repaired_expert_shadow.mjs')],root),checkpoint,
    record:async state=>{fs.mkdirSync(path.dirname(stateFile),{recursive:true});fs.writeFileSync(stateFile,JSON.stringify(state,null,2)+'\n')},
    wait:ms=>new Promise(resolve=>setTimeout(resolve,ms))});
}
if(import.meta.url===pathToFileURL(process.argv[1]).href)await main();
