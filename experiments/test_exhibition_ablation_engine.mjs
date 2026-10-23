// Verifies the ② removal itself against the frozen engine (live 8286a978): for synthetic races,
//   normalized( p_with_exhibition / ef )  ==  engine recomputed with the five exhibition measurements removed,
// with course entry, tilt and wind kept in both. Needs ENGINE_ROOT with scripts/update_server_predictions.mjs,
// scripts/racer_aptitude_features.mjs and v8_model_aptitude.json from that commit (as prepared by repaired-expert-shadow.yml).
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {exFactor,removeEx} from './exhibition_ablation.mjs';
import {distA} from './trifecta_ordering.mjs';
const root=process.env.ENGINE_ROOT;if(!root){console.log('SKIP: ENGINE_ROOT not set');process.exit(0);}
const engine=await import(pathToFileURL(path.join(root,'scripts/update_server_predictions.mjs')));
const ctx={models:engine.normalizeModel(JSON.parse(fs.readFileSync(path.join(root,'v8_model_aptitude.json'),'utf8'))),aptitude:{},course:null,venue:null,technique:null};
const lanes='123456'.split(''),MEAS=['exhibition_time','start_timing','lap_time','turn_time','straight_time'];
let seed=5;const rnd=()=>(seed=(seed*1103515245+12345)%2147483648)/2147483648;
const racer=i=>({number:4000+i,registration_number:4000+i,age:25+Math.floor(rnd()*25),weight:51+rnd()*6,average_start_timing:.13+rnd()*.06,rank_number:1+Math.floor(rnd()*4),
  late_count:0,flying_count:Math.floor(rnd()*2),national_win_rate:4+rnd()*4,national_top_2_percent:20+rnd()*40,local_win_rate:4+rnd()*4,local_top_2_percent:20+rnd()*40,
  motor_top_2_percent:25+rnd()*30,motor_top_3_percent:40+rnd()*30,boat_top_2_percent:25+rnd()*30,boat_top_3_percent:40+rnd()*30});
let checked=0,maxDiff=0,nontrivial=0;
for(let n=0;n<200;n++){
  const course=n%4===0?['1','3','2','4','5','6']:lanes;   // some races with a changed entry
  const preview={wind_speed:Math.floor(rnd()*7),racers:Object.fromEntries(lanes.map((l,i)=>[l,{course_number:Number(course[i]),tilt_adjustment:[-0.5,0,0.5][Math.floor(rnd()*3)],
    exhibition_time:6.6+rnd()*.3,start_timing:n%5===0&&i===2?-0.02:rnd()*.2,lap_time:n%3?36.5+rnd()*1.5:null,turn_time:n%3?11+rnd()*.8:null,straight_time:n%6?6.7+rnd()*.4:null}]))};
  const race={date:'20261015',racers:Object.fromEntries(lanes.map((l,i)=>[l,racer(n*6+i)])),preview};
  const without=structuredClone(race);for(const l of lanes)for(const f of MEAS)delete without.preview.racers[l][f];
  const P=rows=>Object.fromEntries(rows.map(z=>[String(z.k),z.p]));
  const withRows=engine.predictionRows(ctx,structuredClone(race),'12',String(1+n%12),'20261015'),woRows=engine.predictionRows(ctx,without,'12',String(1+n%12),'20261015');
  assert.equal(withRows.length,6);assert.ok(withRows.every(z=>z.p.every(Number.isFinite)));
  const ef=exFactor(preview.racers);nontrivial+=Object.values(ef).some(v=>Math.abs(v-1)>1e-9);
  const a=distA(removeEx(P(withRows),ef),[1,1,1]),b=new Map(distA(P(woRows),[1,1,1]).map(x=>[x.combo,x.prob]));
  for(const x of a)maxDiff=Math.max(maxDiff,Math.abs(x.prob-b.get(x.combo)));checked++;
}
assert.ok(nontrivial>150,`nontrivial ${nontrivial}`);assert.ok(maxDiff<1e-12,`max diff ${maxDiff}`);
console.log(`exhibition ablation vs frozen engine OK: ${checked} synthetic races (${nontrivial} with ef≠1), max abs diff ${maxDiff.toExponential(2)} between p/ef renormalized and engine recomputed without the five measurements`);
