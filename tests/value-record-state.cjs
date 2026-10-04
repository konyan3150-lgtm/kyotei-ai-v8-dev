const vm=require('node:vm'),fs=require('node:fs'),assert=require('node:assert/strict'),path=require('node:path');
const root=process.argv[2]||'overrides';
function check(rec,needle){
 const original=JSON.stringify(rec),bets={innerHTML:''},recommendationBox={innerHTML:''},baseRecommendationBox={innerHTML:''};
 const ctx={window:{v8GetServerPrediction:()=>rec},document:{getElementById:id=>id==='bets'?bets:null},localStorage:{getItem:()=>null},resultStoreKey:()=> 'x',D:{programs:{stadiums:{9:{races:{12:{}}}}}},sid:9,rno:12,valuePredictionMode:'hit',basePredictionMode:'hit',models:[],raceCloseMs:()=>Date.now()-1000,hasOfficialResult:()=>false,renderBets(){},savePredictionSnapshot(){},settlePredictionKey(){},setTimeout(){},setInterval(){},Date,console};vm.createContext(ctx);
 ctx.race=()=>{};ctx.predictionRowsForRace=()=>[];
 ctx.document.getElementById=id=>({bets,recommendationBox,baseRecommendationBox})[id]||null;
 for(const file of ['value-record-state.js','odds-value.js','recommendation.js'])vm.runInContext(fs.readFileSync(path.join(root,file),'utf8'),ctx);
 const state=ctx.window.v8ValueRecordState(rec,'hit');const recommendations=ctx.window.v8SavedValueRecommendations(rec);
 ctx.renderBets([]);assert.ok(bets.innerHTML.includes(needle),bets.innerHTML);assert.equal(JSON.stringify(rec),original);
 ctx.race({});
 if(state.kind==='unavailable')assert.ok(!recommendationBox.innerHTML.includes('購入推奨</'));
 return {state,recommendations};
}
const missingOdds={recommendations:{hit:{level:'buy',score:100}},value_modes:{hit:{picks:[],items:[],stake:0,skipped:true}},odds_snapshot_at:null};
assert.equal(check(missingOdds,'オッズが未取得').recommendations.hit.level,'none');
const skipped={...missingOdds,odds_snapshot_at:'2026-10-04T06:50:00Z'};assert.equal(check(skipped,'見送り').recommendations.hit.level,'skip');
const valid={...missingOdds,value_modes:{hit:{picks:['1-2-3'],stake:100}},odds_snapshot_at:null};assert.equal(check(valid,'1-2-3').recommendations.hit.level,'buy');
check({},'締切前の保存買い目がありません');
const source=fs.readFileSync(path.join(root,'recommendation.js'),'utf8');assert.ok(source.includes('window.v8SavedValueRecommendations(savedDecision())'));assert.ok(source.includes("level='none';"));
console.log('Value-state checks passed: missing odds held, real skip distinct, saved picks preserved, missing record distinct, no mutations.');
