// Error-based drift monitoring (descriptive; never retrains or changes bets).
// The existing ev_drift.mjs watches input/selection distributions (PSI). This watches the prediction error itself:
// the per-race log loss of the saved shadow baseline probabilities on settled races, in close-time order.
//   fixed     raw baseline probabilities (the fixed V8 shadow engine)
//   adaptive  probabilities after a temperature fitted on the most recent RECENT races of earlier dates
//             (the walk-forward "temperature_recent" calibrator), so a model that adapts can be watched separately:
//             an adapting model can hide a change in the raw error, and the raw error can move while the adapted
//             error does not.
// Detectors (parameters fixed here, not tuned on results):
//   Page-Hinkley for an increase of the mean loss: alarm when m_t - min(m) > LAMBDA, m_t = sum(x_i - mean_i - DELTA).
//   Simplified ADWIN-type detector using the ADWIN2 bound formula (Bifet & Gavalda 2007): alarm when two sub-windows
//   of the current window differ in mean by more than the variance-aware bound (losses clipped to R), then the older
//   part is dropped. delta is a parameter of the bound, not the measured false-alarm rate of this implementation.
// Per venue: the same detectors on the fixed stream of each venue with at least MIN_VENUE_RACES races.
// A detection means "the error level changed in this stream", not "retrain"; races, venues and conditions change.
import fs from 'node:fs';
import path from 'node:path';
import {eligible,applyTemperature,fitTemperature,raceMetrics,loadArchive} from './walkforward_calibration.mjs';

export const ERROR_DRIFT_POLICY=Object.freeze({version:'error-drift-v1',ph:Object.freeze({delta:0.15,lambda:40}),
  adwin:Object.freeze({delta:0.002,range:8,minSub:30,clip:8}),recentRaces:300,minPriorRaces:300,minVenueRaces:100});

export function pageHinkley(xs,{delta=ERROR_DRIFT_POLICY.ph.delta,lambda=ERROR_DRIFT_POLICY.ph.lambda}={}){
  const alarms=[];let n=0,mean=0,m=0,min=0;
  for(let i=0;i<xs.length;i++){
    n++;mean+=(xs[i]-mean)/n;m+=xs[i]-mean-delta;min=Math.min(min,m);
    if(m-min>lambda){alarms.push(i);n=0;mean=0;m=0;min=0;}   // restart after an alarm
  }
  return alarms;
}
// Simplified ADWIN: keeps a window; after each value, checks every split with both parts >= minSub.
export function adwin(xs,{delta=ERROR_DRIFT_POLICY.adwin.delta,range=ERROR_DRIFT_POLICY.adwin.range,minSub=ERROR_DRIFT_POLICY.adwin.minSub,clip=ERROR_DRIFT_POLICY.adwin.clip}={}){
  const alarms=[];let w=[];
  for(let i=0;i<xs.length;i++){
    w.push(Math.min(xs[i],clip));
    let cut=-1;
    if(w.length>=2*minSub){
      const pre=[0];for(const x of w)pre.push(pre.at(-1)+x);
      const mu=pre.at(-1)/w.length,variance=w.reduce((acc,x)=>acc+(x-mu)**2,0)/w.length;
      for(let k=minSub;k<=w.length-minSub;k++){
        const n0=k,n1=w.length-k,m0=pre[k]/n0,m1=(pre.at(-1)-pre[k])/n1,mm=1/(1/n0+1/n1),L=Math.log(2*w.length/delta);
        // variance-aware bound of ADWIN2 (Bifet & Gavalda 2007): sqrt(2/m * var * L) + 2/(3m) * R * L
        const eps=Math.sqrt(2/mm*variance*L)+2/(3*mm)*range*L;
        if(Math.abs(m0-m1)>eps){cut=k;break;}
      }
    }
    if(cut>0){alarms.push({index:i,dropped:cut,direction:(w.slice(cut).reduce((a,x)=>a+x,0)/(w.length-cut))>(w.slice(0,cut).reduce((a,x)=>a+x,0)/cut)?'worse':'better'});w=w.slice(cut);}
  }
  return {alarms,final_window:w.length};
}

export function errorStreams(records,policy=ERROR_DRIFT_POLICY){
  const rs=records.filter(eligible).sort((a,b)=>a.date.localeCompare(b.date)||String(a.closed_at).localeCompare(String(b.closed_at))||Number(a.stadium)-Number(b.stadium)||Number(a.race)-Number(b.race));
  const fixed=rs.map(r=>({date:r.date,stadium:r.stadium,race:r.race,loss:raceMetrics(r.baseline_distribution,r.outcome.result).log_loss}));
  const adaptive=[],temps=[];
  for(const date of [...new Set(rs.map(r=>r.date))]){
    const prior=rs.filter(r=>r.date<date);if(prior.length<policy.minPriorRaces)continue;
    const {t}=fitTemperature(prior.slice(-policy.recentRaces));temps.push({date,t});
    for(const r of rs.filter(r=>r.date===date))adaptive.push({date:r.date,stadium:r.stadium,race:r.race,loss:raceMetrics(applyTemperature(r.baseline_distribution,t),r.outcome.result).log_loss});
  }
  return {fixed,adaptive,temps,races:rs.length};
}

function summarize(stream,policy){
  const xs=stream.map(x=>x.loss),mean=xs.length?xs.reduce((a,x)=>a+x,0)/xs.length:null;
  const ph=pageHinkley(xs,policy.ph),ad=adwin(xs,policy.adwin);
  const at=i=>({index:i,date:stream[i].date,stadium:stream[i].stadium,race:stream[i].race});
  const byDate={};for(const x of stream){(byDate[x.date]=byDate[x.date]||{races:0,loss:0}).races++;byDate[x.date].loss+=x.loss;}
  return {races:xs.length,mean_log_loss:mean,page_hinkley_alarms:ph.map(at),adwin_alarms:ad.alarms.map(a=>({...at(a.index),dropped:a.dropped,direction:a.direction})),adwin_final_window:ad.final_window,
    daily_mean_log_loss:Object.fromEntries(Object.entries(byDate).map(([d,v])=>[d,v.loss/v.races]))};
}

// Method comparison only on races present in both streams (the full streams cover different races and must not be
// compared by their means): mean of adaptive - fixed log loss per race, and per date.
export function pairedComparison(fixed,adaptive){
  const key=x=>`${x.date}_${x.stadium}_${x.race}`,f=new Map(fixed.map(x=>[key(x),x.loss]));
  const pairs=adaptive.filter(x=>f.has(key(x))).map(x=>({date:x.date,diff:x.loss-f.get(key(x))}));
  const byDate={};for(const p of pairs){(byDate[p.date]=byDate[p.date]||{races:0,sum:0}).races++;byDate[p.date].sum+=p.diff;}
  const n=pairs.length,mean=n?pairs.reduce((a,p)=>a+p.diff,0)/n:null,sd=n>1?Math.sqrt(pairs.reduce((a,p)=>a+(p.diff-mean)**2,0)/(n-1)):null;
  const days=Object.values(byDate);
  return {races:n,mean_diff_adaptive_minus_fixed:mean,se:sd!=null?sd/Math.sqrt(n):null,dates:days.length,dates_adaptive_better:days.filter(d=>d.sum<0).length,
    daily_mean_diff:Object.fromEntries(Object.entries(byDate).map(([d,v])=>[d,v.sum/v.races])),note:'Negative = adaptive lower log loss. Same races only. Race-level SE ignores within-day correlation.'};
}

export function errorDriftReport(records,policy=ERROR_DRIFT_POLICY){
  const s=errorStreams(records,policy);
  const venues={};
  for(const v of [...new Set(s.fixed.map(x=>x.stadium))].sort((a,b)=>Number(a)-Number(b))){
    const st=s.fixed.filter(x=>x.stadium===v);if(st.length<policy.minVenueRaces)continue;
    const r=summarize(st,policy);venues[v]={races:r.races,mean_log_loss:r.mean_log_loss,page_hinkley_alarms:r.page_hinkley_alarms.length,adwin_alarms:r.adwin_alarms.length,adwin_worse:r.adwin_alarms.filter(a=>a.direction==='worse').length};
  }
  return {policy,races:s.races,fixed:summarize(s.fixed,policy),adaptive:summarize(s.adaptive,policy),paired:pairedComparison(s.fixed,s.adaptive),adaptive_temperatures:s.temps,venues,production_changed:false,
    interpretation:'Descriptive monitoring. The fixed and adaptive streams cover different races; compare methods only with the paired same-race table. No alarm means no alarm under these settings, not that there is no drift or that the model is safe; it does not contradict the PSI input-distribution alarm. Alarms say the error level of a stream changed; venue/race mix and conditions also change. No automatic retraining, recalibration or bet change.'};
}

if(import.meta.url===`file://${process.argv[1]}`){
  const root=path.resolve(import.meta.dirname,'..');
  const out=errorDriftReport(loadArchive(path.join(root,'dev/expert-shadow-repaired-archive')));
  const dir=path.join(root,'dev/error-drift');fs.mkdirSync(dir,{recursive:true});
  fs.writeFileSync(path.join(dir,'report.json'),JSON.stringify(out,null,1)+'\n');
  const f=x=>x==null?'—':x.toFixed(4);
  console.log(`paired (same ${out.paired.races} races): adaptive - fixed LL ${f(out.paired.mean_diff_adaptive_minus_fixed)} (SE ${f(out.paired.se)}), adaptive better on ${out.paired.dates_adaptive_better}/${out.paired.dates} dates`);
  for(const k of ['fixed','adaptive'])console.log(`${k}: races ${out[k].races}, mean LL ${f(out[k].mean_log_loss)}, PH alarms ${out[k].page_hinkley_alarms.map(a=>a.date).join(',')||'none'}, ADWIN ${out[k].adwin_alarms.map(a=>a.date+':'+a.direction).join(',')||'none'}`);
  console.log('venues with alarms:',Object.entries(out.venues).filter(([,v])=>v.page_hinkley_alarms||v.adwin_alarms).map(([k,v])=>`${k}(PH${v.page_hinkley_alarms}/AD${v.adwin_alarms})`).join(' ')||'none',`of ${Object.keys(out.venues).length}`);
}
