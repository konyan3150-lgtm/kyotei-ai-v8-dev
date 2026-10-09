import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
const input=process.argv[2];
if(!input)throw new Error('usage: node scripts/audit-production-history.mjs <directory-containing-live-dev-data>');
const read=(name)=>JSON.parse(fs.readFileSync(input+'/'+name,'utf8'));
const index=read('server-predictions-index.json');
const current=read('server-predictions.json');
const archives=(index.archives||[]).map(entry=>({entry,data:read(entry.file)}));
const errors=[];
const fail=(msg)=>errors.push(msg);
const numeric=(n)=>Number.isFinite(Number(n))&&Number(n)>=0;
const modes=['hit','balance','return'];
function validate(key,r,source){
 if(!r||typeof r!=='object')return fail(source+': invalid record '+key);
 for(const group of ['modes','value_modes']){
  for(const mode of modes){
   const m=r[group]?.[mode];if(!m)continue;
   for(const field of ['stake','payout'])if(m[field]!==undefined&&!numeric(m[field]))fail(source+': invalid '+group+'.'+mode+'.'+field+' '+key);
  }
 }
}
test('production archive index schema and counts',()=>{
 assert.equal(index.schema,'kyotei-v8-server-predictions-index');
 assert.equal(index.version,1);
 assert.equal(current.schema,'kyotei-v8-server-predictions');
 assert.equal(current.version,1);
 let archiveCount=0;
 for(const {entry,data} of archives){
  assert.equal(data.schema,'kyotei-v8-server-predictions-archive',entry.file);
  assert.equal(data.version,1,entry.file);
  assert.ok(data.records&&typeof data.records==='object',entry.file);
  const count=Object.keys(data.records).length;
  assert.equal(count,Number(entry.record_count),entry.file+' count mismatch');
  archiveCount+=count;
 }
 assert.ok(Number(index.total_record_count)>=archiveCount,'index total must cover archives');
});
test('historical records retain valid money and mode structure',()=>{
 for(const [key,r] of Object.entries(current.records||{}))validate(key,r,'current');
 for(const {entry,data} of archives)for(const [key,r] of Object.entries(data.records))validate(key,r,entry.file);
 assert.deepEqual(errors.slice(0,20),[],errors.length+' invalid record(s)');
});
test('duplicate keys across archives are not silently divergent',()=>{
 const seen=new Map();
 for(const {entry,data} of archives)for(const [key,r] of Object.entries(data.records)){
  const signature=JSON.stringify(r);
  if(seen.has(key))assert.equal(signature,seen.get(key).signature,'conflicting archive record '+key+' in '+entry.file);
  else seen.set(key,{signature,source:entry.file});
 }
});
