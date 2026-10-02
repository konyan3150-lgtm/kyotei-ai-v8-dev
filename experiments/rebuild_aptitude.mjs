import fs from 'node:fs';
import {pathToFileURL} from 'node:url';
import path from 'node:path';

export const BASE_COMMIT='f9934034bfcb651b226a160e01bbd813ca7b1e0d';
const VENUES=['桐生','戸田','江戸川','平和島','多摩川','浜名湖','蒲郡','常滑','津','三国','びわこ','住之江','尼崎','鳴門','丸亀','児島','宮島','徳山','下関','若松','芦屋','福岡','唐津','大村'];
const blank=()=>Array(9).fill(0);
export function day(value){
  const s=String(value??'').replaceAll('-','');
  if(!/^\d{8}$/.test(s))throw Error('Invalid date: '+value);
  const d=new Date(`${s.slice(0,4)}-${s.slice(4,6)}-${s.slice(6,8)}T00:00:00Z`);
  if(!Number.isFinite(+d)||d.toISOString().slice(0,10).replaceAll('-','')!==s)throw Error('Invalid calendar date: '+value);
  return s;
}
export function nextDay(value){const s=day(value),d=new Date(`${s.slice(0,4)}-${s.slice(4,6)}-${s.slice(6,8)}T00:00:00Z`);d.setUTCDate(d.getUTCDate()+1);return day(d.toISOString().slice(0,10));}
const numeric=v=>v===null||v===undefined||String(v).trim()===''?null:Number.isFinite(Number(v))?Number(v):null;
function add(a,place,st){a[0]++;if(place>=1&&place<=6){a[1]++;a[2]+=place===1?1:0;a[3]+=place<=2?1:0;a[4]+=place<=3?1:0;a[5]+=place;}if(st!==null){a[6]++;a[7]+=st;a[8]+=st*st;}}
export function validate(data){
  let total=0;const courses={};
  for(const [id,r] of Object.entries(data.racers||{})){
    if(!/^\d{4}$/.test(id))throw Error('Invalid racer ID '+id);
    for(const a of [r.o,...Object.values(r.c||{}),...Object.values(r.v||{}),...Object.values(r.x||{})]){
      if(!Array.isArray(a)||a.length!==9||a.some(v=>!Number.isFinite(v))||a.slice(0,7).some(v=>v<0)||a[1]>a[0]||a[2]>a[3]||a[3]>a[4]||a[4]>a[1]||a[6]>a[0])throw Error('Invalid statistics '+id);
    }
    for(const [group,keys] of [['c',Object.keys(r.c||{})],['v',Object.keys(r.v||{})],['x',Object.keys(r.x||{})]]){
      if(keys.some(k=>group==='c'?!/^[1-6]$/.test(k):group==='v'?!VENUES.includes(k):!VENUES.some(v=>new RegExp('^'+v+':[1-6]$').test(k))))throw Error('Noncanonical '+group+' key '+id);
      for(let i=0;i<9;i++){const sum=Object.values(r[group]||{}).reduce((s,a)=>s+a[i],0);if(Math.abs(sum-r.o[i])>Math.max(.02,Math.abs(r.o[i])*1e-7))throw Error('Group count mismatch '+id+' '+group+' '+i);}
    }
    total+=r.o[0];
    for(const [c,a] of Object.entries(r.c||{})){const sum=courses[c]??=blank();for(let i=0;i<9;i++)sum[i]+=a[i];}
  }
  const courseTotal=Object.values(data.global_course||{}).reduce((s,a)=>s+a[0],0);
  for(const c of new Set([...Object.keys(courses),...Object.keys(data.global_course||{})]))for(let i=0;i<9;i++){
    const actual=data.global_course[c]?.[i],expected=courses[c]?.[i];
    if(!Number.isFinite(actual)||!Number.isFinite(expected)||Math.abs(actual-expected)>Math.max(.02,Math.abs(expected)*1e-7))throw Error('Global course aggregate mismatch '+c+' '+i);
  }
  if(total!==data.starts||total!==courseTotal||data.racers_count!==Object.keys(data.racers||{}).length)throw Error('Metadata / aggregate count mismatch');
  return {starts:total,racers:data.racers_count,through:day(data.through)};
}
export function applyDay(data,payload,date){
  date=day(date);const expected=nextDay(data.through);
  if(date!==expected)throw Error(`Noncontiguous or duplicate day: ${date}, expected ${expected}`);
  if(!Array.isArray(payload?.results)||payload.results.length===0)throw Error('No verified results for '+date);
  const seen=new Set();let rows=0;
  for(const race of payload.results){
    const sid=numeric(race.stadium_number),rn=numeric(race.number),venue=VENUES[sid-1];
    if(!venue||!Number.isInteger(rn)||rn<1||rn>12)throw Error('Malformed race '+date);
    if(day(race.date)!==date)throw Error('Wrong source date');
    const key=`${sid}:${rn}`;if(seen.has(key))throw Error('Duplicate race '+key);seen.add(key);
    if(!Array.isArray(race.boats)||race.boats.length>6)throw Error('Invalid boats '+key);
    const ids=new Set(),courses=new Set();
    for(const b of race.boats){
      const id=numeric(b.racer_number),c=numeric(b.racer_course_number),place=numeric(b.racer_place_number),st=numeric(b.racer_start_timing);
      // Non-starting boats lack an actual course; exclude them rather than invent a course.
      if(c===null||c===0)continue;
      if(!Number.isInteger(id)||id<1000||id>9999||!Number.isInteger(c)||c<1||c>6||ids.has(id)||courses.has(c))throw Error('Invalid racer/course '+key);
      // The source uses integers above six for nonstandard finishes (e.g. 14).
      // Preserve the start/ST, but only ranks 1..6 contribute to finish statistics.
      if(place!==null&&(!Number.isInteger(place)||place<0))throw Error('Invalid finish '+key);
      if(st!==null&&Math.abs(st)>2)throw Error('Invalid start timing '+key);
      ids.add(id);courses.add(c);
      const r=data.racers[id]??={o:blank(),c:{},v:{},x:{}};
      for(const a of [r.o,r.c[c]??=blank(),r.v[venue]??=blank(),r.x[`${venue}:${c}`]??=blank(),data.global_course[c]??=blank()])add(a,place,st);
      rows++;
    }
  }
  data.starts+=rows;data.racers_count=Object.keys(data.racers).length;
  data.through=`${date.slice(0,4)}-${date.slice(4,6)}-${date.slice(6,8)}`;data.history_end=date;
  data.recovery.days.push({date,races:seen.size,starts:rows});
  return {date,races:seen.size,starts:rows};
}
export async function fetchJson(url){
  let last;
  for(let i=0;i<3;i++)try{const r=await fetch(url,{signal:AbortSignal.timeout(30000)});if(!r.ok)throw Error(`${url}: HTTP ${r.status}`);return await r.json();}catch(e){last=e;}
  throw last;
}
async function main(){
  const output=process.argv[2]||'dev/racer-aptitude-clean.json';
  const end=day(process.argv[3]||new Date(Date.now()+9*3600000-86400000).toISOString().slice(0,10));
  let data;
  if(fs.existsSync(output)){data=JSON.parse(fs.readFileSync(output));if(data.recovery?.baseline_commit!==BASE_COMMIT)throw Error('Untrusted recovery origin');}
  else{data=await fetchJson(`https://raw.githubusercontent.com/konyan3150-lgtm/kyotei-ai-v8-live/${BASE_COMMIT}/racer-aptitude.json`);data.recovery={baseline_commit:BASE_COMMIT,baseline_starts:data.starts,baseline_through:data.through,days:[],source:'BoatraceOpenAPI results v3',production_promoted:false};}
  validate(data);
  const dates=[];for(let d=nextDay(data.through);d<=end;d=nextDay(d))dates.push(d);
  // Fetch four independent dates at a time; apply only contiguous verified days.
  for(let i=0;i<dates.length;i+=4){
    const batch=dates.slice(i,i+4);const payloads=await Promise.all(batch.map(d=>fetchJson(`https://boatraceopenapi.github.io/results/v3/${d.slice(0,4)}/${d}.json`)));
    for(let j=0;j<batch.length;j++)applyDay(data,payloads[j],batch[j]);
    if(i%40===0)console.log(JSON.stringify({processed:Math.min(i+4,dates.length),total:dates.length,through:data.through,starts:data.starts}));
  }
  const valid=validate(data),ledger=data.recovery.days;
  let expected=nextDay(data.recovery.baseline_through),added=0;
  for(const row of ledger){if(row.date!==expected)throw Error('Recovery ledger gap');added+=row.starts;expected=nextDay(row.date);}
  if(data.starts!==data.recovery.baseline_starts+added||nextDay(data.through)!==expected)throw Error('Recovery ledger count/date mismatch');
  data.updated_at=new Date().toISOString();data.recovery.verified_through=data.through;
  fs.mkdirSync(path.dirname(output),{recursive:true});
  fs.writeFileSync(output+'.tmp',JSON.stringify(data));fs.renameSync(output+'.tmp',output);
  const audit={status:'verified',...valid,baseline_commit:BASE_COMMIT,baseline_starts:data.recovery.baseline_starts,recovered_days:ledger.length,recovered_starts:added,recovered_races:ledger.reduce((s,r)=>s+r.races,0),missing_source_days:0,duplicate_days:0,updated_at:data.updated_at,production_promoted:false,limitation:'Verifies contiguous source dates and internal counts. OpenAPI completeness against official daily B/K archives is not yet audited.'};
  fs.writeFileSync(output.replace(/\.json$/, '-audit.json'),JSON.stringify(audit,null,2)+'\n');console.log(audit);
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href)await main();
