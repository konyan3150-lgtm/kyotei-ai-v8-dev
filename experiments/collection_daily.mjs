// Read-only diagnostics: never create or revise a prediction.
const close = value => Date.parse(String(value || '').replace(' ', 'T') + '+09:00');
export function collectionDaily(records, {now = Date.now(), program, date, cancelled = {}} = {}) {
  const days = {};
  const group = d => days[d] ||= {saved:0,preclose_saved:0,settled:0,pending:0,overdue:0,cancelled:0,excluded:0,invalid_time:0,closed_program_races:null,recorded_closed_races:null,unrecorded_closed_races:null,unrecorded:[]};
  for (const r of Object.values(records || {})) {
    if (!/^\d{8}$/.test(String(r?.date))) continue;
    const g = group(r.date), deadline = close(r.closed_at), saved = Date.parse(r.saved_at);
    g.saved++;
    if (Number.isFinite(deadline) && Number.isFinite(saved) && saved < deadline) g.preclose_saved++;
    else g.invalid_time++;
    if (r.cancelled) g.cancelled++;
    else if (r.excluded) g.excluded++;
    else if (r.outcome) g.settled++;
    else {g.pending++; if (Number.isFinite(deadline) && now - deadline > 30*60000) g.overdue++;}
  }
  if (program?.programs?.stadiums && /^\d{8}$/.test(String(date))) {
    const g = group(date);g.closed_program_races=0;g.recorded_closed_races=0;
    for (const [stadium,v] of Object.entries(program.programs.stadiums)) for (const [race,r] of Object.entries(v.races || {})) {
      if (String(r.date || '').replaceAll('-','') !== date || !Number.isFinite(close(r.closed_at)) || close(r.closed_at) > now || r.cancelled === true || cancelled?.[Number(stadium)]?.[Number(race)]?.cancelled === true) continue;
      const key = `${date}_${Number(stadium)}_${Number(race)}`;
      g.closed_program_races++;
      const saved=records?.[key];
      if (saved && Number.isFinite(Date.parse(saved.saved_at)) && Date.parse(saved.saved_at) < close(saved.closed_at)) g.recorded_closed_races++;
      else g.unrecorded.push({stadium:Number(stadium),race:Number(race)});
    }
    g.unrecorded_closed_races=g.unrecorded.length;
  }
  return {checked_at:new Date(now).toISOString(),days,limitation:'Unrecorded closed races are coverage gaps, not proof of collector failure. Historical program denominators are unknown. Cancelled and excluded records are separate. No predictions reconstructed.'};
}
