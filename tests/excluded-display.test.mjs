import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
test('results exclusion takes priority over stale hit and cancellation flags',()=>{
 const source=fs.readFileSync('results.mjs','utf8'),fn=source.match(/function status\(r,m\)\{[^\n]*\}/)[0];
 const status=vm.runInNewContext('('+fn+')');assert.equal(status({excluded:{confirmed:true},cancelled:true,settled:true},{hit:true,settled:true}),'excluded');
 assert.match(source,/集計除外/);assert.match(fs.readFileSync('results.html','utf8'),/value="excluded"/);
});
test('audit excludes special money and detects changed exclusion metadata',()=>{
 const context={window:{}};vm.runInNewContext(fs.readFileSync('overrides/record-audit.js','utf8'),context);
 const rec={settled:true,excluded:{kind:'refund'},modes:{hit:{picks:['1-2-3'],stake:600,payout:1230,settled:true}}};
 const displayed=structuredClone(rec);delete displayed.excluded;
 const audit=context.window.v8RecordAudit({server:{one:rec},displayed:{one:displayed}});assert.equal(audit.money.base.hit.server.investment,0);assert.equal(audit.differences.length,1);
});
