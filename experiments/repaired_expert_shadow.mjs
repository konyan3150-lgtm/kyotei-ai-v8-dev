import {oddsDeterioration} from './odds_deterioration.mjs';
import {captureLearningInputs,validateRecentInput,learningInputReport} from './learning_inputs.mjs';
import {collectionDaily} from './collection_daily.mjs';
import {oddsDiagnostics} from './odds_diagnostics.mjs';
import {prepareOddsCalibration,captureOddsCalibration,settleOddsCalibration,oddsCalibrationReport} from './odds_calibration.mjs';
import {analyzeShadowSelections} from '../selection-analysis.mjs';
import {stReason,stDiagnostics,previewObservation,observeCapture,gapDiagnostics} from './collection_diagnostics.mjs';
import {officialFallback} from './official_result_fallback.mjs';
import fs from 'node:fs';
import {calibrationReadiness} from './prospective_calibration.mjs';
import {captureVariants,collectRevision,evaluateVariants} from './preclose_variants.mjs';
import {COHORT,verifiedInput,verifyStore,checkedOutcome,reopenUnconfirmed} from './prospective_input.mjs';
import path from 'node:path';
import {gunzipSync} from 'node:zlib';
import {pathToFileURL} from 'node:url';
import {createRequire} from 'node:module';
import {evTickets,drift,EV_POLICY} from './ev_drift.mjs';
import {observedInputs,preserveRevision,markCancelled,realtimeSummary,applyPreclosePreview} from './realtime_shadow.mjs';
import {diagnostics,auditRecord} from './shadow_diagnostics.mjs';
import {applyOriginal,health} from './exhibition_health.mjs';

export const POLICY = Object.freeze({version:'expert-shadow-official-v1', insideLogBoost:0.10, upsetLogPenalty:0.10, tickets:6, stake:100});
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
  record.outcome={result:combo,amount,source:result.source||'Open API trifecta result',settled_at:new Date().toISOString(),metrics,value_metrics:valueMetrics};
  const calibrated=settleOddsCalibration(record);if(calibrated)record.outcome.odds_calibration=calibrated;
  return true;
}

export function evaluate(records) {
  const allRecords=Object.values(records),valid=allRecords.filter(r=>!auditRecord(r).length),invalid=allRecords.length-valid.length;
  const rs=valid.filter(r=>r.outcome&&!r.cancelled&&!r.excluded),cancelled=allRecords.filter(r=>r.cancelled).length,arms={};
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
  return {policy:POLICY,ev_policy:EV_POLICY,value_arms:valueArms,drift:drift(records),realtime:realtimeSummary(records),diagnostics:diagnostics(Object.fromEntries(Object.entries(records).filter(([,r])=>!r.excluded))),saved:Object.keys(records).length,excluded:allRecords.filter(r=>r.excluded).length,settled:rs.length,cancelled,invalid,pending:valid.filter(r=>!r.outcome&&!r.cancelled).length,arms,
    paired_hit_difference:rs.reduce((s,r)=>s+Number(r.outcome.metrics.candidate.hit)-Number(r.outcome.metrics.baseline.hit),0),
    interpretation:'Prospective paired shadow evaluation. No historical reconstruction or production promotion.'};
}

export async function run() {
  const engineRoot=path.resolve(process.env.ENGINE_ROOT||'../research-work'),root=path.resolve(process.env.SHADOW_ROOT||'.');
  const engine=await import(pathToFileURL(path.join(engineRoot,'scripts/update_server_predictions.mjs')));
  const {assess}=createRequire(import.meta.url)(path.resolve(process.env.CLASSIFIER_PATH||'../dev-work/expert-classifier-v2.js'));
  const date=day(),dir=path.join(root,'dev/expert-shadow-repaired-archive');
  const verified=verifiedInput(root,date,engineRoot);fs.mkdirSync(dir,{recursive:true});
  const stores=new Map(fs.readdirSync(dir).filter(f=>/^\d{8}\.json$/.test(f)).map(f=>[f.slice(0,8),read(path.join(dir,f))]));
  for(const store of stores.values()){verifyStore(store);reopenUnconfirmed(store);}
  const calibrationFile=path.join(root,'dev/probability-calibration/odds-aware-v1.json');
  const calibrationPrepared=prepareOddsCalibration(Object.assign({},...[...stores.values()].map(s=>s.records)),{today:date,model:read(calibrationFile,null)});
  if(calibrationPrepared.new_model){fs.mkdirSync(path.dirname(calibrationFile),{recursive:true});fs.writeFileSync(calibrationFile,JSON.stringify(calibrationPrepared.model,null,2)+'\n',{flag:'wx'});}
  const current=stores.get(date)||{cohort:COHORT,schema:'kyotei-expert-shadow',version:1,date,records:{}};stores.set(date,current);
  const inputDir=path.join(root,'dev/shadow-input-observations');fs.mkdirSync(inputDir,{recursive:true});
  const inputFile=path.join(inputDir,date+'.json'),inputObservations=read(inputFile,{date,records:{}});
  const ctx={models:engine.normalizeModel(read(path.join(engineRoot,'v8_model_aptitude.json'))),aptitude:verified.data,
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
  let recent=null,recentStatus='missing';
  try{recent=validateRecentInput(fs.readFileSync(process.env.RECENT_PLAYER_INPUT||'/tmp/recent-player-input.json','utf8'),date,verified.proof);recentStatus='verified';}
  catch(e){recentStatus='unavailable: '+String(e.message).slice(0,200);}
  const eligibleKeys=[],revisionRejections=[];
  for(const [sid,v] of Object.entries(program?.programs?.stadiums||{}))for(const [n,race] of Object.entries(v.races||{})){
    const k=`${date}_${Number(sid)}_${Number(n)}`,officialRace=String(official.date)===date?official.races?.[String(Number(sid))]?.[String(Number(n))]:null;
    if(officialRace?.cancelled===true){markCancelled(current.records[k],{cancelled:true,source:'live official-results cancellation'});continue}
    if(current.records[k]?.outcome||current.records[k]?.cancelled||!Number.isFinite(closeMs(race))||closeMs(race)<=now.getTime()||closeMs(race)-now.getTime()>20*60000)continue;
    eligibleKeys.push(k);
    const previewRecord=String(previews.date)===date?previews.races?.[String(Number(sid))]?.[String(Number(n))]:null;
    const observation=previewObservation(race,previewRecord,{now:new Date().toISOString(),date,fileDate:previews.date});
    const supplemented=applyPreclosePreview(race,previewRecord,new Date());
    observation.supplemented=supplemented;observation.final_st_reason=stReason(Array.from({length:6},(_,i)=>race.preview?.racers?.[String(i+1)]?.start_timing));
    const rows=engine.predictionRows(ctx,race,sid,n,date);if(rows.length!==6){observeCapture(inputObservations.records,k,observation,'invalid_model_rows');continue;}
    const rec=snapshot({race,rows,expert:assess(race,rows),makeBets:engine.makeBets,date,stadium:sid,number:n,now:new Date(),
      odds:String(odds.date)===date?odds.races?.[String(Number(sid))]?.[String(Number(n))]:null});
    if(rec){rec.learning_inputs=captureLearningInputs({race,rows,date,stadium:sid,capturedAt:rec.saved_at,recent});rec.cohort=COHORT;const calibrated=captureOddsCalibration(rec,calibrationPrepared.model);if(calibrated)rec.odds_calibration_shadow=calibrated;rec.variants=captureVariants({race,rows,makeBets:engine.makeBets,capturedAt:rec.saved_at});rec.cohort=COHORT;rec.input_provenance=verified.proof;rec.official_preview_at=supplemented?previewRecord.fetched_at:null;rec.original_exhibition_at=race.original_exhibition_captured_at||null;rec.collector_version='shadow-data-v3-learning-inputs';const accepted=collectRevision(current.records,k,rec,revisionRejections);observeCapture(inputObservations.records,k,observation,accepted?'captured':'revision_rejected');}
    else observeCapture(inputObservations.records,k,observation,'snapshot_rejected');
  }
  let fallbackAttempts=0;
  for(const [d,store] of stores){
    for(const r of Object.values(store.records)){
      if(r.outcome||r.cancelled||String(official.date)!==d||closeMs(r)>now.getTime())continue;
      const result=official.races?.[String(Number(r.stadium))]?.[String(Number(r.race))];
      if(result?.cancelled===true)markCancelled(r,{cancelled:true,source:'live official-results cancellation'});
      // Published payout alone cannot establish whether tickets were refunded.
      // Settle below only with complete finishers, using API or verified daily K.
    }
    const pending=Object.values(store.records).filter(r=>!r.outcome&&!r.cancelled&&closeMs(r)<=now.getTime());if(!pending.length)continue;
    let results;try{results=await get(`https://boatraceopenapi.github.io/results/v3/${d.slice(0,4)}/${d}.json`)}catch(e){console.warn('Results API unavailable:',e.message);results={results:[]}}
    const map=new Map((results.results||[]).map(r=>[`${Number(r.stadium_number)}_${Number(r.number)}`,r]));
    const sourcePath=path.join(root,'dev/aptitude-prospective-source',d+'.json.gz');
    if(fs.existsSync(sourcePath)){
      const source=JSON.parse(gunzipSync(fs.readFileSync(sourcePath)));
      for(const p of source.payouts||[]){const boats=source.starts.filter(b=>b.stadium===p.stadium&&b.race===p.race).map(b=>({racer_boat_number:b.lane,racer_place_number:b.finish}));map.set(`${p.stadium}_${p.race}`,{boats,payouts:{trifecta:p.trifecta},source:'verified official daily K'});}
    }
    for(const r of pending){const result=map.get(`${Number(r.stadium)}_${Number(r.race)}`);if(result?.cancelled===true){markCancelled(r,{cancelled:true,source:'explicit cancellation'});continue;}
      let resolved=result,check=checkedOutcome(resolved);
      if(check.pending&&fallbackAttempts<12){
        fallbackAttempts++;
        try{resolved=await officialFallback(root,{date:d,stadium:r.stadium,race:r.race},String(official.date)===d?official.races?.[String(Number(r.stadium))]?.[String(Number(r.race))]:null);check=checkedOutcome(resolved);r.result_verification=resolved.verification;delete r.result_fetch_error;}
        catch(e){r.result_fetch_error={at:new Date().toISOString(),reason:e.message};}
      }
      if(check.exclude){r.excluded={reason:check.reason,confirmed:true,confirmed_at:new Date().toISOString()};r.outcome={excluded:true};}
      else if(check.eligible)settle(r,{combination:check.combo,amount:check.amount,source:resolved.source||'Open API complete normal finishers'});
    }
  }
  if(revisionRejections.length){
    current.revision_rejections=[...(current.revision_rejections||[]),...revisionRejections];
    console.warn('Rejected race revisions:',JSON.stringify(revisionRejections));
  }
  for(const [d,s] of stores)fs.writeFileSync(path.join(dir,d+'.json'),JSON.stringify(s)+'\n');
  const all=Object.assign({},...[...stores.values()].map(s=>s.records));
  const report={calibration:calibrationReadiness(all),variants:evaluateVariants(all),cohort:COHORT,input_provenance:verified.proof,...evaluate(all),health:health(all,{now:new Date(),eligibleKeys,originalStatus,programStatus:program?'available':'program_unpublished'})};
  report.collection_daily=collectionDaily(all,{now:Date.now(),program,date,cancelled:String(official.date)===date?official.races:{}});
  report.st_diagnostics=stDiagnostics(all);
  report.learning_inputs={...learningInputReport(all),current_recent_source_status:recentStatus};
  report.odds_diagnostics=oddsDiagnostics(all);
  report.odds_deterioration=oddsDeterioration(all);
  report.odds_calibration=oddsCalibrationReport(all,calibrationPrepared);
  report.selection_diagnostics=analyzeShadowSelections(Object.fromEntries(Object.entries(all).filter(([,r])=>!auditRecord(r).length)));
  report.collection_gaps=gapDiagnostics(report.collection_daily,inputObservations.records);
  report.input_observations={date,observed_races:Object.keys(inputObservations.records).length,official_preview_status:Object.values(inputObservations.records).reduce((s,o)=>(s[o.official_preview_status]=(s[o.official_preview_status]||0)+1,s),{})};
  fs.writeFileSync(inputFile,JSON.stringify(inputObservations)+'\n');
  report.health.revision_rejections=revisionRejections;
  if(revisionRejections.length)report.health.status='needs_attention';
  fs.writeFileSync(path.join(root,'dev/expert-shadow-repaired-evaluation.json'),JSON.stringify(report,null,2)+'\n');
  console.log(JSON.stringify({date,cohort:COHORT,saved:report.saved,settled:report.settled,pending:report.pending,through:verified.proof.history_through,health:report.health}));
}
if(import.meta.url===pathToFileURL(process.argv[1]).href)await run();
