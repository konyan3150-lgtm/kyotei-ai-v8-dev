const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict');
const ctx={window:{}};vm.createContext(ctx);vm.runInContext(fs.readFileSync(process.argv[2]||'overrides/record-audit.js','utf8'),ctx);
const r={date:'20261007',saved_at:'2026-10-07T00:50:00Z',settled:true,modes:{hit:{picks:['1-2-3'],stake:600,payout:1500}},value_model_version:4,value_modes:{hit:{picks:['1-2-3'],items:[{combo:'1-2-3',stake:300}],stake:300,payout:4500}}};
const a={one:r,two:{...structuredClone(r),cancelled:true},three:{...structuredClone(r),settled:false}},b=structuredClone(a),before=JSON.stringify(a);
let audit=ctx.window.v8RecordAudit({server:a,displayed:b});assert.equal(audit.server_code,audit.displayed_code);assert.equal(audit.money.base.hit.server.investment,600);assert.equal(audit.money.value.hit.server.payout,4500);
b.one.value_modes.hit.payout=1500;audit=ctx.window.v8RecordAudit({server:a,displayed:b});assert.equal(audit.differences.length,1);assert.notEqual(audit.server_code,audit.displayed_code);assert.equal(audit.money.value.hit.displayed.payout,1500);assert.equal(JSON.stringify(a),before);
b.local={...r,date:'20261006'};audit=ctx.window.v8RecordAudit({server:a,displayed:b,filter:r=>r.date==='20261007'});assert.equal(audit.local_only,0);
console.log('Record audit passed: separate V8/EV stakes, cancellation/pending exclusion, differences, date scope and no source changes.');
