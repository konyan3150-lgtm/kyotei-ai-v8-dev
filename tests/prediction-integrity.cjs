const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict');
const key='kyotei_v8_dev_result_20261003_18_01';
async function check(local,server){
 const store=new Map(local?[[key,JSON.stringify(local)]]:[]);const ctx={window:{dispatchEvent(){}},document:{getElementById(){return null}},localStorage:{get length(){return store.size},key:i=>[...store.keys()][i],getItem:k=>store.get(k)||null,setItem:(k,v)=>store.set(k,v)},fetch:async()=>({ok:true,json:async()=>({schema:'kyotei-v8-server-predictions',version:1,records:{[key]:server}})}),setTimeout(){},setInterval(){},CustomEvent:function(){},Date,console};
 vm.createContext(ctx);vm.runInContext(fs.readFileSync(process.argv[2]||'overrides/server-sync.js','utf8'),ctx);await ctx.window.syncServerPredictions();
 const single=JSON.parse(JSON.stringify(ctx.window.v8GetServerPrediction(key))),list=JSON.parse(JSON.stringify(ctx.window.v8GetSavedPredictions()[key]));assert.deepEqual(single,list);
 for(const group of ['modes','value_modes'])for(const [mode,m] of Object.entries(server[group]||{})){assert.equal(single[group][mode].stake,m.stake);assert.equal(single[group][mode].payout,m.payout);assert.deepEqual(single[group][mode].picks,m.picks);}
 return single;
}
(async()=>{
 const server={source:'server',settled:true,value_model_version:4,value_saved_at:'2026-10-03T00:00:00Z',modes:{hit:{picks:['1-2-3'],stake:100,payout:1500},balance:{picks:['2-3-4'],stake:600,payout:0},return:{picks:['6-5-4'],stake:600,payout:0}},value_modes:{hit:{picks:['1-2-3','1-2-4'],stake:400,payout:4500,hit:true,result:'1-2-3'},balance:{picks:['2-3-4'],stake:300,payout:0},return:{picks:['6-5-4'],stake:200,payout:0}}};
 const local={...server,value_modes:{hit:{...server.value_modes.hit,items:[{combo:'1-2-3',stake:300},{combo:'1-2-4',stake:100}]}}};
 const out=await check(local,server);assert.equal(out.value_modes.hit.items.length,2);assert.equal(out.value_modes.hit.payout,4500);assert.equal(out.modes.hit.payout,1500);
 const incompatible=structuredClone(local);incompatible.value_modes.hit.stake=600;incompatible.value_modes.hit.items[0].stake=500;assert.equal((await check(incompatible,server)).value_modes.hit.items,undefined);
 const otherTime=structuredClone(local);otherTime.value_saved_at='2026-10-03T00:01:00Z';assert.equal((await check(otherTime,server)).value_modes.hit.items,undefined);
 await check(null,server);await check(local,{...server,cancelled:true});
 console.log('Prediction integrity passed: single/list parity, six/value mode separation, authoritative stake/payout, no double multiplier, matching saved timestamp and cancellation.');
})().catch(e=>{console.error(e);process.exit(1)});
