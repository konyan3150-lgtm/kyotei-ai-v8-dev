const closeMs=r=>Date.parse(String(r.closed_at).replace(' ','T')+'+09:00');
export function parseCsv(text){
  const rows=[];let row=[],cell='',quoted=false;
  for(let i=0;i<text.length;i++){
    const c=text[i];if(quoted){if(c==='"'&&text[i+1]==='"'){cell+='"';i++}else if(c==='"')quoted=false;else cell+=c}
    else if(c==='"')quoted=true;else if(c===','){row.push(cell);cell=''}else if(c==='\n'){row.push(cell.replace(/\r$/,''));rows.push(row);row=[];cell=''}else cell+=c;
  }
  if(quoted)throw Error('Incomplete quoted CSV');
  if(cell||row.length){row.push(cell.replace(/\r$/,''));rows.push(row)}return rows;
}
export function applyOriginal(program,text,date,capturedAt){
  const at=Date.parse(capturedAt),rows=parseCsv(text),head=rows.shift()||[],index=Object.fromEntries(head.map((h,i)=>[h.replace(/^\ufeff/,''),i]));
  if(!Number.isFinite(at)||index['レースコード']==null)return {races:0,values:0,status:'missing_schema'};
  let races=0,values=0;
  for(const row of rows){
    const code=String(row[index['レースコード']]||'').trim();if(!/^\d{12}$/.test(code)||!code.startsWith(date))continue;
    const race=program?.programs?.stadiums?.[String(Number(code.slice(8,10)))]?.races?.[String(Number(code.slice(10,12)))];
    if(!race||!Number.isFinite(closeMs(race))||at>=closeMs(race)||String(race.date||'').replaceAll('-','')!==date)continue;
    let changed=0;
    for(let metric=1;metric<=3;metric++){
      const label=String(row[index[`計測項目${metric}`]]||'').replace(/\s/g,''),field=/一周|1周|半周|ラップ/.test(label)?'lap_time':/まわり|回り|ターン/.test(label)?'turn_time':/直線/.test(label)?'straight_time':null;
      if(!field)continue;
      for(let lane=1;lane<=6;lane++){
        const raw=row[index[`艇${lane}_値${metric}`]],value=Number(raw);if(raw==null||raw.trim()===''||!Number.isFinite(value)||value<=0)continue;
        race.preview??={};race.preview.racers??={};const target=race.preview.racers[String(lane)]??={};target[field]=value;changed++;
      }
    }
    if(changed){race.original_exhibition_captured_at=capturedAt;races++;values+=changed}
  }
  return {races,values,status:values?'captured_preclose':'no_preclose_values'};
}
export function health(records,{now=new Date(),eligibleKeys=[],originalStatus='unknown',programStatus='unknown'}={}){
  const overdue=[];
  for(const [key,r] of Object.entries(records)){
    if(r.outcome||r.cancelled)continue;
    const delay=(now.getTime()-closeMs(r))/60000;
    if(Number.isFinite(delay)&&delay>=30)overdue.push({key,minutes_since_close:Math.floor(delay),level:delay>=120?'high':'watch'});
  }
  const missing=eligibleKeys.filter(k=>!records[k]);
  return {checked_at:now.toISOString(),eligible_preclose_races:eligibleKeys.length,captured_preclose_races:eligibleKeys.length-missing.length,
    missing_preclose_records:missing,overdue_results:overdue,original_exhibition_status:originalStatus,program_status:programStatus,
    status:missing.length||overdue.length||programStatus==='fetch_error'||originalStatus==='fetch_or_parse_error'||/^HTTP_5/.test(originalStatus)?'needs_attention':'ok',
    limitation:'A report is refreshed only when the workflow runs; this alone cannot detect a completely stopped scheduler. No external notifications are sent.'};
}
