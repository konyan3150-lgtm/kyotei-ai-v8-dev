import {createHash} from 'node:crypto';
import {auditRecord} from './shadow_diagnostics.mjs';
import {temperatureDistribution} from './prospective_calibration.mjs';
import {evTickets,EV_POLICY} from './ev_drift.mjs';
import {riskMetrics} from './variant_risk.mjs';

export const ODDS_CALIBRATION_POLICY=Object.freeze({version:'odds-calibration-prospective-v1',train_dates:20,min_train_races:500,min_test_dates:5,min_test_races:150,
  temperatures:[1,.75],market_weights:[0,.25,.5,.75],ev_policy:EV_POLICY.version});
const closeMs=r=>Date.parse(String(r.closed_at).replace(' ','T')+'+09:00');
const jstDate=at=>new Date(Date.parse(at)+9*3600000).toISOString().slice(0,10).replaceAll('-','');
function eligible(r){
 const at=Date.parse(r.odds_snapshot_at),saved=Date.parse(r.saved_at);
 return r.cohort==='expert-shadow-official-v1'&&!r.cancelled&&!r.excluded&&!auditRecord(r).length&&Number.isFinite(at)&&at<=saved&&at<closeMs(r)&&saved-at<=EV_POLICY.maxOddsAgeMs&&r.baseline_distribution.every(x=>Number.isFinite(x.odds)&&x.odds>0);
}
export function oddsCalibratedDistribution(distribution,{temperature,market_weight}){
 if(!ODDS_CALIBRATION_POLICY.temperatures.includes(temperature)||!ODDS_CALIBRATION_POLICY.market_weights.includes(market_weight)||distribution.length!==120||new Set(distribution.map(x=>x.combo)).size!==120||distribution.some(x=>!Number.isFinite(x.odds)||x.odds<=0))throw Error('Invalid odds calibration inputs');
 const raw=temperatureDistribution(distribution,temperature),sum=distribution.reduce((s,x)=>s+1/x.odds,0);
 return raw.map((x,i)=>({combo:x.combo,prob:(1-market_weight)*x.prob+market_weight/(distribution[i].odds*sum)}));
}
export function validateOddsCalibrationModel(model){
 if(model?.version!==ODDS_CALIBRATION_POLICY.version||!Number.isFinite(Date.parse(model.fitted_at))||!Array.isArray(model.train_dates)||model.train_dates.length!==20||new Set(model.train_dates).size!==20||model.train_dates.some(x=>!/^\d{8}$/.test(x))||model.train_dates.join()!==[...model.train_dates].sort().join()||!Number.isInteger(model.train_races)||model.train_races<500||!/^[a-f0-9]{64}$/.test(model.train_fingerprint)||!ODDS_CALIBRATION_POLICY.temperatures.includes(model.temperature)||!ODDS_CALIBRATION_POLICY.market_weights.includes(model.market_weight))throw Error('Invalid frozen odds calibration model');
 if(jstDate(model.fitted_at)<=model.train_dates.at(-1))throw Error('Calibration fitted before training period ended');
 return model;
}
export function prepareOddsCalibration(records,{today,now=new Date().toISOString(),model=null}){
 if(!/^\d{8}$/.test(today)||!Number.isFinite(Date.parse(now))||today!==jstDate(now))throw Error('Invalid calibration clock');
 if(model)return {model:validateOddsCalibrationModel(model),status:'frozen',new_model:false};
 const observed=Object.values(records).filter(r=>r.cohort==='expert-shadow-official-v1'&&r.date<today&&r.outcome&&!r.cancelled&&!r.excluded&&!auditRecord(r).length);
 const dates=[...new Set(observed.map(r=>r.date))].sort().slice(0,20),keys=new Set(dates);
 const train=observed.filter(r=>keys.has(r.date)&&eligible(r)&&r.baseline_distribution.some(x=>x.combo===r.outcome.result)&&Number.isFinite(Date.parse(r.outcome.settled_at))&&Date.parse(r.outcome.settled_at)<=Date.parse(now))
   .sort((a,b)=>`${a.date}_${a.stadium}_${a.race}`.localeCompare(`${b.date}_${b.stadium}_${b.race}`));
 if(dates.length<20||train.length<500)return {model:null,status:'collecting',new_model:false,train_dates:dates,train_races:train.length};
 const scores=[];
 for(const temperature of ODDS_CALIBRATION_POLICY.temperatures)for(const market_weight of ODDS_CALIBRATION_POLICY.market_weights){
  let loss=0,brier=0;
  for(const r of train){const d=oddsCalibratedDistribution(r.baseline_distribution,{temperature,market_weight}),p=d.find(x=>x.combo===r.outcome.result).prob;loss-=Math.log(Math.max(p,1e-15));brier+=d.reduce((s,x)=>s+(x.prob-Number(x.combo===r.outcome.result))**2,0);}
  scores.push({temperature,market_weight,log_loss:loss/train.length,brier:brier/train.length});
 }
 scores.sort((a,b)=>a.log_loss-b.log_loss||a.market_weight-b.market_weight||Math.abs(a.temperature-1)-Math.abs(b.temperature-1));
 const fingerprint=createHash('sha256').update(JSON.stringify(train.map(r=>({key:`${r.date}_${r.stadium}_${r.race}`,saved_at:r.saved_at,odds_snapshot_at:r.odds_snapshot_at,distribution:r.baseline_distribution,result:r.outcome.result})))).digest('hex');
 const selected=scores[0];return {status:'frozen',new_model:true,model:{version:ODDS_CALIBRATION_POLICY.version,fitted_at:now,train_dates:dates,train_races:train.length,train_fingerprint:fingerprint,
   temperature:selected.temperature,market_weight:selected.market_weight,training_scores:scores,production_changed:false}};
}
export function captureOddsCalibration(r,model){
 if(!model)return null;validateOddsCalibrationModel(model);
 if(!eligible(r)||Date.parse(r.saved_at)<Date.parse(model.fitted_at)||r.date<=model.train_dates.at(-1))return null;
 const distribution=oddsCalibratedDistribution(r.baseline_distribution,model);
 return {version:model.version,model_fingerprint:model.train_fingerprint,model_fitted_at:model.fitted_at,captured_at:r.saved_at,
   temperature:model.temperature,market_weight:model.market_weight,distribution,value:evTickets(distribution,r.baseline_distribution,r.odds_snapshot_at,r.saved_at)};
}
function captureValid(r,c){
 if(!c||c.version!==ODDS_CALIBRATION_POLICY.version||c.captured_at!==r.saved_at||!Number.isFinite(Date.parse(c.model_fitted_at))||Date.parse(c.model_fitted_at)>Date.parse(r.saved_at)||!Array.isArray(c.distribution)||c.distribution.length!==120||new Set(c.distribution.map(x=>x.combo)).size!==120||c.distribution.some(x=>!Number.isFinite(x.prob)||x.prob<0||x.prob>1)||Math.abs(c.distribution.reduce((s,x)=>s+x.prob,0)-1)>1e-8||c.value?.status!=='shadow_estimate_uncalibrated'||!Array.isArray(c.value.items))return false;
 const probabilities=new Map(c.distribution.map(x=>[x.combo,x.prob])),odds=new Map(r.baseline_distribution.map(x=>[x.combo,x.odds]));
 return c.distribution.every(x=>odds.has(x.combo))&&new Set(c.value.items.map(x=>x.combo)).size===c.value.items.length&&c.value.items.length<=EV_POLICY.maxTickets&&c.value.items.every(x=>x.prob===probabilities.get(x.combo)&&x.odds===odds.get(x.combo)&&x.stake===EV_POLICY.stake)&&c.value.investment===c.value.items.reduce((s,x)=>s+x.stake,0);
}
export function settleOddsCalibration(r){
 const c=r.odds_calibration_shadow;
 if(!r.outcome||!eligible(r)||!captureValid(r,c))return null;
 const p=c.distribution.find(x=>x.combo===r.outcome.result)?.prob;if(!(p>0)||!Number.isFinite(r.outcome.amount)||r.outcome.amount<=0)return null;
 const winning=c.value.items.find(x=>x.combo===r.outcome.result);
 return {investment:c.value.investment,payout:winning?r.outcome.amount*winning.stake/100:0,hit:!!winning,
   log_loss:-Math.log(p),brier:c.distribution.reduce((sum,x)=>sum+(x.prob-Number(x.combo===r.outcome.result))**2,0)};
}
export function oddsCalibrationReport(records,prepared){
 const model=prepared.model;
 const base={policy:ODDS_CALIBRATION_POLICY,status:model?'collecting_future':'collecting_training',train_dates:model?.train_dates||prepared.train_dates||[],train_races:model?.train_races||prepared.train_races||0,
   model_fitted_at:model?.fitted_at||null,selected:model?{temperature:model.temperature,market_weight:model.market_weight}:null,production_changed:false,
   interpretation:'Fit once on first20 completed past dates with >=500 complete preclose-odds races. Freeze persisted model; compare only snapshots captured after fitting, never retrofit completed races. Same saved odds and fixed EV policy. Five future dates and >=150 paired settled races required for review. No automatic production adoption.'};
 const rs=model?Object.values(records).filter(r=>eligible(r)&&captureValid(r,r.odds_calibration_shadow)&&r.date>model.train_dates.at(-1)&&r.odds_calibration_shadow?.model_fingerprint===model.train_fingerprint&&r.odds_calibration_shadow.model_fitted_at===model.fitted_at&&r.odds_calibration_shadow.temperature===model.temperature&&r.odds_calibration_shadow.market_weight===model.market_weight&&r.odds_calibration_shadow.captured_at===r.saved_at&&Date.parse(r.saved_at)>=Date.parse(model.fitted_at)&&r.outcome?.odds_calibration&&r.outcome?.value_metrics?.baseline&&r.outcome?.metrics?.baseline):[];
 base.test_dates=[...new Set(rs.map(r=>r.date))].sort();base.test_races=rs.length;base.ready_for_review=base.test_dates.length>=5&&rs.length>=150;
 if(base.ready_for_review)base.status='future_comparison_ready';
 if(!rs.length)return base;
 base.arms={};for(const arm of ['raw','calibrated']){
  const events=rs.map(r=>({...r,...(arm==='raw'?r.outcome.value_metrics.baseline:r.outcome.odds_calibration)})),bought=events.filter(r=>r.investment>0),investment=events.reduce((s,r)=>s+r.investment,0),payout=events.reduce((s,r)=>s+r.payout,0);
  const probabilityMetrics=rs.map(r=>arm==='raw'?r.outcome.metrics.baseline:r.outcome.odds_calibration);
  base.arms[arm]={eligible_races:rs.length,bought_races:bought.length,skipped_races:rs.length-bought.length,hits:bought.filter(r=>r.hit).length,hit_rate:bought.length?bought.filter(r=>r.hit).length/bought.length:null,
   investment,payout,profit:payout-investment,roi:investment?payout/investment:null,log_loss:probabilityMetrics.reduce((s,r)=>s+r.log_loss,0)/rs.length,brier:probabilityMetrics.reduce((s,r)=>s+r.brier,0)/rs.length,risk:riskMetrics(bought)};
 }
 return base;
}
