import fs from 'node:fs';
import crypto from 'node:crypto';
import readline from 'node:readline';
import {gzipSync} from 'node:zlib';
import {pathToFileURL} from 'node:url';
import {applyDay,validate,day,nextDay,BASE_COMMIT} from './rebuild_aptitude.mjs';
import {historicalOutcome} from './historical_outcome.mjs';
const ENGINE_COMMIT='8286a9783a7799aacade7d0f0de72e8636a681ac';
const FIELDS=['number','age','weight','rank_number','national_win_rate','national_top_2_percent','local_win_rate','local_top_2_percent','motor_top_2_percent','boat_top_2_percent'];
const MISSING=['average_start_timing','flying_count','late_count','motor_top_3_percent','boat_top_3_percent'];
export function safeProgram(input,date){
 const racers={};
 for(const [k,x] of Object.entries(input.racers||{})){
  if(!/^[1-6]$/.test(k)||!Number.isInteger(x.number)||x.number<1000||x.number>9999)throw Error('Invalid program identity');
  racers[k]=Object.fromEntries(FIELDS.map(f=>[f,x[f]]));
 }
 return {date, racers};
}
export function settleable(r){
 // Restrict to six ordinary finishers: no withdrawal, F/L refund or tied finish ambiguity.
 if(r.boats?.length!==6||new Set(r.boats.map(b=>b.racer_place_number)).size!==6||r.boats.some(b=>!Number.isInteger(b.racer_place_number)||b.racer_place_number<1||b.racer_place_number>6))return {eligible:false,reason:'not_six_unique_normal_finishers'};
 return historicalOutcome(r);
}
const empty=()=>({races:0,top1:0,hits:0,stake:0,payout:0});
const pct=(a,b)=>b?100*a/b:null;
const summarize=x=>({...x,top1_rate:pct(x.top1,x.races),six_pick_hit_rate:pct(x.hits,x.races),roi:pct(x.payout,x.stake),profit:x.payout-x.stake});
function record(s,p,yen){s.races++;s.top1+=p.top1;s.hits+=p.hit;s.stake+=600;s.payout+=p.hit?yen:0;}
function paired(){return {baseline:empty(),rolling:empty()};}
function addPair(s,a,b,yen){record(s.baseline,a,yen);record(s.rolling,b,yen);}
function finishPair(s){const a=summarize(s.baseline),b=summarize(s.rolling);return {baseline:a,rolling:b,delta_pp:{top1:b.top1_rate-a.top1_rate,six_pick_hit:b.six_pick_hit_rate-a.six_pick_hit_rate,roi:b.roi-a.roi}};}
export function bootstrap(daily,iterations=2000){
 let seed=20261003;const random=()=>{seed=(Math.imul(1664525,seed)+1013904223)>>>0;return seed/4294967296;};const values={top1:[],six_pick_hit:[],roi:[]};
 for(let i=0;i<iterations;i++){const s=paired();for(let j=0;j<daily.length;j++){const d=daily[Math.floor(random()*daily.length)];for(const arm of ['baseline','rolling'])for(const k of Object.keys(s[arm]))s[arm][k]+=d[arm][k];}const delta=finishPair(s).delta_pp;for(const k of Object.keys(values))values[k].push(delta[k]);}
 return Object.fromEntries(Object.entries(values).map(([k,v])=>{v.sort((a,b)=>a-b);return [k,{low:v[Math.floor(.025*v.length)],high:v[Math.floor(.975*v.length)]}]}));
}
async function main(){
 const dir='/tmp/frozen-aptitude-engine';const {normalizeModel,predictionRows,makeBets}=await import(pathToFileURL(dir+'/scripts/update_server_predictions.mjs'));
 const baseline=JSON.parse(fs.readFileSync('/tmp/official-aptitude-cache/baseline.json'));
 if(day(baseline.through)!=='20250729'||baseline.starts!==1435463)throw Error('Untrusted baseline');validate(baseline);
 const rolling=structuredClone(baseline);rolling.recovery={baseline_commit:BASE_COMMIT,days:[]};
 const payload=JSON.parse(fs.readFileSync(dir+'/v8_model_aptitude.json'));const models=normalizeModel(payload);
 // Official B does not publish these five fields. Use each frozen model's median
 // in BOTH arms, and the same median for the engine's motor factor.
 const missingValues=Object.fromEntries(MISSING.map(f=>{const names={average_start_timing:'ST_AVG',flying_count:'F',late_count:'L',motor_top_3_percent:'MOTORWIN3RATE',boat_top_3_percent:'BOATWIN3RATE'};const i=payload.features.indexOf(names[f]);const medians=models.map(m=>m.num_medians[i-1]);if(medians.some(m=>m!==medians[0]))throw Error('Rank-specific medians require explicit handling');return [f,medians[0]];}));
 const ctx=a=>({models,aptitude:a,course:{},venue:{},technique:{}});
 const total=paired(),daily={},months={},venues={},excluded={},rows=[];let days=0,starts=0,changed=0,officialRaces=0,programRaces=0;
 const skip=r=>excluded[r]=(excluded[r]||0)+1;
 const stream=readline.createInterface({input:fs.createReadStream('/tmp/official-comparison-days.jsonl'),crlfDelay:Infinity});
 for await(const line of stream){
  const d=JSON.parse(line),date=day(d.date);if(nextDay(rolling.through)!==date)throw Error('Future/gapped aptitude history');
  const historyThrough=day(rolling.through),ps=new Map(d.programs.map(p=>[`${p.stadium}:${p.race}`,p]));if(ps.size!==d.programs.length)throw Error('Duplicate race');programRaces+=ps.size;officialRaces+=d.results.length;
  const ds=daily[date]=paired();
  for(const res of d.results){
   const outcome=settleable(res);if(!outcome.eligible){skip(outcome.reason);continue;}
   const input=ps.get(`${res.stadium_number}:${res.number}`);if(!input||Object.keys(input.racers).length!==6){skip('missing_six_boat_program');continue;}
   const race=safeProgram(input,date);for(const b of res.boats)if(race.racers[String(b.racer_boat_number)]?.number!==b.racer_number)throw Error('Program/result ID mismatch');
   for(const x of Object.values(race.racers))Object.assign(x,missingValues);
   const infer=apt=>{const pred=predictionRows(ctx(apt),race,String(res.stadium_number),String(res.number),date);if(pred.length!==6||pred.some(p=>p.p.some(v=>!Number.isFinite(v))))throw Error('Invalid prediction');const picks=makeBets(pred,6,'hit').map(p=>p.combo);if(picks.length!==6||new Set(picks).size!==6)throw Error('Invalid picks');const winner=pred.slice().sort((a,b)=>b.p[0]-a.p[0])[0].k;return {top1:Number(winner===outcome.winner),hit:Number(picks.includes(outcome.combo)),picks};};
   const a=infer(baseline),b=infer(rolling);changed+=Number(JSON.stringify(a.picks)!==JSON.stringify(b.picks));
   addPair(total,a,b,outcome.amount);addPair(ds,a,b,outcome.amount);addPair(months[date.slice(0,6)]??=paired(),a,b,outcome.amount);addPair(venues[String(res.stadium_number)]??=paired(),a,b,outcome.amount);
   rows.push({date,stadium:res.stadium_number,race:res.number,history_through:historyThrough,result:outcome.combo,payout:outcome.amount,baseline:a,rolling:b});
  }
  // Update only AFTER every prediction for the entire day has been evaluated.
  const n=applyDay(rolling,{results:d.results},date);starts+=n.starts;days++;
  if(days%60===0)console.log({days,races:total.baseline.races,history_through:rolling.through});
 }
 validate(rolling);const repaired=JSON.parse(fs.readFileSync('dev/racer-aptitude-official.json'));if(rolling.starts!==repaired.starts||starts!==388014||days!==429)throw Error('Final repaired-history coverage mismatch');
 for(const [id,r] of Object.entries(repaired.racers))for(const group of ['o','c','v','x']){const a=group==='o'?{o:r.o}:r[group],b=group==='o'?{o:rolling.racers[id]?.o}:rolling.racers[id]?.[group];if(!b||Object.keys(a).length!==Object.keys(b).length)throw Error('Final history groups differ');for(const k of Object.keys(a))for(let i=0;i<9;i++)if(Math.abs(a[k][i]-b[k][i])>Math.max(.02,Math.abs(a[k][i])*1e-7))throw Error('Final history differs');}
 if(!total.baseline.races)throw Error('No evaluated races');
 const result={status:'verified',period:{start:'20250730',end:'20261001',days},method:'Fixed model, static 2025-07-29 aptitude versus rolling official aptitude through previous day; six hit-mode picks at 100 yen each.',engine_commit:ENGINE_COMMIT,baseline_commit:BASE_COMMIT,model_version:payload.version,missing_program_fields_imputed:missingValues,coverage:{official_races:officialRaces,program_races:programRaces,evaluated_races:total.baseline.races,excluded,ingested_starts:starts,final_starts:rolling.starts},overall:finishPair(total),date_block_bootstrap_95pct_delta_pp:bootstrap(Object.values(daily).filter(d=>d.baseline.races)),changed_six_picks:changed,months:Object.fromEntries(Object.entries(months).map(([k,v])=>[k,finishPair(v)])),venues:Object.fromEntries(Object.entries(venues).map(([k,v])=>[k,finishPair(v)])),daily:Object.fromEntries(Object.entries(daily).map(([k,v])=>[k,finishPair(v)])),production_changed:false,limitations:['Historical isolated comparison; no prospective profit claim or automatic production promotion.','Five base fields absent from official B use frozen training medians in both arms; preview, actual course, same-day results and current auxiliary corrections are excluded.','Only six unique normal finishers with a matching single trifecta payout are settled; refund/withdrawal/special-result races excluded.','Model and purchase thresholds remain fixed; historical selection may already have informed model development.']};
 const gz=gzipSync(rows.map(r=>JSON.stringify(r)).join('\n')+'\n');fs.writeFileSync('dev/aptitude-history-comparison-pairs.jsonl.gz',gz);result.paired_records_sha256=crypto.createHash('sha256').update(gz).digest('hex');fs.writeFileSync('dev/aptitude-history-comparison.json',JSON.stringify(result,null,2)+'\n');
 const a=result.overall.baseline,b=result.overall.rolling,fmt=v=>v.toFixed(2);const report=`# 公式履歴の時系列比較\n\n2025-07-30〜2026-10-01、${days}日、${a.races.toLocaleString()}レース。モデルと6点×100円を固定し、2025-07-29で履歴を固定した条件と、前日までの公式履歴を毎日追加した条件を比較。\n\n| 指標 | 固定履歴 | 前日までの更新履歴 | 差 |\n|---|---:|---:|---:|\n| 1着艇の的中率 | ${fmt(a.top1_rate)}% | ${fmt(b.top1_rate)}% | ${fmt(b.top1_rate-a.top1_rate)}pt |\n| 6点の的中率 | ${fmt(a.six_pick_hit_rate)}% | ${fmt(b.six_pick_hit_rate)}% | ${fmt(b.six_pick_hit_rate-a.six_pick_hit_rate)}pt |\n| 回収率 | ${fmt(a.roi)}% | ${fmt(b.roi)}% | ${fmt(b.roi-a.roi)}pt |\n\n公式番組表にない平均ST・F/L回数・モーター/ボート3連対率は、両条件とも固定モデルの学習中央値を使用。展示、実際の進入コース、当日の結果、現在の補正データは予測入力に使用していない。したがって本番の完全な再現ではなく、履歴更新の効果を分離した過去比較。特殊成績や返還があり得るレースは除外。\n\n日単位のペア・ブートストラップ95%区間、月別・場別・日別の結果と除外件数は [JSON](../dev/aptitude-history-comparison.json)、全レースの買い目は圧縮JSONLに保存。補完した388,014走を日末に全件取り込み、最終集計が検証済み公式スナップショットと一致することを確認。\n\n本番は未変更。回収率100%未満なら、この条件では利益が出ていない。過去比較だけで将来の利益や本番採用を確定しない。\n`;fs.writeFileSync('experiments/HISTORY_COMPARISON_REPORT.md',report);console.log(JSON.stringify({overall:result.overall,coverage:result.coverage,intervals:result.date_block_bootstrap_95pct_delta_pp}));
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href)await main();
