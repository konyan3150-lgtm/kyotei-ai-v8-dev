// Build a lighter racer-aptitude file for today's page load (DEV only).
// The page only reads, per racer: o, c, v[venue] and x[`${venue}:${course}`] for the venue where the
// racer races today (venue = Japanese venue name, as in app2.js N[sid]). Everything else is dropped.
// The script verifies that every value the page can read is byte-identical to the full runtime file,
// so predictions cannot change. Production files are not modified.
import fs from 'node:fs';
import path from 'node:path';
import {gzipSync,gunzipSync} from 'node:zlib';

export const VENUES={1:'桐生',2:'戸田',3:'江戸川',4:'平和島',5:'多摩川',6:'浜名湖',7:'蒲郡',8:'常滑',9:'津',10:'三国',11:'びわこ',12:'住之江',13:'尼崎',14:'鳴門',15:'丸亀',16:'児島',17:'宮島',18:'徳山',19:'下関',20:'若松',21:'芦屋',22:'福岡',23:'唐津',24:'大村'};
const COURSES=['1','2','3','4','5','6'];
const same=(a,b)=>JSON.stringify(a)===JSON.stringify(b);

export function venuesByRacer(program){
  const out=new Map();
  for(const [sid,stadium] of Object.entries(program?.programs?.stadiums||{})){
    const name=VENUES[Number(sid)];if(!name)throw Error(`unknown stadium ${sid}`);
    for(const race of Object.values(stadium?.races||{}))for(const racer of Object.values(race?.racers||{})){
      const id=String(racer?.number||racer?.registration_number||'').trim();
      if(id){if(!out.has(id))out.set(id,new Set());out.get(id).add(name).add(String(Number(sid)));}
    }
  }
  return out;
}

export function trimAptitude(full,venues){
  const racers={};
  for(const [id,keys] of venues){
    const r=full.racers?.[id];if(!r)continue;
    const v={},x={};
    for(const k of keys){if(r.v&&k in r.v)v[k]=r.v[k];for(const c of COURSES){const xk=`${k}:${c}`;if(r.x&&xk in r.x)x[xk]=r.x[xk]}}
    racers[id]={...r,v,x};
  }
  return {...full,racers,lite:{policy:'today-venue-only-v1',racers:Object.keys(racers).length}};
}

// Every lookup the page can make for today's racers must return the same value.
export function verifySame(full,lite,venues){
  let checked=0;
  for(const [id,keys] of venues){
    const a=full.racers?.[id],b=lite.racers?.[id];
    if(!a){if(b)throw Error(`unexpected racer ${id}`);continue}
    if(!same(a.o,b.o)||!same(a.c,b.c))throw Error(`overall/course mismatch ${id}`);
    for(const k of keys){
      if(!same(a.v?.[k],b.v?.[k]))throw Error(`venue mismatch ${id} ${k}`);
      for(const c of COURSES){if(!same(a.x?.[`${k}:${c}`],b.x?.[`${k}:${c}`]))throw Error(`venue-course mismatch ${id} ${k}:${c}`);checked++}
    }
  }
  if(!same(full.global_course,lite.global_course)||full.schema!==lite.schema||!same(full.runtime,lite.runtime))throw Error('header mismatch');
  return checked;
}

async function main(){
  const date=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Tokyo',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date()).replaceAll('-','');
  const get=async(url,binary)=>{const r=await fetch(url,{headers:{'user-agent':'kyotei-ai-v8-dev-runtime-lite/1.0'}});if(!r.ok)throw Error(`HTTP ${r.status} ${url}`);return binary?Buffer.from(await r.arrayBuffer()):r.json()};
  const full=JSON.parse(gunzipSync(await get(`https://raw.githubusercontent.com/konyan3150-lgtm/kyotei-ai-v8-live/main/dev/racer-aptitude-runtime.json.gz?d=${date}&x=${Date.now()}`,true)));
  if(full?.schema!=='kyotei-v8-racer-aptitude')throw Error('schema mismatch');
  if(String(full?.runtime?.date)!==date){console.log(JSON.stringify({skipped:'live runtime not yet updated for today',live_date:full?.runtime?.date,date}));return}
  const program=await get(`https://boatraceopenapi.github.io/api/v1/${date.slice(0,4)}/${date}.json`);
  const venues=venuesByRacer(program);if(venues.size<100)throw Error(`program racer coverage too low: ${venues.size}`);
  const lite=trimAptitude(full,venues),checked=verifySame(full,lite,venues);
  const target=path.resolve('dev/runtime-lite/racer-aptitude-today.json.gz');
  // Avoid a commit per live rebuild: skip when today's file already has the same racer data.
  const body=x=>JSON.stringify({...x,runtime:{...x.runtime,generated_at:null}});
  if(fs.existsSync(target)){try{const prev=JSON.parse(gunzipSync(fs.readFileSync(target)));if(String(prev?.runtime?.date)===date&&body(prev)===body(lite)){console.log(JSON.stringify({skipped:'unchanged',date}));return}}catch(e){}}
  const gz=gzipSync(Buffer.from(JSON.stringify(lite)),{level:9});
  fs.mkdirSync(path.dirname(target),{recursive:true});fs.writeFileSync(target,gz);
  console.log(JSON.stringify({date,racers:Object.keys(lite.racers).length,checked_lookups:checked,full_json_bytes:JSON.stringify(full).length,lite_json_bytes:JSON.stringify(lite).length,lite_gzip_bytes:gz.length}));
}
if(import.meta.url===`file://${process.argv[1]}`)await main();
