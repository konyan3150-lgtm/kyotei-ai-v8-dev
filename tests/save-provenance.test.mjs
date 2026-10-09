import test from 'node:test';
import assert from 'node:assert/strict';
import {aptitudeHistoryEnd,saveProof,modelHash} from '../experiments/production-update/save_provenance.mjs';
const params={date:'20261010',savedAt:'2026-10-10T01:00:00Z',closedAt:'2026-10-10T01:02:00Z',historyEnd:'20261009',modelSha:modelHash('model')};
test('reject same-day/future/missing aptitude history',()=>{for(const history_end of ['20261010','20261011',undefined])assert.throws(()=>aptitudeHistoryEnd({history_end},'20261010'),/history must end/);assert.equal(aptitudeHistoryEnd({history_end:'20261009'},'20261010'),'20261009');});
test('proof retains exact source hash and pre-close timestamps',()=>{assert.equal(saveProof(params).model_sha256,modelHash('model'));assert.equal(saveProof(params).closed_at,params.closedAt.replace('00Z','00.000Z'));assert.equal(saveProof(params).aptitude_history_end,'20261009');});
test('at/after 60-second boundary saves nothing',()=>{for(const savedAt of ['2026-10-10T01:01:00Z','2026-10-10T01:02:00Z'])assert.equal(saveProof({...params,savedAt}),null);});
test('race date and saved date must agree in JST',()=>{assert.equal(saveProof({...params,date:'20261009'}),null);});
