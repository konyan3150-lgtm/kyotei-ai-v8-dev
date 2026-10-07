import assert from 'node:assert/strict';
import {analyzeSavedSelections,analyzeShadowSelections} from '../selection-analysis.mjs';
const base={date:'20261007',stadium:'18',saved_at:'2026-10-07T00:50:00Z',closed_at:'2026-10-07 10:00:00',settled:true,modes:{hit:{picks:['1-2-3'],stake:600,payout:1500,hit:true}},value_model_version:4,value_modes:{hit:{picks:['1-2-3'],stake:300,payout:4500,hit:true}},base_recommendations:{hit:{level:'buy',top:.8,gap:.3,coverage:90}},recommendations:{hit:{level:'skip'}},input_state:{water:{wind_speed:0},exhibition:Object.fromEntries([1,2,3,4,5,6].map(k=>[k,{start_timing:.1}]))}};
const miss={...structuredClone(base),stadium:'1',modes:{hit:{picks:['2-1-3'],stake:600,payout:0,hit:false}},base_recommendations:{hit:{level:'skip',top:.4,gap:.1,coverage:60}}};
const records={a:base,b:miss,pending:{...base,settled:false},cancelled:{...base,cancelled:true}},before=JSON.stringify(records);
const a=analyzeSavedSelections(records);assert.equal(a.summary.races,2);assert.equal(a.summary.investment,1200);assert.equal(a.summary.payout,1500);assert.equal(a.axes.decision.find(x=>x.key==='buy').roi,2.5);assert.equal(a.axes.wind.find(x=>x.key==='wind_low').races,2);assert.equal(a.excluded.pending,1);assert.equal(a.excluded.cancelled,1);
const ev=analyzeSavedSelections({a:base},{view:'value'});assert.equal(ev.summary.investment,300);assert.equal(ev.summary.payout,4500);assert.equal(ev.axes.decision[0].key,'skip');
const missing=analyzeSavedSelections({a:{...base,closed_at:undefined}});assert.equal(missing.axes.top[0].key,'unknown');assert.equal(missing.axes.timing[0].key,'unverified');
const late=analyzeSavedSelections({a:{...base,base_recommendations:{hit:{level:'buy',top:.9,created_at:'2026-10-07T01:01:00Z'}}}});assert.equal(late.axes.top[0].key,'unknown');assert.equal(late.axes.timing[0].key,'invalid');
assert.equal(JSON.stringify(records),before);
const s={...base,variants:{budget:{confident:true,top_score:.8,score_gap:.3}},outcome:{metrics:{baseline:{investment:600,payout:1500,hit:true}}}};
const shadow=analyzeShadowSelections({s});assert.equal(shadow.axes.decision[0].key,'confidence_yes');assert.equal(shadow.axes.coverage[0].key,'unknown');
for(const axis of Object.values(a.axes)){assert.equal(axis.reduce((n,g)=>n+g.races,0),a.summary.races);assert.equal(axis.reduce((n,g)=>n+g.investment,0),a.summary.investment);assert.equal(axis.reduce((n,g)=>n+g.payout,0),a.summary.payout);}
assert.equal(analyzeSavedSelections({}).summary.roi,null);
console.log('Selection analysis passed: saved V8/EV separation, fixed bins, missing/postclose inputs, cancellation/pending exclusion, matched totals and immutable records.');
