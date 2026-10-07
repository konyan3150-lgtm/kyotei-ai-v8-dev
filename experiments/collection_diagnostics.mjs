const closeMs=r=>Date.parse(String(r.closed_at||'').replace(' ','T')+'+09:00');
export function stReason(values){
  if(values.some(v=>v!=null&&v!==''&&Number.isFinite(Number(v))&&Number(v)<0))return 'negative_st';
  if(values.some(v=>v!=null&&v!==''&&Number.isFinite(Number(v))&&Number(v)>2))return 'out_of_range';
  if(values.length!==6||values.some(v=>v==null||v===''||!Number.isFinite(Number(v))))return 'missing_or_unparseable';
  return 'eligible';
}
export function stDiagnostics(records){
  const counts={eligible:0,negative_st:0,out_of_range:0,missing_or_unparseable:0},days={};let invalid=0,withoutVariants=0;
  for(const r of Object.values(records||{})){
    if(!r.variants?.st){withoutVariants++;continue;}
    if(r.variants.captured_at!==r.saved_at||!Number.isFinite(Date.parse(r.saved_at))||!(Date.parse(r.saved_at)<closeMs(r))){invalid++;continue;}
    const reason=stReason(r.variants.st.values||[]);counts[reason]++;
    const d=days[r.date]??={eligible:0,negative_st:0,out_of_range:0,missing_or_unparseable:0};d[reason]++;
  }
  return {counts,days,invalid,without_variants:withoutVariants,limitation:'Negative ST is excluded by the existing comparison policy. Missing historical values do not establish whether data was unpublished or fetching failed. Predictions and policies are unchanged.'};
}
export function previewObservation(race,record,{now,date,fileDate}={}){
  const at=Date.parse(record?.fetched_at),close=closeMs(race),time=Date.parse(now);
  const source=String(fileDate)!==String(date)?'wrong_date':!record?'no_record':!Number.isFinite(at)?'invalid_time':at>time?'future_time':at>=close?'postclose':time>=close?'race_closed':'preclose_record';
  const values=Array.from({length:6},(_,i)=>race.preview?.racers?.[String(i+1)]?.start_timing);
  return {checked_at:now,closed_at:race.closed_at,api_st_reason:stReason(values),official_st_reason:stReason(Array.from({length:6},(_,i)=>record?.racers?.[String(i+1)]?.start_timing)),official_preview_status:source,official_preview_at:record?.fetched_at||null};
}
export function observeCapture(store,key,observation,state){
  const prior=store[key];store[key]={...observation,first_checked_at:prior?.first_checked_at||observation.checked_at,attempts:(prior?.attempts||0)+1,state,ever_captured:state==='captured'||!!prior?.ever_captured};
}
export function gapDiagnostics(daily,observations){
  const reasons={not_observed_unknown:0,invalid_model_rows:0,snapshot_rejected:0,revision_rejected:0,observed_without_capture:0},races=[];
  for(const [date,d] of Object.entries(daily?.days||{}))for(const gap of d.unrecorded||[]){
    const key=`${date}_${gap.stadium}_${gap.race}`,o=observations?.[key];
    const reason=!o?'not_observed_unknown':Object.hasOwn(reasons,o.state)?o.state:'observed_without_capture';
    reasons[reason]++;races.push({key,reason,last_observed_at:o?.checked_at||null});
  }
  return {reasons,races,limitation:'Only observed attempts establish a failure reason. No observation cannot distinguish collection start time, missed scheduling, or unavailable input. Historical predictions are never reconstructed.'};
}
