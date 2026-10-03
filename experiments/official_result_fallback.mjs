import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
const clean=s=>s.replace(/<[^>]*>/g,'').replace(/&nbsp;/g,' ').trim().normalize('NFKC');
export function parseOfficialResult(html,{date,stadium,race}) {
 const sid=String(Number(stadium)).padStart(2,'0'),n=Number(race);
 const nav=html.match(/<div class="tab3[^]*?<\/ul>/)?.[0];
 const expected=`rno=${n}&jcd=${sid}&hd=${date}`;
 if(!nav||!nav.replaceAll('&amp;','&').includes(`/owpc/pc/race/racelist?${expected}`)||!nav.includes('結果'))throw Error('identity_unconfirmed');
 const tables=[...html.matchAll(/<table\b[^>]*>([^]*?)<\/table>/g)].map(m=>m[1]);
 const finish=tables.find(t=>t.includes('ボートレーサー')&&t.includes('レースタイム'));
 const refunds=tables.find(t=>/<th[^>]*>\s*返還\s*<\/th>/.test(t));
 const payout=tables.find(t=>t.includes('払戻金')&&t.includes('3連単'));
 if(!finish||!refunds||!payout)throw Error('incomplete_tables');
 const boats=[];
 for(const row of finish.matchAll(/<tr\b[^>]*>([^]*?)<\/tr>/g)){
  const cells=[...row[1].matchAll(/<td\b[^>]*>([^]*?)<\/td>/g)].map(m=>m[1]);if(cells.length!==4)continue;
  const rank=clean(cells[0]),lane=Number(clean(cells[1]));
  const registration=Number(cells[2].match(/<span[^>]*>\s*(\d{4})\s*<\/span>/)?.[1]);
  if(!Number.isInteger(lane)||lane<1||lane>6||!registration||!rank)throw Error('invalid_finisher');
  if(!/^[1-6]$/.test(rank)&&!['F','L','K','S0','S1','S2','落','転','沈','妨','失','欠','不','エ'].includes(rank))throw Error('unknown_finish_code');
  boats.push({racer_boat_number:lane,racer_place_number:/^[1-6]$/.test(rank)?Number(rank):null,official_finish_code:rank,racer_number:registration});
 }
 if(boats.length!==6||new Set(boats.map(b=>b.racer_boat_number)).size!==6||new Set(boats.map(b=>b.racer_number)).size!==6)throw Error('incomplete_finishers');
 const refundBody=refunds.match(/<tbody[^>]*>([^]*?)<\/tbody>/)?.[1];
 if(!refundBody||!refundBody.includes('numberSet1'))throw Error('refund_unconfirmed');
 const refundBoats=[...refundBody.matchAll(/numberSet1_number[^>]*>\s*([1-6])\s*<\/span>/g)].map(m=>Number(m[1]));
 // Unexpected nonempty refund contents must not silently become no refunds.
 if(clean(refundBody).replace(/[1-6\s]/g,''))throw Error('unknown_refund_content');
 const trifecta=[];
 const section=[...payout.matchAll(/<tbody[^>]*>([^]*?)<\/tbody>/g)].find(m=>clean(m[1]).includes('3連単'))?.[1];
 if(!section)throw Error('trifecta_unconfirmed');
 for(const row of section.matchAll(/<tr\b[^>]*>([^]*?)<\/tr>/g)){
  const lanes=[...row[1].matchAll(/numberSet1_number[^>]*>\s*([1-6])\s*<\/span>/g)].map(m=>Number(m[1]));
  const amountText=row[1].match(/class="is-payout1"[^>]*>([^]*?)<\/span>/)?.[1];
  if(!lanes.length&&!clean(amountText||''))continue;
  const amount=Number(clean(amountText||'').replace(/&yen;|¥|,/g,''));
  if(lanes.length!==3||new Set(lanes).size!==3||!Number.isInteger(amount)||amount<=0)throw Error('invalid_payout');
  trifecta.push({combination:lanes.join('-'),amount});
 }
 if(!trifecta.length)throw Error('payout_pending');
 const special=refundBoats.length>0||boats.some(b=>b.racer_place_number===null)||trifecta.length>1;
 if(!special){
  const ranks=boats.map(b=>b.racer_place_number);
  const combo=[...boats].sort((a,b)=>a.racer_place_number-b.racer_place_number).slice(0,3).map(b=>b.racer_boat_number).join('-');
  if(new Set(ranks).size!==6||trifecta[0].combination!==combo)throw Error('finish_payout_mismatch');
 }
 return {boats,payouts:{trifecta},refund_boats:refundBoats,official_special:special,source:'verified official individual result'};
}
export async function officialFallback(root,request,published=null){
 const {date,stadium,race}=request,key=`${date}_${Number(stadium)}_${Number(race)}`;
 const dir=path.join(root,'dev/official-result-fallback');fs.mkdirSync(dir,{recursive:true});
 const file=path.join(dir,key+'.json');
 let entry;
 if(fs.existsSync(file))entry=JSON.parse(fs.readFileSync(file));
 else {
  const url=`https://www.boatrace.jp/owpc/pc/race/raceresult?rno=${Number(race)}&jcd=${String(Number(stadium)).padStart(2,'0')}&hd=${date}`;
  const response=await fetch(url,{signal:AbortSignal.timeout(20000),headers:{'User-Agent':'Mozilla/5.0'}});
  if(!response.ok)throw Error(`official_HTTP_${response.status}`);
  const html=await response.text(),result=parseOfficialResult(html,request);
  entry={request,url,fetched_at:new Date().toISOString(),html_sha256:crypto.createHash('sha256').update(html).digest('hex'),result};
  fs.writeFileSync(file,JSON.stringify(entry)+'\n');
 }
 if(published?.combination&&!entry.result.official_special){const p=entry.result.payouts.trifecta[0];if(p.combination!==published.combination||p.amount!==Number(published.amount))throw Error('published_payout_mismatch');}
 return {...entry.result,verification:{url:entry.url,fetched_at:entry.fetched_at,html_sha256:entry.html_sha256}};
}
