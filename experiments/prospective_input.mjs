import fs from 'node:fs';
import {historicalOutcome} from './historical_outcome.mjs';
import path from 'node:path';
import crypto from 'node:crypto';
import {validate,day,nextDay} from './rebuild_aptitude.mjs';
export const COHORT='expert-shadow-official-v1';
export const sha256=s=>crypto.createHash('sha256').update(s).digest('hex');
export function verifyInput(data,audit,date,bytes){
 if(audit.status!=='verified'||audit.cohort!==COHORT||data.prospective_cohort!==COHORT||audit.snapshot_sha256!==sha256(bytes))throw Error('Unverified prospective input');
 validate(data);
 if(nextDay(data.through)!==day(date)||audit.through!==data.through||audit.starts!==data.starts)throw Error('History must end exactly yesterday');
 let expected=nextDay(audit.base_through),total=audit.base_starts;
 for(const d of audit.appended_days){if(d.date!==expected||!Number.isInteger(d.starts)||d.starts<0||!d.source_sha256?.B||!d.source_sha256?.K)throw Error('Invalid official history ledger');expected=nextDay(d.date);total+=d.starts;}
 if(expected!==nextDay(data.through)||total!==data.starts)throw Error('History ledger mismatch');
 return {cohort:COHORT,history_through:data.through,starts:data.starts,aptitude_sha256:audit.snapshot_sha256,base_snapshot_sha256:audit.base_snapshot_sha256};
}
export function verifiedInput(root,date,engineRoot){
 const bytes=fs.readFileSync(path.join(root,'dev/racer-aptitude-prospective.json')),data=JSON.parse(bytes),audit=JSON.parse(fs.readFileSync(path.join(root,'dev/aptitude-prospective-audit.json')));
 const proof=verifyInput(data,audit,date,bytes);
 proof.model_sha256=sha256(fs.readFileSync(path.join(engineRoot,'v8_model_aptitude.json')));
 proof.auxiliary_sha256=Object.fromEntries(['course-stats','venue-stats','technique-stats','odds','official-previews'].map(k=>{const p=path.join(engineRoot,'dev',k+'.json');return [k,fs.existsSync(p)?sha256(fs.readFileSync(p)):null];}));
 return {data,proof};
}
export function verifyStore(store){
 if(store.cohort!==COHORT)throw Error('Archive cohort mismatch');
 for(const r of Object.values(store.records||{}))for(const s of [...(r.revisions||[]),r])if(s.cohort!==COHORT||s.input_provenance?.cohort!==COHORT||nextDay(s.input_provenance.history_through)!==day(s.date))throw Error('Record provenance/cohort mismatch');
}

export function checkedOutcome(race){
 if(!Array.isArray(race?.boats)||!race.boats.length||!race.payouts?.trifecta?.length)return {eligible:false,pending:true};
 const ranks=race.boats.map(b=>b.racer_place_number);
 const completeNormal=race.boats.length===6&&new Set(ranks).size===6&&ranks.every(n=>Number.isInteger(n)&&n>=1&&n<=6);
 if(completeNormal)return historicalOutcome(race);
 const confirmed=race.source==='verified official daily K'||ranks.some(n=>Number.isInteger(n)&&n>6);
 if(confirmed)return {eligible:false,exclude:true,confirmed:true,reason:'confirmed_special_result_or_possible_refund'};
 return {eligible:false,pending:true};
}
export function reopenUnconfirmed(store){
 let reopened=0;
 for(const r of Object.values(store.records||{}))if(r.excluded?.reason==='special_result_or_possible_refund'&&!r.excluded.confirmed){
  r.settlement_reviews??=[];r.settlement_reviews.push({previous_exclusion:r.excluded,reviewed_at:new Date().toISOString(),reason:'Prior classifier did not establish completed results; retry authoritative settlement.'});
  delete r.excluded;delete r.outcome;reopened++;
 }
 return reopened;
}
