const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict');
const root=process.argv[2]||'overrides';
async function programChecks(){
 const source=fs.readFileSync(root+'/app2.js','utf8');
 const elements=new Map(),element=id=>{if(!elements.has(id))elements.set(id,{innerHTML:'old race',textContent:'old race'});return elements.get(id)};
 const c={console,AbortSignal,Date,document:{getElementById:element},dateOffset:1,D:{date:'20261006'},S:[],sid:'1',rno:'1',originalExMap:{},origDiag:element('origDiag'),models:[],updateDateButtons(){},day:()=> '20261007',setTimeout(){},sortVenues:x=>x,isRaceCancelled:()=>false,settleStoredPredictions:()=>0,mergeOfficialResults:async()=>0,updateAutoJudge(){},draw(){}};
 vm.createContext(c);
 vm.runInContext(source.slice(source.indexOf('async function fetchRaceProgramRaw('),source.indexOf('async function fetchRaceProgram(',source.indexOf('async function fetchRaceProgramRaw('))),c);
 let calls=0;c.fetch=async()=>{calls++;return{ok:true,json:async()=>({date:'20260917',programs:{stadiums:{1:{races:{1:{}}}}}})}};
 await assert.rejects(c.fetchRaceProgramRaw('20261007','2026'),/取得待ち/);assert.equal(calls,2);
 calls=0;c.fetch=async()=>({ok:true,json:async()=>({date:'20261007',programs:{stadiums:{}}})});assert.equal((await c.fetchRaceProgramRaw('20261007','2026')).data.date,'20261007');
 // Official API omits the root date and uses ISO dates on individual races.
 c.fetch=async()=>({ok:true,json:async()=>({programs:{stadiums:{1:{races:{1:{date:'2026-10-07'},2:{date:'2026-10-07'}}}}}})});
 assert.equal((await c.fetchRaceProgramRaw('20261007','2026')).data.date,'20261007');
 for(const payload of [
  {programs:{stadiums:{1:{races:{1:{date:'2026-10-06'}}}}}},
  {programs:{stadiums:{1:{races:{1:{date:'2026-10-07'},2:{date:'2026-10-06'}}}}}},
  {programs:{stadiums:{1:{races:{1:{}}}}}},
  {programs:{stadiums:{}}}
 ]){c.fetch=async()=>({ok:true,json:async()=>payload});await assert.rejects(c.fetchRaceProgramRaw('20261007','2026'),/取得待ち/)}
 vm.runInContext(source.slice(source.indexOf('let programLoadId=0;'),source.indexOf('\n',source.indexOf('async function load(){'))),c);
 c.fetchRaceProgram=async()=>{throw Error('翌日データ取得待ち')};await c.load();assert.equal(c.D,null);assert.equal(element('bets').textContent,'対象日のデータ取得待ち');assert.equal(element('valueSavedAudit').innerHTML,'');assert.equal(element('selectedRace').textContent,'選択中：--');
 // A late response from the previously selected day must not replace the new day.
 const waits=[];let target='20261006';c.day=()=>target;c.fetchRaceProgram=d=>new Promise(resolve=>waits.push({d,resolve}));
 const first=c.load();target='20261007';const second=c.load();
 const payload=d=>({data:{date:d,programs:{stadiums:{1:{races:{1:{}}}}}},source:'test'});
 waits[1].resolve(payload('20261007'));await second;waits[0].resolve(payload('20261006'));await first;assert.equal(c.D.date,'20261007');
 // Temporary errors on the same date preserve the previously fetched program.
 c.fetchRaceProgram=async()=>{throw Error('network')};await c.load();assert.equal(c.D.date,'20261007');assert.match(element('status').textContent,/前回取得分/);
}
async function syncChecks(){
 let calls=0,fail=false,older=false;const el={textContent:''},events={};
 const today=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Tokyo',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date()).replace(/-/g,'');
 const key='kyotei_v8_dev_result_'+today+'_1_1';const initial=new Date(Date.now()-3600000).toISOString();
 const store=new Map();const c={console,Date,AbortSignal,CustomEvent:function(){},window:{dispatchEvent(){},addEventListener:(k,fn)=>events[k]=fn},document:{visibilityState:'visible',addEventListener:(k,fn)=>events[k]=fn,getElementById:()=>el},localStorage:{get length(){return store.size},key:i=>[...store.keys()][i],getItem:k=>store.get(k),setItem:(k,v)=>store.set(k,v)},setTimeout(fn,ms){if(ms===1000)fn()},setInterval(){},fetch:async()=>{calls++;if(fail||calls===1)throw Error('network');return{ok:true,json:async()=>({schema:'kyotei-v8-server-predictions',version:1,updated_at:older?'2020-01-01T00:00:00Z':initial,records:{[key]:{saved_at:initial,settled:false,picks:['1-2-3']}}})}}};
 vm.createContext(c);vm.runInContext(fs.readFileSync(root+'/server-sync.js','utf8'),c);
 await c.window.syncServerPredictions();assert.equal(calls,2);assert.match(el.textContent,/更新遅れ/);const previous=c.window.__v8ServerPredictionData;
 older=true;await c.window.syncServerPredictions();assert.equal(c.window.__v8ServerPredictionData,previous);
 fail=true;const before=calls;await c.window.syncServerPredictions();assert.equal(calls-before,2);assert.equal(c.window.__v8ServerPredictionData,previous);assert.deepEqual(Array.from(c.window.v8GetServerPrediction(key).picks),['1-2-3']);
 assert.equal(typeof events.visibilitychange,'function');assert.equal(typeof events.online,'function');
}
(async()=>{await programChecks();await syncChecks();console.log('Refresh checks passed: date validation, empty-state clearing, late response isolation, preserved data, bounded retry, stale status and foreground reconnect.')})().catch(e=>{console.error(e);process.exit(1)});
