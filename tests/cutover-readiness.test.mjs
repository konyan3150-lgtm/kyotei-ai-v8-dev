import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
const checklist=fs.readFileSync('docs/production-cutover-checklist-20261009.md','utf8');
const workflow=fs.readFileSync('.github/workflows/migration-safety.yml','utf8');
const sync=fs.readFileSync('overrides/server-sync.js','utf8');
test('staging does not deploy or overwrite production',()=>{
  assert.match(checklist,/STAGING ONLY/);
  assert.match(workflow,/permissions:\s*\n\s*contents: read/);
  assert.doesNotMatch(workflow,/actions\/deploy-pages|peaceiris\/actions-gh-pages|git push|gh api .*PATCH/);
});
test('live saved prediction endpoint remains explicitly protected',()=>{
  assert.match(sync,/kyotei-ai-v8-live\/main\//);
  assert.match(sync,/dev\/server-predictions\.json/);
  assert.match(checklist,/Do not remove or rename this endpoint/);
});
test('cutover plan includes localStorage and rollback protection',()=>{
  assert.match(checklist,/localStorage/);
  assert.match(checklist,/backup\/pre-dev-migration-20261009/);
  assert.match(checklist,/post-cutover totals/);
});
