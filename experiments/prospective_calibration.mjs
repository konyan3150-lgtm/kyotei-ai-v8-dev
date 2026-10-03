import {auditRecord} from './shadow_diagnostics.mjs';
export const CALIBRATION_POLICY=Object.freeze({version:'trifecta-temperature-plan-v1',train_dates:20,min_train_races:500,min_test_dates:5,min_test_races:150,temperatures:[.5,.75,1,1.25,1.5,2,3]});
export function temperatureDistribution(distribution,t){
 if(!(t>0)||distribution.some(x=>!Number.isFinite(x.prob)||x.prob<0))throw Error('Invalid calibration input');
 const logs=distribution.map(x=>Math.log(Math.max(x.prob,1e-15))/t),max=Math.max(...logs),weights=logs.map(x=>Math.exp(x-max)),sum=weights.reduce((s,x)=>s+x,0);
 return distribution.map((x,i)=>({combo:x.combo,prob:weights[i]/sum}));
}
function metrics(records,t){
 let loss=0,brier=0;
 for(const r of records){const d=temperatureDistribution(r.baseline_distribution,t),p=d.find(x=>x.combo===r.outcome.result)?.prob;if(!(p>0))throw Error('Missing outcome');loss-=Math.log(p);brier+=d.reduce((s,x)=>s+(x.prob-Number(x.combo===r.outcome.result))**2,0);}
 return {races:records.length,log_loss:records.length?loss/records.length:null,brier:records.length?brier/records.length:null};
}
export function calibrationReadiness(records){
 const rs=Object.values(records).filter(r=>r.cohort==='expert-shadow-official-v1'&&r.outcome&&!r.cancelled&&!r.excluded&&!auditRecord(r).length),dates=[...new Set(rs.map(r=>r.date))].sort(),trainDates=dates.slice(0,20),testDates=dates.slice(20),train=rs.filter(r=>trainDates.includes(r.date)),test=rs.filter(r=>testDates.includes(r.date));
 const ready=trainDates.length===20&&train.length>=500&&testDates.length>=5&&test.length>=150;
 const out={policy:CALIBRATION_POLICY,status:ready?'shadow_evaluation_only':'collecting',train_dates:trainDates,test_dates:testDates,train_races:train.length,test_races:test.length,production_changed:false,interpretation:'Fit one temperature on first20 settled dates only; later dates evaluate only. No recalibration from test results, no EV purchase-rule change or automatic promotion.'};
 if(!ready)return out;
 const candidates=CALIBRATION_POLICY.temperatures.map(t=>({temperature:t,...metrics(train,t)})).sort((a,b)=>a.log_loss-b.log_loss||Math.abs(a.temperature-1)-Math.abs(b.temperature-1));
 out.selected_temperature=candidates[0].temperature;out.training_scores=candidates;out.test_raw=metrics(test,1);out.test_calibrated=metrics(test,out.selected_temperature);return out;
}
