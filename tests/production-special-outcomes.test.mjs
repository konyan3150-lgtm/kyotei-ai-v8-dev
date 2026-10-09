import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {officialResultFixture} from './official-result-fixture.mjs';
import {parseOfficialResult} from '../experiments/production-update/official_result_parser.mjs';
import {parseOfficialPayPage} from '../experiments/production-update/fetch_official_results.mjs';
import {verifyIndividualResult} from '../experiments/production-update/verified_outcome.mjs';
import {applyResults,settle} from '../experiments/production-update/settlement.mjs';
import {compactSettledRecord,summarizeExperts} from '../experiments/production-update/update_server_predictions.mjs';
import {summarizeOutcomeGroups} from '../experiments/production-update/outcome_summary.mjs';
const request={date:'20261009',stadium:'1',race:'1'},published={combination:'1-2-3',amount:1230};
const record=()=>({...request,saved_at:'2026-10-09T01:00:00Z',value_model_version:4,modes:{hit:{picks:['1-2-3'],stake:600,settled:false,payout:0}},value_modes:{hit:{picks:['1-2-3'],stake:200,items:[{combo:'1-2-3',stake:200}],settled:false,payout:0}},expert_snapshot:{active:'inside'}});
for(const [kind,flags]of [['refund',{refund:true}],['special_payout',{special:true}],['nonstandard_result',{nonstandard:true}]])test('official '+kind+' excluded with frozen purchase and proof',async()=>{
  const result=await verifyIndividualResult(request,published,{fetchIndividual:async()=>officialResultFixture(request,flags)});assert.equal(result.excluded.kind,kind);assert.equal(result.verification.html_sha256.length,64);
  const rec=record(),purchases=structuredClone([rec.modes.hit,rec.value_modes.hit]);const counts=applyResults({one:rec},{date:request.date,races:{1:{1:result}}});assert.deepEqual(counts,{settled:0,cancelled:0,excluded:1});assert.equal(rec.settled,undefined);assert.equal(rec.cancelled,undefined);assert.equal(rec.modes.hit.stake,purchases[0].stake);assert.deepEqual(rec.value_modes.hit.items,purchases[1].items);
  const saved=compactSettledRecord(rec);assert.equal(saved.saved_at,rec.saved_at);assert.equal(saved.excluded.kind,kind);assert.equal(saved.excluded.verification.html_sha256,result.verification.html_sha256);
  const before=structuredClone(rec);settle(rec,published);assert.deepEqual(rec,before);assert.equal(summarizeExperts([saved]).settled,0);
  const normal=record();settle(normal,published);const summary=summarizeOutcomeGroups({normal,special:saved});assert.equal(summary.ordinary.modes.hit.saved_investment,600);assert.equal(summary.ordinary.value_modes.hit.payout,2460);assert.equal(summary.excluded.records,1);assert.equal(summary.excluded.saved_purchases.modes.hit.saved_investment,600);assert.equal(summary.excluded.saved_purchases.value_modes.hit.saved_investment,200);assert.equal(summary.excluded.saved_purchases.value_modes.hit.payout,0);assert.equal(summary.pending,0);
});
test('identity mismatch, missing refund table and uncertain result stay pending',async()=>{
  const html=officialResultFixture(request);
  for(const broken of [html.replace('hd=20261009','hd=20261008'),html.replace('<th>返還</th>','<th>不明</th>'),html.replace('&yen;1,230','&yen;---')]){const result=await verifyIndividualResult(request,published,{fetchIndividual:async()=>broken});assert.equal(result.pending,true);assert.equal(result.excluded,undefined);}
});
test('ordinary result must match daily published payout',async()=>{
  const outcome=await verifyIndividualResult(request,{...published,amount:999},{fetchIndividual:async()=>officialResultFixture(request)});assert.equal(outcome.reason,'published_payout_mismatch');
});
test('special payout without valid amount is unconfirmed',async()=>{
  const html=officialResultFixture(request,{special:true}).replace('&yen;70','&yen;---');const result=await verifyIndividualResult(request,published,{fetchIndividual:async()=>html});assert.equal(result.pending,true);assert.equal(result.excluded,undefined);
});
test('exclusion without matching request and HTML hash is rejected',()=>{
  assert.throws(()=>applyResults({one:record()},{date:request.date,races:{1:{1:{excluded:{confirmed:true,kind:'refund'}}}}}),/Unverified special/);
});
test('real captured official page retains normal payout validation',()=>{
  const html=fs.readFileSync('experiments/fixtures/official-result-20261003-23-1.html','utf8'),result=parseOfficialResult(html,{date:'20261003',stadium:23,race:1});assert.equal(result.official_special,false);assert.deepEqual(result.payouts.trifecta,[{combination:'2-1-4',amount:3480}]);
});
test('daily special marker triggers individual verification without fabricated trifecta',()=>{
  const result=parseOfficialPayPage('<td data-href="/x?rno=1&amp;jcd=01&amp;hd=20261009">特払</td><td>70</td>','20261009');assert.deepEqual(result.races[1][1],{requires_individual_verification:true});
});
