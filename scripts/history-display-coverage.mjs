import fs from 'node:fs';
const root=process.argv[2];
if(!root)throw Error('Usage: node scripts/history-display-coverage.mjs SNAPSHOT_DIR');
const read=p=>JSON.parse(fs.readFileSync(root+'/'+p,'utf8'));
const index=read('server-predictions-index.json');
const sources=[read('server-predictions.json'),...index.archives.map(a=>read(a.file))];
const records=new Map();
for(const source of sources)for(const [key,r] of Object.entries(source.records||{}))if(!records.has(key))records.set(key,r);
const report={records:records.size,groups:{}};
for(const [view,group] of [['base','modes'],['value','value_modes']]){
  report.groups[view]={};
  for(const mode of ['hit','balance','return']){
    const data={stored:0,eligible:0,stake:0,payout:0,version_excluded:0,unsettled:0,skipped:0,cancelled:0,zero_stake:0};
    for(const rec of records.values()){
      const m=rec[group]?.[mode];if(!m)continue;
      data.stored++;
      if(view==='value'&&Number(rec.value_model_version)<3){data.version_excluded++;continue}
      if(rec.cancelled||m.cancelled){data.cancelled++;continue}
      if(!m.settled){data.unsettled++;continue}
      if(m.skipped){data.skipped++;continue}
      if(!(Number(m.stake)>0)){data.zero_stake++;continue}
      data.eligible++;data.stake+=Number(m.stake);data.payout+=Number(m.payout||0);
    }
    report.groups[view][mode]=data;
  }
}
console.log(JSON.stringify(report,null,2));
