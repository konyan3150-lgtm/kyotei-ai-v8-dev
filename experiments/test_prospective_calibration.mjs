import assert from 'node:assert/strict';
import {temperatureDistribution,calibrationReadiness} from './prospective_calibration.mjs';
const d=[{combo:'1-2-3',prob:.8},{combo:'1-2-4',prob:.2}];const t=temperatureDistribution(d,2);assert.ok(Math.abs(t[0].prob-2/3)<1e-12);assert.equal(d[0].prob,.8);assert.ok(Math.abs(temperatureDistribution(d,1)[0].prob-.8)<1e-12);
assert.equal(calibrationReadiness({}).status,'collecting');assert.throws(()=>temperatureDistribution(d,0));
const full=[];for(let a=1;a<=6;a++)for(let b=1;b<=6;b++)for(let c=1;c<=6;c++)if(new Set([a,b,c]).size===3)full.push({combo:[a,b,c].join('-'),prob:full.length===0?.6:.4/119});
const records={};let i=0;
for(let day=1;day<=25;day++)for(let n=0;n<(day<=20?25:30);n++)records[i++]={cohort:'expert-shadow-official-v1',date:'202610'+String(day).padStart(2,'0'),saved_at:'2026-10-'+String(day).padStart(2,'0')+'T00:00:00Z',closed_at:'2026-10-'+String(day).padStart(2,'0')+' 10:00:00',baseline_distribution:full,candidate_distribution:full,baseline_picks:full.slice(0,6).map(x=>x.combo),candidate_picks:full.slice(0,6).map(x=>x.combo),outcome:{result:day<=20?full[0].combo:full[1].combo}};
const out=calibrationReadiness(records);assert.equal(out.status,'shadow_evaluation_only');assert.equal(out.train_races,500);assert.equal(out.test_races,150);assert.equal(out.train_dates.at(-1),'20261020');assert.equal(out.test_dates[0],'20261021');assert.equal(out.selected_temperature,.5);assert.ok(out.test_calibrated.log_loss>out.test_raw.log_loss);assert.equal(out.production_changed,false);
console.log('Calibration preparation passed: normalized temperatures, strict date holdout, training-only selection and no automatic promotion even when test worsens.');
