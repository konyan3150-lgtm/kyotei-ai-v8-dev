import path from 'node:path';
import fs from 'node:fs';
import {loadHistory,readJson} from './history_store.mjs';

export function verifyHistory(root, baselineFile, save=false) {
  const snapshot=loadHistory(path.join(root,'server-predictions.json'),path.join(root,'server-predictions-archive'),path.join(root,'server-predictions-index.json'));
  if(save) fs.writeFileSync(baselineFile,JSON.stringify({keys:[...snapshot.keys].sort()}));
  else {
    const baseline=readJson(baselineFile);
    if(!Array.isArray(baseline.keys))throw Error('Invalid preservation baseline');
    for(const key of baseline.keys)if(!snapshot.keys.has(key))throw Error(`History would lose record: ${key}`);
  }
  return {records:snapshot.keys.size,archives:snapshot.archives.size};
}
if(import.meta.url===`file://${process.argv[1]}`) {
  if(!process.argv[2]||!process.argv[3])throw Error('Usage: verify_prediction_history.mjs DATA_DIR BASELINE_FILE [--save-baseline]');
  console.log(JSON.stringify(verifyHistory(process.argv[2],process.argv[3],process.argv.includes('--save-baseline'))));
}
