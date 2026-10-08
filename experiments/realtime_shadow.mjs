const closeMs=r=>Date.parse(String(r.closed_at).replace(' ','T')+'+09:00');
const equal=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
const number=v=>v==null||v===''||!Number.isFinite(Number(v))?null:Number(v);

export function observedInputs(race){
  const preview=race.preview||{};
  return {water:Object.fromEntries(['wind_speed','wind_direction','wave_height','air_temperature','water_temperature'].map(k=>[k,number(preview[k])])),
    exhibition:Object.fromEntries(Object.entries(preview.racers||{}).sort(([a],[b])=>Number(a)-Number(b)).map(([lane,r])=>[lane,
      Object.fromEntries(['exhibition_time','start_timing','lap_time','turn_time','straight_time','course_number','tilt_adjustment'].map(k=>[k,number(r[k])]))]))};
}
export function applyPreclosePreview(race,record,now=new Date()){
  const fetched=Date.parse(record?.fetched_at),close=closeMs(race);
  if(!Number.isFinite(fetched)||!Number.isFinite(close)||fetched>now.getTime()||fetched>=close||now.getTime()>=close)return false;
  race.preview??={};race.preview.racers??={};
  for(const [lane,values] of Object.entries(record.racers||{})){
    const target=race.preview.racers[lane]??={};
    for(const field of ['course_number','start_timing','exhibition_time','tilt_adjustment'])if((target[field]==null||target[field]==='')&&number(values[field])!=null)target[field]=number(values[field]);
  }
  return true;
}
export function preserveRevision(previous,next){
  if(!next)return previous;
  if(previous?.outcome||previous?.cancelled)return previous;
  const saved=Date.parse(next.saved_at),close=closeMs(next);
  if(!Number.isFinite(saved)||!Number.isFinite(close)||saved>=close)throw Error('Revision must be captured before close');
  if(previous){
    const differences=Object.fromEntries(['date','stadium','race','closed_at'].filter(k=>String(previous[k])!==String(next[k])).map(k=>[k,{previous:previous[k],next:next[k]}]));
    const identityChanged=['date','stadium','race'].some(k=>k in differences);
    const previousClose=closeMs(previous);
    // A revised deadline cannot reopen a race whose earlier deadline has passed.
    if(identityChanged||(differences.closed_at&&(!Number.isFinite(previousClose)||saved>=previousClose))){
      const error=Error('Revision identity mismatch: '+JSON.stringify(differences));
      error.code='REVISION_IDENTITY_MISMATCH';error.differences=differences;
      throw error;
    }
    if(saved<=Date.parse(previous.saved_at))throw Error('Revision time must increase');
  }
  const reasons=[];
  if(!previous)reasons.push('first_capture');
  else {
    if(previous.closed_at!==next.closed_at)reasons.push('close_time_changed');
    if(!equal(previous.rank_probabilities,next.rank_probabilities))reasons.push('model_scores_changed');
    if(!equal(previous.expert,next.expert))reasons.push('expert_changed');
    if(previous.odds_snapshot_at!==next.odds_snapshot_at||!equal(previous.baseline_distribution.map(x=>[x.combo,x.odds]),next.baseline_distribution.map(x=>[x.combo,x.odds])))reasons.push('odds_changed');
    if(!equal(previous.input_state?.water,next.input_state?.water))reasons.push('water_changed');
    if(!equal(previous.input_state?.exhibition,next.input_state?.exhibition))reasons.push('exhibition_changed');
    const learning=x=>x?{...x,captured_at:null}:null;
    if(!equal(learning(previous.learning_inputs),learning(next.learning_inputs)))reasons.push('learning_inputs_changed');
    if(!equal(previous.value_arms,next.value_arms))reasons.push('ev_decision_changed');
  }
  if(previous&&!reasons.length)return previous;
  const prior=previous?{...previous}:null;
  if(prior){delete prior.revisions;delete prior.outcome;delete prior.cancelled}
  return {...next,revision_number:(previous?.revision_number||0)+1,change_reasons:reasons,
    revisions:[...(previous?.revisions||[]),...(prior?[prior]:[])]};
}
export function markCancelled(record,source){
  if(!record||record.outcome||record.cancelled||source?.cancelled!==true)return false;
  record.cancelled={confirmed_at:new Date().toISOString(),source:source.source||'official cancellation',investment:0,payout:0};
  return true;
}
export function realtimeSummary(records){
  const all=Object.values(records),reasons={};
  for(const r of all)for(const rev of [...(r.revisions||[]),r])for(const reason of rev.change_reasons||[])reasons[reason]=(reasons[reason]||0)+1;
  return {races_with_revisions:all.filter(r=>(r.revisions?.length||0)>0).length,
    preserved_previous_snapshots:all.reduce((n,r)=>n+(r.revisions?.length||0),0),change_reasons:reasons,
    interpretation:'Only observed pre-close changes are stored. Final paired scoring uses the last valid snapshot; cancelled races are excluded.'};
}
