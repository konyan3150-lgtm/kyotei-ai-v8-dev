const REPO='konyan3150-lgtm/kyotei-ai-v8-dev';
const WORKFLOW='repaired-expert-shadow.yml';
const BASE=`https://api.github.com/repos/${REPO}`;
const ACTIVE=new Set(['queued','in_progress','waiting','pending','requested']);
const FRESH_MS=7*60000;
export async function tick(env,{now=Date.now(),request=fetch}={}){
  const hour=Number(new Intl.DateTimeFormat('en-GB',{timeZone:'Asia/Tokyo',hour:'2-digit',hourCycle:'h23'}).format(new Date(now)));
  if(hour<8||hour>=23)return {status:'outside_hours'};
  const headers={'Accept':'application/vnd.github+json','X-GitHub-Api-Version':'2022-11-28','User-Agent':'v8-dev-collection-watchdog'};
  if(env.GITHUB_TOKEN)headers.Authorization=`Bearer ${env.GITHUB_TOKEN}`;
  const get=async url=>{
    const response=await request(url,{headers,signal:AbortSignal.timeout(15000)});
    if(!response.ok)throw Error('GitHub read HTTP '+response.status);
    return response.json();
  };
  const payload=await get(`${BASE}/actions/workflows/${WORKFLOW}/runs?branch=main&per_page=100&t=${now}`);
  if(!Array.isArray(payload.workflow_runs))throw Error('Invalid workflow response');
  const runs=payload.workflow_runs.filter(r=>r.head_branch==='main');
  if(runs.some(r=>ACTIVE.has(r.status)))return {status:'already_running'};
  // Unknown/nonterminal statuses fail closed rather than creating more runs.
  if(runs.some(r=>r.status!=='completed'))throw Error('Unknown workflow status');
  const latest=runs.reduce((n,r)=>Math.max(n,Date.parse(r.updated_at)||0),0);
  if(latest>now+60000)throw Error('Future workflow timestamp');
  if(latest&&now-latest<FRESH_MS)return {status:'recent_run'};
  const file=await get(`${BASE}/contents/dev/expert-shadow-repaired-evaluation.json?ref=main&t=${now}`);
  if(file.encoding!=='base64'||typeof file.content!=='string')throw Error('Invalid evaluation response');
  const data=JSON.parse(new TextDecoder().decode(Uint8Array.from(atob(file.content.replace(/\s/g,'')),c=>c.charCodeAt(0))));
  const checked=Date.parse(data.health?.checked_at);
  if(!Number.isFinite(checked)||checked>now+60000)throw Error('Invalid collection timestamp');
  if(now-checked<FRESH_MS)return {status:'fresh'};
  if(env.DISPATCH_ENABLED!=='true')return {status:'dry_run_would_dispatch'};
  if(!env.GITHUB_TOKEN)throw Error('GitHub credential required');
  const response=await request(`${BASE}/actions/workflows/${WORKFLOW}/dispatches`,{
    method:'POST',headers:{...headers,'Content-Type':'application/json'},body:JSON.stringify({ref:'main'}),signal:AbortSignal.timeout(15000)
  });
  if(response.status!==200&&response.status!==204)throw Error('GitHub dispatch HTTP '+response.status);
  return {status:'dispatched'};
}
export default {
  // No unauthenticated HTTP endpoint can trigger repository writes.
  fetch(){return new Response('Not found',{status:404})},
  async scheduled(controller,env){const result=await tick(env);console.log(JSON.stringify(result))}
};
