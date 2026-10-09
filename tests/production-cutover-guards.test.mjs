import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';

const sync=fs.readFileSync('overrides/server-sync.js','utf8');
const workflow=fs.readFileSync('.github/workflows/main.yml','utf8');
const required=['dev/server-predictions.json','dev/server-predictions-index.json','dev/server-predictions-archive/202609.json','dev/server-predictions-archive/202610.json'];
test('production prediction endpoint stays pinned until explicit data migration',()=>{
  assert.match(sync,/raw\.githubusercontent\.com\/konyan3150-lgtm\/kyotei-ai-v8-live\/main\//);
  assert.match(sync,/kyotei_v8_dev_result_/);
  assert.match(sync,/server-predictions\.json/);
  assert.match(sync,/server-predictions-index\.json/);
});
test('development Pages build does not write production repository',()=>{
  assert.match(workflow,/name: Deploy V8 Dev Pages/);
  assert.match(workflow,/contents: read/);
  assert.match(workflow,/kyotei-ai-v8-live\/archive\/refs\/heads\/dev-prob-calibration\.zip/);
  assert.doesNotMatch(workflow,/git push|contents: write/);
});
test('migration manifest explicitly lists historical prediction datasets',()=>{
  const manifest=fs.readFileSync('docs/production-cutover-checklist-20261009.md','utf8');
  for(const file of required)assert.ok(manifest.includes(file),file);
  assert.match(manifest,/NO LIVE CUTOVER/);
});
