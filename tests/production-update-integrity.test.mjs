import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {setTimeout as delay} from 'node:timers/promises';
import {loadHistory,assertRetained,writeJsonBatch} from '../experiments/production-update/history_store.mjs';
import {verifyHistory} from '../experiments/production-update/verify_prediction_history.mjs';
import {fetchFeed} from '../experiments/production-update/feed_fetch.mjs';

function fixture() {
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'v8-update-integrity-')),data=path.join(root,'dev'),archive=path.join(data,'server-predictions-archive');
  fs.mkdirSync(archive,{recursive:true});
  const hotKey='kyotei_v8_dev_result_20260801_01_01',archiveKey='kyotei_v8_dev_result_20260701_01_01';
  const pending={date:'20260801',stadium:'1',race:'1',settled:false,modes:{hit:{picks:['1-2-3'],stake:600,payout:0}}};
  const settled={date:'20260701',stadium:'1',race:'1',settled:true,modes:{hit:{picks:['1-2-3'],stake:600,payout:800,settled:true}}};
  const write=(file,obj)=>fs.writeFileSync(file,JSON.stringify(obj));
  write(path.join(root,'racer-aptitude.json'),{schema:'kyotei-v8-racer-aptitude',racers:{}});
  write(path.join(data,'server-predictions.json'),{schema:'kyotei-v8-server-predictions',version:1,record_count:1,total_record_count:2,records:{[hotKey]:pending}});
  write(path.join(archive,'202607.json'),{schema:'kyotei-v8-server-predictions-archive',version:1,month:'202607',record_count:1,records:{[archiveKey]:settled}});
  write(path.join(data,'server-predictions-index.json'),{schema:'kyotei-v8-server-predictions-index',version:1,total_record_count:2,archives:[{month:'202607',file:'server-predictions-archive/202607.json',record_count:1}]});
  return {root,data,archive,hotKey,pending};
}
function bytes(root) {
  const result={};
  for(const entry of fs.readdirSync(root,{withFileTypes:true})) {
    const file=path.join(root,entry.name);
    if(entry.isDirectory())for(const [name,value]of Object.entries(bytes(file)))result[entry.name+'/'+name]=value;
    else result[entry.name]=fs.readFileSync(file).toString('base64');
  }
  return result;
}
let moduleNumber=0;
async function withUpdater(f, callback) {
  const names=['PREDICTION_DATA_ROOT','OUTPUT_PATH','ARCHIVE_DIR','ARCHIVE_INDEX'],old=Object.fromEntries(names.map(k=>[k,process.env[k]])),originalFetch=globalThis.fetch;
  process.env.PREDICTION_DATA_ROOT=f.root;
  process.env.OUTPUT_PATH=path.join(f.data,'server-predictions.json');process.env.ARCHIVE_DIR=f.archive;process.env.ARCHIVE_INDEX=path.join(f.data,'server-predictions-index.json');
  globalThis.fetch=async url=>{
    const body=String(url).includes('v8_model')?{ranks:{1:{},2:{},3:{}}}:String(url).includes('/results/')?{results:[]}:{programs:{stadiums:{}}};
    return {ok:true,json:async()=>body,text:async()=>''};
  };
  try { const {run}=await import('../experiments/production-update/update_server_predictions.mjs?fixture='+moduleNumber++);return await callback(run); }
  finally { globalThis.fetch=originalFetch;for(const k of names)if(old[k]===undefined)delete process.env[k];else process.env[k]=old[k]; }
}
for(const name of ['dev/server-predictions.json','dev/server-predictions-index.json','dev/server-predictions-archive/202607.json','racer-aptitude.json']) {
  test('corrupt '+name+' stops updater without changing any file',async()=>{
    const f=fixture();try {
      fs.writeFileSync(path.join(f.root,name),'{broken');const before=bytes(f.root);
      await withUpdater(f,async run=>{let requests=0;globalThis.fetch=async()=>{requests++;throw Error('unexpected network')};await assert.rejects(run({now:new Date('2026-10-03T12:00:00Z')}),/Cannot read valid JSON/);assert.equal(requests,0);});
      assert.deepEqual(bytes(f.root),before);
    } finally {fs.rmSync(f.root,{recursive:true,force:true});}
  });
}
test('valid JSON with invalid history schema also stops without writes',async()=>{
  const f=fixture();try{fs.writeFileSync(path.join(f.data,'server-predictions.json'),'{}');const before=bytes(f.root);await withUpdater(f,run=>assert.rejects(run(),/Invalid history schema/));assert.deepEqual(bytes(f.root),before);}finally{fs.rmSync(f.root,{recursive:true,force:true});}
});
test('indexed but missing archive is rejected before any write',()=>{
  const f=fixture();try{fs.unlinkSync(path.join(f.archive,'202607.json'));const before=bytes(f.root);assert.throws(()=>loadHistory(path.join(f.data,'server-predictions.json'),f.archive,path.join(f.data,'server-predictions-index.json')),/Archive index mismatch/);assert.deepEqual(bytes(f.root),before);}finally{fs.rmSync(f.root,{recursive:true,force:true});}
});
test('45-day pending record and monetary values survive repeated updater runs',async()=>{
  const f=fixture();try{
    const archiveBefore=fs.readFileSync(path.join(f.archive,'202607.json'),'utf8');
    await withUpdater(f,async run=>{for(let i=0;i<2;i++){const out=await run({now:new Date('2026-10-03T12:00:00Z')});assert.equal(out.total_record_count,2);assert.equal(out.run.stale_pending,1);assert.deepEqual(out.records[f.hotKey],f.pending);}});
    assert.equal(fs.readFileSync(path.join(f.archive,'202607.json'),'utf8'),archiveBefore);
    assert.equal(loadHistory(path.join(f.data,'server-predictions.json'),f.archive,path.join(f.data,'server-predictions-index.json')).keys.size,2);
  }finally{fs.rmSync(f.root,{recursive:true,force:true});}
});
test('interruption before rename preserves originals and removes staged files',()=>{
  const f=fixture();try{const before=bytes(f.root);assert.throws(()=>writeJsonBatch([[path.join(f.data,'server-predictions.json'),{}],[path.join(f.data,'server-predictions-index.json'),{}]],{beforeRename(){throw Error('interrupted')}}),/interrupted/);assert.deepEqual(bytes(f.root),before);}finally{fs.rmSync(f.root,{recursive:true,force:true});}
});
test('archiving settled hot record preserves its key, saved stake and payout',async()=>{
  const f=fixture();try{
    const hotFile=path.join(f.data,'server-predictions.json'),hot=JSON.parse(fs.readFileSync(hotFile));
    hot.records[f.hotKey].settled=true;Object.assign(hot.records[f.hotKey].modes.hit,{settled:true,payout:1230});fs.writeFileSync(hotFile,JSON.stringify(hot));
    await withUpdater(f,async run=>{const out=await run({now:new Date('2026-10-03T12:00:00Z')});assert.equal(out.total_record_count,2);assert.equal(out.records[f.hotKey],undefined);});
    const snapshot=loadHistory(hotFile,f.archive,path.join(f.data,'server-predictions-index.json'));
    assert.ok(snapshot.keys.has(f.hotKey));assert.equal(snapshot.archives.get('202608').records[f.hotKey].modes.hit.stake,600);assert.equal(snapshot.archives.get('202608').records[f.hotKey].modes.hit.payout,1230);
  }finally{fs.rmSync(f.root,{recursive:true,force:true});}
});
test('missing key is rejected even if total count stays constant',()=>{
  assert.throws(()=>assertRetained(new Set(['old']),{replacement:{}},[]),/lose record: old/);
});
test('precommit verifier rejects valid but smaller history',()=>{
  const f=fixture();try{const baseline=path.join(f.root,'baseline.json');verifyHistory(f.data,baseline,true);const hot=JSON.parse(fs.readFileSync(path.join(f.data,'server-predictions.json')));hot.records={};hot.record_count=0;hot.total_record_count=1;fs.writeFileSync(path.join(f.data,'server-predictions.json'),JSON.stringify(hot));const index=JSON.parse(fs.readFileSync(path.join(f.data,'server-predictions-index.json')));index.total_record_count=1;fs.writeFileSync(path.join(f.data,'server-predictions-index.json'),JSON.stringify(index));assert.throws(()=>verifyHistory(f.data,baseline),/lose record/);}finally{fs.rmSync(f.root,{recursive:true,force:true});}
});
test('network retry recovers transient error and stops after bounded attempts',async()=>{
  const original=globalThis.fetch;try{let calls=0;globalThis.fetch=async()=>{if(++calls===1)throw Error('temporary');return{ok:true,json:async()=>({ok:true})}};assert.deepEqual(await fetchFeed('https://fixture.invalid',{retryDelayMs:0}),{ok:true});assert.equal(calls,2);calls=0;globalThis.fetch=async()=>{calls++;throw Error('offline')};await assert.rejects(fetchFeed('https://fixture.invalid',{retryDelayMs:0}),/after 2 attempts/);assert.equal(calls,2);}finally{globalThis.fetch=original;}
});
test('network timeout aborts hung request and optional failure is visible',async()=>{
  const original=globalThis.fetch,originalWarn=console.warn,warnings=[];
  try{let calls=0;globalThis.fetch=async(url,{signal})=>{calls++;return new Promise((resolve,reject)=>signal.addEventListener('abort',()=>reject(signal.reason),{once:true}))};console.warn=message=>warnings.push(message);const keepingAlive=delay(60);assert.equal(await fetchFeed('https://fixture.invalid',{type:'text',required:false,timeoutMs:10,retryDelayMs:0}),'');await keepingAlive;assert.equal(calls,2);assert.equal(warnings.length,1);assert.match(warnings[0],/after 2 attempts/);}finally{globalThis.fetch=original;console.warn=originalWarn;}
});
test('candidate workflow blocks prediction errors and verifies history before commit',()=>{
  const source=fs.readFileSync('experiments/production-update/update-live-odds.candidate.yml','utf8');
  const step=source.slice(source.indexOf('- name: Save predictions'),source.indexOf('- name: Backfill historical'));
  assert.doesNotMatch(step,/continue-on-error/);assert.ok(source.indexOf('Verify history preservation before commit')<source.indexOf('Commit updated odds and predictions'));
  assert.ok(!fs.existsSync('.github/workflows/update-live-odds.candidate.yml'));
});
