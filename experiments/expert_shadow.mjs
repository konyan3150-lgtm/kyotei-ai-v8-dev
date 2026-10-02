import fs from 'node:fs';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {createRequire} from 'node:module';
import {evTickets,drift,EV_POLICY} from './ev_drift.mjs';
import {observedInputs,preserveRevision,markCancelled,realtimeSummary,applyPreclosePreview} from './realtime_shadow.mjs';
import {diagnostics,auditRecord} from './shadow_diagnostics.mjs';
import {applyOriginal,health} from './exhibition_health.mjs';

export const POLICY = Object.freeze({version:'expert-shadow-v1', insideLogBoost:0.10, upsetLogPenalty:0.10, tickets:6, stake:100});
const closeMs = r => Date.parse(String(r.closed_at).replace(' ','T')+'+09:00');
const day = () => new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Tokyo',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date()).replaceAll('-','');
const read = (p,f={}) => fs.existsSync(p)?JSON.parse(fs.readFileSync(p,'utf8')):f;
const get = async url => {const r=await fetch(url,{signal:AbortSignal.timeout(25000)});if(!r.ok)throw Error(`${url}: HTTP ${r.status}`);return r.json()};

export function allCombinations(rows) {
  if(rows.length!==6 || new Set(rows.map(r=>String(r.k))).size!==6)throw Error('Six unique lanes required');
  if(rows.some(r=>!Array.isArray(r.p)||r.p.length!==3||r.p.some(v=>!Number.isFinite(v)||v<0)))throw Error('Invalid rank probabilities');
  const combinations=[];
  for(const a of rows)for(const b of rows)for(const c of rows){
    if(a.k===b.k||a.k===c.k||b.k===c.k)continue;
    combinations.push({combo:`${a.k}-${b.k}-${c.k}`,prob:a.p[0]*b.p[1]*c.p[2]});
  }
  const sum=combinations.reduce((s,x)=>s+x.prob,0);
  if(!(sum>0))throw Error('Zero distribution');
  for(const x of combinations)x.prob/=sum;
  return combinations.sort((a,b)=>b.prob-a.prob||a.combo.localeCompare(b.combo));
}

export function adjust(rows,expert) {
  const inside=Number(expert.weights?.inside||0),upset=Number(expert.weights?.upset||0);
  if(![inside,upset].every(x=>Number.isFinite(x)&&x>=0&&x<=1))throw Error('Invalid Expert weights');
  const multiplier=Math.exp(POLICY.insideLogBoost*inside-POLICY.upsetLogPenalty*upset);
  return rows.map(r=>({...r,p:r.p.map((p,i)=>i===0&&String(r.k)==='1'?p*multiplier:p)}));
}

export function snapshot({race,rows,expert,makeBets,date,stadium,number,now=new Date(),odds}) {
  const close=closeMs(race),saved=now.getTime();
  if(!Number.isFinite(close)||saved>=close||close-saved>20*60000||String(race.date||'').replaceAll('-','')!==date)return null;
  if(race.result?.payouts?.trifecta?.length||expert.reconstructed||expert.version!==2)return null;
  const changed=adjust(rows,expert),baseline=allCombinations(rows),candidate=allCombinations(changed);
  const oddsTime=Date.parse(odds?.fetched_at),fresh=Number.isFinite(oddsTime)&&oddsTime<=saved&&saved-oddsTime<=10*60000;
  for(const x of baseline){const [a,b,c]=x.combo.split('-');x.odds=fresh?Number(odds?.trifecta?.[a]?.[b]?.[c]||0):null;if(!(x.odds>0))x.odds=null}
  const valueArms=Object.fromEntries([['baseline',baseline],['candidate',candidate]].map(([arm,distribution])=>[arm,evTickets(distribution,baseline,fresh?odds.fetched_at:null,now.toISOString())]));
  return {policy:POLICY.version,input_state:observedInputs(race),value_arms:valueArms,date,stadium:String(stadium),race:String(number),saved_at:now.toISOString(),closed_at:race.closed_at,
    expert:{version:expert.version,active:expert.active,weights:expert.weights,used_in_shadow_candidate:true,used_in_production:false},
    rank_probabilities:rows.map(r=>({lane:String(r.k),p:r.p})),baseline_distribution:baseline,candidate_distribution:candidate,
    baseline_picks:makeBets(rows,6,'hit').map(x=>x.combo),candidate_picks:makeBets(changed,6,'hit').map(x=>x.combo),
    odds_snapshot_at:fresh?odds.fetched_at:null,stake_per_ticket:100,
    probability_kind:'normalized rank-product scores; not yet calibrated trifecta probabilities',
    engine_commit:'8286a9783a7799aacade7d0f0de72e8636a681ac',classifier_commit:'6c7f1841cb8fc9611a6c6f2dabe2d0135b0a671b',
    scope:'shadow engine baseline; independently captured, not a replay of saved production predictions'};
}

export function settle(record,result) {
  if(record.outcome||record.cancelled||!result?.combination)return false;
  if(Date.parse(record.saved_at)>=closeMs(record))throw Error('Post-close snapshot');
  const combo=String(result.combination).replaceAll('>','-'),amount=Number(result.amount);
  if(!/^([1-6])-([1-6])-([1-6])$/.test(combo)||new Set(combo.split('-')).size!==3||!Number.isFinite(amount)||amount<=0)return false;
  const metrics={};
  for(const arm of ['baseline','candidate']) {
    const picks=record[`${arm}_picks`],p=record[`${arm}_distribution`].find(x=>x.combo===combo)?.prob;
    if(!p)throw Error('Outcome absent from distribution');
    metrics[arm]={hit:picks.includes(combo),investment:picks.length*100,payout:picks.includes(combo)?amount:0,
      log_loss:-Math.log(p),brier:record[`${arm}_distribution`].reduce((sum,x)=>sum+(x.prob-(x.combo===combo?1:0))**2,0)};
  }
  const valueMetrics={};
  for(const arm of ['baseline','candidate']){
    const value=record.value_arms?.[arm];
    if(value?.status!=='shadow_estimate_uncalibrated')continue;
    const winning=value.items.find(x=>x.combo===combo);
    valueMetrics[arm]={hit:!!winning,investment:value.investment,payout:winning?amount*winning.stake/100:0,tickets:value.items.length};
  }
  record.outcome={result:combo,amount,source:result.source||'Open API trifecta result',settled_at:new Date().toISOString(),metrics,value_metrics:valueMetrics};return true;
}

export function evaluate(records) {
  const allRecords=Object.values(records),valid=allRecords.filter(r=>!auditRecord(r).length),invalid=allRecords.length-valid.length;
  const rs=valid.filter(r=>r.outcome&&!r.cancelled),cancelled=allRecords.filter(r=>r.cancelled).length,arms={};
  for(const arm of ['baseline','candidate']){
    const data=rs.map(r=>r.outcome.metrics[arm]),investment=data.reduce((s,x)=>s+x.investment,0),payout=data.reduce((s,x)=>s+x.payout,0);
    arms[arm]={races:data.length,hits:data.filter(x=>x.hit).length,investment,payout,roi:investment?payout/investment:null,
      log_loss:data.length?data.reduce((s,x)=>s+x.log_loss,0)/data.length:null,brier:data.length?data.reduce((s,x)=>s+x.brier,0)/data.length:null};
  }
  const valueArms={};
  const eligible=rs.filter(r=>r.outcome.value_metrics?.baseline&&r.outcome.value_metrics?.candidate);
  for(const arm of ['baseline','candidate']){
    const data=eligible.map(r=>r.outcome.value_metrics[arm]),bought=data.filter(x=>x.investment>0),investment=data.reduce((s,x)=>s+x.investment,0),payout=data.reduce((s,x)=>s+x.payout,0);
    valueArms[arm]={eligible_races:data.length,bought_races:bought.length,skipped_races:data.length-bought.length,hits:bought.filter(x=>x.hit).length,
      hit_rate:bought.length?bought.filter(x=>x.hit).length/bought.length:null,investment,payout,roi:investment?payout/investment:null};
  }
  return {policy:POLICY,ev_policy:EV_POLICY,value_arms:valueArms,drift:drift(records),realtime:realtimeSummary(records),diagnostics:diagnostics(records),saved:Object.keys(records).length,settled:rs.length,cancelled,invalid,pending:valid.filter(r=>!r.outcome&&!r.cancelled).length,arms,
    paired_hit_difference:rs.reduce((s,r)=>s+Number(r.outcome.metrics.candidate.hit)-Number(r.outcome.metrics.baseline.hit),0),
    interpretation:'Prospective paired shadow evaluation. No historical reconstruction or production promotion.'};
}

export async function run() {
  const engineRoot=path.resolve(process.env.ENGINE_ROOT||'../research-work'),root=path.resolve(process.env.SHADOW_ROOT||'.');
  const engine=await import(pathToFileURL(path.join(engineRoot,'scripts/update_server_predictions.mjs')));
  const {assess}=createRequire(import.meta.url)(path.resolve(process.env.CLASSIFIER_PATH||'../dev-work/expert-classifier-v2.js'));
  const date=day(),dir=path.join(root,'dev/expert-shadow-archive');fs.mkdirSync(dir,{recursive:true});
  const stores=new Map(fs.readdirSync(dir).filter(f=>/^\d{8}\.json$/.test(f)).map(f=>[f.slice(0,8),read(path.join(dir,f))]));
  const current=stores.get(date)||{schema:'kyotei-expert-shadow',version:1,date,records:{}};stores.set(date,current);
  const ctx={models:engine.normalizeModel(read(path.join(engineRoot,'v8_model_aptitude.json'))),aptitude:read(path.join(engineRoot,'racer-aptitude.json')),
    course:read(path.join(engineRoot,'dev/course-stats.json')),venue:read(path.join(engineRoot,'dev/venue-stats.json')),technique:read(path.join(engineRoot,'dev/technique-stats.json'))};
  const odds=read(path.join(engineRoot,'dev/odds.json'));
  const official=read(path.join(engineRoot,'dev/official-results.json'));
  const previews=read(path.join(engineRoot,'dev/official-previews.json'));
  let program;
  try{program=await get(`https://boatraceopenapi.github.io/api/v1/${date.slice(0,4)}/${date}.json`)}catch(e){if(!e.message.includes('HTTP 404'))throw e}
  let originalStatus='unavailable';
  if(program){
    const url=`https://boatracecsv.github.io/data/previews/original_exhibition/${date.slice(0,4)}/${date.slice(4,6)}/${date.slice(6,8)}.csv`;
    try{const response=await fetch(url,{signal:AbortSignal.timeout(20000)});if(response.ok){const text=await response.text();originalStatus=applyOriginal(program,text,date,new Date().toISOString()).status}else originalStatus=`HTTP_${response.status}`}
    catch(e){originalStatus='fetch_or_parse_error'}
  }
  const now=new Date();
  const eligibleKeys=[];
  for(const [sid,v] of Object.entries(program?.programs?.stadiums||{}))for(const [n,race] of Object.entries(v.races||{})){
    const k=`${date}_${Number(sid)}_${Number(n)}`,officialRace=String(official.date)===date?official.races?.[String(Number(sid))]?.[String(Number(n))]:null;
    if(officialRace?.cancelled===true){markCancelled(current.records[k],{cancelled:true,source:'live official-results cancellation'});continue}
    if(current.records[k]?.outcome||current.records[k]?.cancelled||!Number.isFinite(closeMs(race))||closeMs(race)<=now.getTime()||closeMs(race)-now.getTime()>20*60000)continue;
    eligibleKeys.push(k);
    const previewRecord=String(previews.date)===date?previews.races?.[String(Number(sid))]?.[String(Number(n))]:null;
    const supplemented=applyPreclosePreview(race,previewRecord,new Date());
    const rows=engine.predictionRows(ctx,race,sid,n,date);if(rows.length!==6)continue;
    const rec=snapshot({race,rows,expert:assess(race,rows),makeBets:engine.makeBets,date,stadium:sid,number:n,now:new Date(),
      odds:String(odds.date)===date?odds.races?.[String(Number(sid))]?.[String(Number(n))]:null});
    if(rec){rec.official_preview_at=supplemented?previewRecord.fetched_at:null;rec.original_exhibition_at=race.original_exhibition_captured_at||null;rec.collector_version='shadow-data-v2-original';current.records[k]=preserveRevision(current.records[k],rec);current.records[k].last_checked_at=rec.saved_at}
  }
  for(const [d,store] of stores){
    for(const r of Object.values(store.records)){
      if(r.outcome||r.cancelled||String(official.date)!==d||closeMs(r)>now.getTime())continue;
      const result=official.races?.[String(Number(r.stadium))]?.[String(Number(r.race))];
      if(result?.cancelled===true)markCancelled(r,{cancelled:true,source:'live official-results cancellation'});
      else if(result?.combination)settle(r,{...result,source:'live official-results'});
    }
    const pending=Object.values(store.records).filter(r=>!r.outcome&&!r.cancelled&&closeMs(r)<=now.getTime());if(!pending.length)continue;
    let results;try{results=await get(`https://boatraceopenapi.github.io/results/v3/${d.slice(0,4)}/${d}.json`)}catch(e){if(e.message.includes('HTTP 404'))continue;throw e}
    const map=new Map((results.results||[]).map(r=>[`${Number(r.stadium_number)}_${Number(r.number)}`,r]));
    for(const r of pending){const result=map.get(`${Number(r.stadium)}_${Number(r.race)}`);if(result?.cancelled===true)markCancelled(r,{cancelled:true,source:'Open API explicit cancellation'});else settle(r,result?.payouts?.trifecta?.[0])}
  }
  for(const [d,s] of stores)fs.writeFileSync(path.join(dir,d+'.json'),JSON.stringify(s)+'\n');
  const all=Object.assign({},...[...stores.values()].map(s=>s.records));
  const report={...evaluate(all),health:health(all,{now:new Date(),eligibleKeys,originalStatus,programStatus:program?'available':'program_unpublished'})};
  fs.writeFileSync(path.join(root,'dev/expert-shadow-evaluation.json'),JSON.stringify(report,null,2)+'\n');
  console.log(JSON.stringify({date,...report}));
}
if(import.meta.url===pathToFileURL(process.argv[1]).href)await run();
