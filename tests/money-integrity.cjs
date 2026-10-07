const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict'),path=require('node:path');
const root=process.argv[2]||'overrides',key='kyotei_v8_dev_result_20261003_18_01';
function harness(record){
 const store=new Map([[key,JSON.stringify(record)]]);let saves=0,settles=0;
 const ctx={window:{},document:{getElementById:()=>null},localStorage:{getItem:k=>store.get(k)||null,setItem:(k,v)=>store.set(k,v)},resultStoreKey:()=>key,
  renderBets(){},savePredictionSnapshot(){saves++;return true},settlePredictionKey(){settles++;return true},race(){},hasOfficialResult:()=>true,
  setTimeout(){},setInterval(){},Date,console};
 vm.createContext(ctx);
 for(const f of ['value-record-state.js','odds-value.js','recommendation.js'])vm.runInContext(fs.readFileSync(path.join(root,f),'utf8'),ctx);
 return {ctx,read:()=>JSON.parse(store.get(key)),calls:()=>({saves,settles})};
}
const server={source:'server',saved_at:'2026-10-03T00:50:00Z',settled:true,value_model_version:4,
 modes:{hit:{picks:['1-2-3'],stake:600,settled:true,payout:1500}},
 value_modes:{hit:{picks:['1-2-3','1-2-4'],stake:400,settled:true,hit:true,payout:4500}}};
const result={result:{payouts:{trifecta:[{combination:'1-2-3',amount:1500}]}}};
for(const record of [server,{...server,settled:false,value_modes:{hit:{...server.value_modes.hit,settled:false,payout:0}}},{...server,cancelled:true}]){
 const h=harness(record),before=h.read();
 h.ctx.settlePredictionKey(result,key);h.ctx.settlePredictionKey(result,key);
 h.ctx.savePredictionSnapshot({},[]);
 assert.deepEqual(h.read(),before,'Server snapshots and money must remain unchanged in browser');
 assert.deepEqual(h.calls(),{saves:0,settles:0});
}
const local={value_modes:{hit:{picks:['1-2-3','1-2-4'],stake:400,settled:false,items:[{combo:'1-2-3',stake:300},{combo:'1-2-4',stake:100}]}}};
const h=harness(local);h.ctx.settlePredictionKey(result,key);assert.equal(h.read().value_modes.hit.payout,4500);
h.ctx.settlePredictionKey({result:{payouts:{trifecta:[{combination:'1-2-4',amount:9000}]}}},key);
assert.equal(h.read().value_modes.hit.payout,4500,'Already settled local EV mode must remain unchanged');
console.log('Money integrity passed: immutable server saves/results/cancellations, local 300-yen payouts and idempotent settlement.');
if(process.argv[3]){
 const data=JSON.parse(fs.readFileSync(process.argv[3],'utf8'));let count=0;
 for(const record of Object.values(data.records||{})){
  const h=harness(record),before=h.read();h.ctx.settlePredictionKey(result,key);h.ctx.savePredictionSnapshot({},[]);
  assert.deepEqual(h.read(),before);count++;
 }
 console.log(`Actual imported records preserved: ${count}; snapshot updated ${data.updated_at}.`);
}
