import {createHash} from 'node:crypto';
export const LEARNING_INPUT_POLICY='recent-player-preclose-v1';
const sha=s=>createHash('sha256').update(s).digest('hex');
const integer=(v,a,b)=>v!==null&&v!==undefined&&v!==''&&Number.isInteger(Number(v))&&Number(v)>=a&&Number(v)<=b;
export function validateRecentInput(bytes,date,proof){
 const store=JSON.parse(bytes);
 if(store.version!==LEARNING_INPUT_POLICY||store.as_of_date!==date||store.history_through!==proof.history_through||store.source?.aptitude_sha256!==proof.aptitude_sha256||!store.players||!store.empty_group)throw Error('Recent input date/provenance mismatch');
 for(const days of [30,90]){const c=store.coverage?.[days];if(c?.required_days!==days||c.through!==store.history_through||!integer(c.source_days,0,days)||c.source_complete!==(c.source_days===days))throw Error('Invalid recent input coverage');}
 return {store,sha256:sha(bytes)};
}
export function captureLearningInputs({race,rows,date,stadium,capturedAt,recent}){
 const close=Date.parse(String(race.closed_at).replace(' ','T')+'+09:00'),at=Date.parse(capturedAt);
 if(!Number.isFinite(at)||!Number.isFinite(close)||at>=close||String(race.date||'').replaceAll('-','')!==date)throw Error('Learning inputs require matching preclose capture');
 const lanes=[];
 for(const row of rows){
  const x=race.racers?.[row.k],engine=row.x||x;
  const ids=[x?.number,x?.registration_number,engine?.number,engine?.registration_number].filter(v=>v!==null&&v!==undefined&&v!=='');
  if(!integer(row.k,1,6)||!ids.length||ids.some(v=>!integer(v,1000,9999))||new Set(ids.map(Number)).size!==1)return {policy:LEARNING_INPUT_POLICY,captured_at:capturedAt,status:'identity_missing_or_conflicting',lanes:[]};
  const raw=race.preview?.racers?.[row.k]?.course_number,observed=integer(raw,1,6),course=observed?Number(raw):null;
  const entry={lane:Number(row.k),registration_number:Number(ids[0]),planned_course:course,course_source:observed?'observed_preclose_preview':'unavailable'};
  if(recent){
   const p=recent.store.players[String(entry.registration_number)];
   entry.recent=Object.fromEntries([30,90].map(days=>{const w=p?.[days]||{},empty=recent.store.empty_group;return [days,{...recent.store.coverage[days],groups:{overall:w.overall||empty,course:course?w['c_'+course]||empty:null,venue:w['v_'+Number(stadium)]||empty,venue_course:course?w[`x_${Number(stadium)}_${course}`]||empty:null}}];}));
  }
  lanes.push(entry);
 }
 if(lanes.length!==6||new Set(lanes.map(x=>x.lane)).size!==6||new Set(lanes.map(x=>x.registration_number)).size!==6)return {policy:LEARNING_INPUT_POLICY,captured_at:capturedAt,status:'identity_missing_or_conflicting',lanes:[]};
 return {policy:LEARNING_INPUT_POLICY,captured_at:capturedAt,status:recent?'captured':'recent_history_unavailable',lanes,
  recent_source:recent?{sha256:recent.sha256,history_through:recent.store.history_through,official_history_sha256:recent.store.source.official_history_sha256,prospective_audit_sha256:recent.store.source.prospective_audit_sha256,aptitude_sha256:recent.store.source.aptitude_sha256}:null,
  used_in_predictions:false};
}
export function learningInputReport(records){
 const counts={not_captured:0,captured:0,recent_history_unavailable:0,identity_missing_or_conflicting:0,invalid_capture:0};
 for(const r of Object.values(records)){const x=r.learning_inputs;if(!x){counts.not_captured++;continue;}const at=Date.parse(r.saved_at),close=Date.parse(String(r.closed_at).replace(' ','T')+'+09:00');if(x.policy!==LEARNING_INPUT_POLICY||x.captured_at!==r.saved_at||!Number.isFinite(at)||!Number.isFinite(close)||at>=close)counts.invalid_capture++;else if(Object.hasOwn(counts,x.status))counts[x.status]++;else counts.invalid_capture++;}
 return {policy:LEARNING_INPUT_POLICY,counts,used_in_predictions:false,interpretation:'Prospective registration-number and dated features for later training. Older records are not retrofitted. Missing preclose course stays null.'};
}
