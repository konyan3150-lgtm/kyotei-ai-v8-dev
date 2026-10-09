import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
const source=fs.readFileSync('overrides/odds-value.js','utf8');
test('V8 saved bets take precedence after close or server sync',()=>{
  const start=source.indexOf('function renderBaseBetsPanel(rows){');
  const end=source.indexOf('  const baseRenderBets=renderBets;',start);
  assert.ok(start>=0&&end>start);
  const body=source.slice(start,end);
  assert.match(body,/const savedMode=stored\?\.modes\?\.\[basePredictionMode\]/);
  assert.match(body,/if\(\(closed\|\|authoritative\)&&savedMode\)/);
  assert.ok(body.indexOf('if((closed||authoritative)&&savedMode)')<body.indexOf('const picks=makeBets(rows,6,basePredictionMode)'));
  assert.match(body,/if\(closed\|\|authoritative\).*return/);
  assert.ok(body.indexOf('if((closed||authoritative)&&savedMode)')<body.indexOf("if(typeof models==='undefined'||models.length!==3)"),'saved tickets must render even when models are loading');
});
test('value bets still prefer saved server records and saved snapshots',()=>{
  assert.match(source,/renderSavedValueBets\(savedValueMode\(\),false\)/);
  assert.match(source,/if\(closed\)\{const saved=savedValueMode\(\)/);
});
