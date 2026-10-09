import fs from 'node:fs';
import path from 'node:path';
const root=process.argv[2];
if(!root)throw Error('Usage: node scripts/check-current-live-index.mjs <directory>');
const index=JSON.parse(fs.readFileSync(path.join(root,'server-predictions-index.json'),'utf8'));
const hot=JSON.parse(fs.readFileSync(path.join(root,'server-predictions.json'),'utf8'));
if(index.schema!=='kyotei-v8-server-predictions-index'||index.version!==1)throw Error('Current live index schema mismatch');
if(!hot.records||typeof hot.records!=='object')throw Error('Current live hot records missing');
const records=new Map();
for(const item of index.archives||[]){
  if(!/^server-predictions-archive\/[0-9]{6}\.json$/.test(item.file))throw Error('Unsafe archive path: '+item.file);
  const archive=JSON.parse(fs.readFileSync(path.join(root,item.file),'utf8'));
  if(archive.schema!=='kyotei-v8-server-predictions-archive'||archive.version!==1||!archive.records)throw Error('Invalid archive: '+item.file);
  if(Object.keys(archive.records).length!==Number(item.record_count))throw Error('Archive count mismatch: '+item.file);
  for(const [key,record] of Object.entries(archive.records))records.set(key,record);
}
for(const [key,record] of Object.entries(hot.records))records.set(key,record);
const indexed=Number(index.total_record_count);
if(!Number.isInteger(indexed)||indexed<0)throw Error('Invalid live index count');
if(records.size!==indexed)throw Error('Current live record count mismatch: indexed='+indexed+' actual='+records.size);
console.log(JSON.stringify({status:'ok',live_indexed_records:indexed,live_unique_records:records.size,archive_files:(index.archives||[]).length,hot_records:Object.keys(hot.records).length,updated_at:hot.updated_at||null}));
