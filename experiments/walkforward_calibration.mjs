// Walk-forward comparison of probability calibration methods on the repaired shadow cohort (analysis only).
//
// Scope and rules (fixed before running):
// - Data: dev/expert-shadow-repaired-archive, cohort expert-shadow-official-v1, settled, not excluded/cancelled,
//   auditRecord() clean, baseline_distribution (120 combinations). Labels are the verified official results.
// - Walk-forward by date: each test date is calibrated only with races of earlier dates (all earlier dates, or the
//   most recent RECENT_RACES of them). A date is tested only when at least MIN_PRIOR_RACES earlier races exist.
// - Methods (all fixed here, none added after looking at results):
//     raw                 baseline probabilities as saved
//     temperature         one temperature, maximum likelihood on all earlier races
//     temperature_recent  the same on the most recent RECENT_RACES earlier races only
//     platt               logistic regression on logit(p) pooled over all 120 combinations, renormalized per race
//     isotonic            pooled isotonic regression (PAV) on p, renormalized per race
// - Metrics: log loss and multiclass Brier of the race, ECE over all combinations, top-1 and top-6 hit rate.
// - Value: the unchanged shadow EV rule (probability x 0.75 x saved odds >= 1.08, max 4 x 100 yen) on races whose
//   120 preclose odds were all saved, paid with the official trifecta payout. ROI, purchases, hits, max drawdown.
// - Interpretation: descriptive only. These dates lie inside the training window of the pre-registered forward
//   tests (prospective_calibration: first 20 dates; odds_calibration: first 20 dates), so nothing here selects a
//   method for production or changes those frozen tests. Saved odds move before close; ROI here is not a forecast.
import fs from 'node:fs';
import path from 'node:path';
import {auditRecord} from './shadow_diagnostics.mjs';
import {evTickets} from './ev_drift.mjs';
import {riskMetrics} from './variant_risk.mjs';

export const WF_POLICY=Object.freeze({version:'walkforward-calibration-v1',minPriorRaces:300,recentRaces:300,eps:1e-15,
  methods:['raw','temperature','temperature_recent','platt','isotonic'],eceEdges:[0,.005,.01,.02,.05,.1,.2,.3,1.0000001]});

const clamp=p=>Math.min(1-WF_POLICY.eps,Math.max(WF_POLICY.eps,p));
const normalize=xs=>{const s=xs.reduce((a,x)=>a+x.prob,0);return xs.map(x=>({...x,prob:x.prob/s}));};

export function eligible(r){
  return r&&r.cohort==='expert-shadow-official-v1'&&r.outcome?.result&&Number.isFinite(r.outcome.amount)&&!r.excluded&&!r.cancelled&&!auditRecord(r).length;
}

// --- calibrators: fit(train races) -> (distribution) -> calibrated distribution -------------------------------
export function applyTemperature(dist,t){
  const logs=dist.map(x=>Math.log(clamp(x.prob))/t),m=Math.max(...logs),w=logs.map(x=>Math.exp(x-m)),s=w.reduce((a,x)=>a+x,0);
  return dist.map((x,i)=>({...x,prob:w[i]/s}));
}
const resultProb=(dist,result)=>dist.find(x=>x.combo===result)?.prob;
function nll(races,t){let s=0;for(const r of races)s-=Math.log(clamp(resultProb(applyTemperature(r.baseline_distribution,t),r.outcome.result)));return s/races.length;}
export function fitTemperature(races){
  // golden-section search on log t in [log 0.25, log 4]
  let a=Math.log(.25),b=Math.log(4);const g=(Math.sqrt(5)-1)/2;
  let c=b-g*(b-a),d=a+g*(b-a),fc=nll(races,Math.exp(c)),fd=nll(races,Math.exp(d));
  for(let i=0;i<60;i++){if(fc<fd){b=d;d=c;fd=fc;c=b-g*(b-a);fc=nll(races,Math.exp(c));}else{a=c;c=d;fc=fd;d=a+g*(b-a);fd=nll(races,Math.exp(d));}}
  const t=Math.exp((a+b)/2);return {t,apply:dist=>applyTemperature(dist,t)};
}
const logit=p=>Math.log(clamp(p)/(1-clamp(p)));
export function fitPlatt(races){
  const xs=[],ys=[];
  for(const r of races)for(const x of r.baseline_distribution){xs.push(logit(x.prob));ys.push(Number(x.combo===r.outcome.result));}
  let a=1,b=0;   // Newton-Raphson on the logistic log-likelihood (start at identity)
  for(let it=0;it<50;it++){
    let ga=0,gb=0,haa=0,hab=0,hbb=0;
    for(let i=0;i<xs.length;i++){const p=1/(1+Math.exp(-(a*xs[i]+b))),w=p*(1-p),e=ys[i]-p;ga+=e*xs[i];gb+=e;haa+=w*xs[i]*xs[i];hab+=w*xs[i];hbb+=w;}
    const det=haa*hbb-hab*hab;if(!(det>0))break;
    const da=(hbb*ga-hab*gb)/det,db=(haa*gb-hab*ga)/det;a+=da;b+=db;if(Math.abs(da)+Math.abs(db)<1e-10)break;
  }
  return {a,b,apply:dist=>normalize(dist.map(x=>({...x,prob:1/(1+Math.exp(-(a*logit(x.prob)+b)))})))};
}
export function fitIsotonic(races){
  // Observations with the same input probability are first aggregated into (hits, count), so the fit does not depend
  // on the order of races or of tied tickets; then weighted pool-adjacent-violators over the distinct probabilities.
  const agg=new Map();
  for(const r of races)for(const x of r.baseline_distribution){const a=agg.get(x.prob)||{y:0,w:0};a.y+=Number(x.combo===r.outcome.result);a.w++;agg.set(x.prob,a);}
  const blocks=[];   // {sum,w,lo,hi} over distinct input probabilities in increasing order
  for(const [x,a] of [...agg.entries()].sort((p,q)=>p[0]-q[0])){
    blocks.push({sum:a.y,w:a.w,lo:x,hi:x});
    while(blocks.length>1&&blocks.at(-2).sum/blocks.at(-2).w>=blocks.at(-1).sum/blocks.at(-1).w){const q=blocks.pop(),p=blocks.at(-1);p.sum+=q.sum;p.w+=q.w;p.hi=q.hi;}
  }
  const xs=blocks.map(b=>(b.lo+b.hi)/2),vs=blocks.map(b=>b.sum/b.w);
  const f=p=>{ // piecewise-linear between block centres, flat outside; floor keeps every combination possible
    if(p<=xs[0])return Math.max(vs[0],WF_POLICY.eps);if(p>=xs.at(-1))return Math.max(vs.at(-1),WF_POLICY.eps);
    let lo=0,hi=xs.length-1;while(hi-lo>1){const m=(lo+hi)>>1;if(xs[m]<=p)lo=m;else hi=m;}
    const t=(p-xs[lo])/(xs[hi]-xs[lo]||1);return Math.max(vs[lo]+t*(vs[hi]-vs[lo]),WF_POLICY.eps);
  };
  return {blocks:blocks.length,distinct_inputs:agg.size,map:f,apply:dist=>normalize(dist.map(x=>({...x,prob:f(x.prob)})))};
}

// --- metrics ---------------------------------------------------------------------------------------------------
export function raceMetrics(dist,result){
  const p=clamp(resultProb(dist,result));
  const brier=dist.reduce((s,x)=>s+(x.prob-Number(x.combo===result))**2,0);
  const ranked=[...dist].sort((a,b)=>b.prob-a.prob||a.combo.localeCompare(b.combo));
  return {log_loss:-Math.log(p),brier,top1:Number(ranked[0].combo===result),top6:Number(ranked.slice(0,6).some(x=>x.combo===result))};
}
export function ece(pairs){   // pairs: [prob, hit] over all combinations
  const E=WF_POLICY.eceEdges,bins=E.slice(0,-1).map(()=>({n:0,p:0,y:0}));
  for(const [p,y] of pairs){const i=E.findIndex((v,j)=>j<E.length-1&&p>=v&&p<E[j+1]);bins[i].n++;bins[i].p+=p;bins[i].y+=y;}
  const n=pairs.length;
  return {ece:n?bins.reduce((s,b)=>s+(b.n?b.n/n*Math.abs(b.p/b.n-b.y/b.n):0),0):null,
    bins:bins.map((b,i)=>({lower:E[i],upper:Math.min(1,E[i+1]),n:b.n,predicted:b.n?b.p/b.n:null,observed:b.n?b.y/b.n:null}))};
}
// Calibration of a selected set of tickets: mean predicted vs observed hit rate, with bins.
export function calibrationSummary(pairs){
  const n=pairs.length,p=pairs.reduce((s,x)=>s+x[0],0),y=pairs.reduce((s,x)=>s+x[1],0),e=ece(pairs);
  return {tickets:n,mean_predicted:n?p/n:null,observed_hit_rate:n?y/n:null,hits:y,expected_hits:p,ratio_observed_to_predicted:p?y/p:null,ece:e.ece,bins:e.bins.filter(b=>b.n)};
}
function evOutcome(r,dist){
  const t=evTickets(dist,r.baseline_distribution,r.odds_snapshot_at,r.saved_at);
  if(t.status!=='shadow_estimate_uncalibrated')return null;
  const hit=t.items.some(x=>x.combo===r.outcome.result);
  return {date:r.date,stadium:r.stadium,race:r.race,closed_at:String(r.closed_at),investment:t.investment,payout:hit?r.outcome.amount:0,hit:hit&&t.items.length>0,tickets:t.items.length,
    ticket_pairs:t.items.map(x=>[x.prob,Number(x.combo===r.outcome.result)])};
}

// --- walk-forward ------------------------------------------------------------------------------------------------
export function walkForward(records,{policy=WF_POLICY}={}){
  const rs=records.filter(eligible).sort((a,b)=>a.date.localeCompare(b.date)||String(a.closed_at).localeCompare(String(b.closed_at)));
  const dates=[...new Set(rs.map(r=>r.date))];
  const acc=Object.fromEntries(policy.methods.map(m=>[m,{races:0,log_loss:0,brier:0,top1:0,top6:0,pairs:[],top_pairs:[],bought_pairs:[],ev:[]}]));
  const daily=[],fits=[];
  for(const date of dates){
    const prior=rs.filter(r=>r.date<date),test=rs.filter(r=>r.date===date);
    if(prior.length<policy.minPriorRaces){daily.push({date,races:test.length,status:'warm_up',prior_races:prior.length});continue;}
    const recent=prior.slice(-policy.recentRaces);
    const cal={raw:{apply:d=>d},temperature:fitTemperature(prior),temperature_recent:fitTemperature(recent),platt:fitPlatt(prior),isotonic:fitIsotonic(prior)};
    fits.push({date,prior_races:prior.length,temperature:cal.temperature.t,temperature_recent:cal.temperature_recent.t,platt:{a:cal.platt.a,b:cal.platt.b},isotonic_blocks:cal.isotonic.blocks});
    const day={date,races:test.length,status:'tested',prior_races:prior.length,methods:{}};
    for(const m of policy.methods){
      const A=acc[m];let ll=0;const evs=[];
      for(const r of test){
        const dist=cal[m].apply(r.baseline_distribution),x=raceMetrics(dist,r.outcome.result);
        A.races++;A.log_loss+=x.log_loss;A.brier+=x.brier;A.top1+=x.top1;A.top6+=x.top6;ll+=x.log_loss;
        for(const c of dist)A.pairs.push([c.prob,Number(c.combo===r.outcome.result)]);
        const top=dist.reduce((a,b)=>b.prob>a.prob||(b.prob===a.prob&&b.combo<a.combo)?b:a);A.top_pairs.push([top.prob,Number(top.combo===r.outcome.result)]);
        const e=evOutcome(r,dist);if(e){A.ev.push(e);evs.push(e);A.bought_pairs.push(...e.ticket_pairs);}
      }
      const inv=evs.reduce((s,e)=>s+e.investment,0),pay=evs.reduce((s,e)=>s+e.payout,0);
      day.methods[m]={log_loss:ll/test.length,ev_races:evs.length,bought:evs.filter(e=>e.investment>0).length,investment:inv,payout:pay};
    }
    daily.push(day);
  }
  const summary={};
  for(const m of policy.methods){
    const A=acc[m],bought=A.ev.filter(e=>e.investment>0),inv=bought.reduce((s,e)=>s+e.investment,0),pay=bought.reduce((s,e)=>s+e.payout,0),risk=riskMetrics(bought);
    summary[m]={races:A.races,log_loss:A.races?A.log_loss/A.races:null,brier:A.races?A.brier/A.races:null,top1_hit_rate:A.races?A.top1/A.races:null,top6_hit_rate:A.races?A.top6/A.races:null,
      ece_all_combinations:ece(A.pairs).ece,ece_bins:ece(A.pairs).bins,
      // The all-combination ECE is near 0 even for a uniform 1/120 forecast; these two show calibration where it matters.
      top_ticket:calibrationSummary(A.top_pairs),bought_tickets:calibrationSummary(A.bought_pairs),
      ev:{races_with_full_odds:A.ev.length,bought_races:bought.length,tickets:bought.reduce((s,e)=>s+e.tickets,0),hits:bought.filter(e=>e.hit).length,investment:inv,payout:pay,roi:inv?pay/inv:null,profit:pay-inv,max_drawdown:risk.max_drawdown,max_consecutive_misses:risk.max_consecutive_misses,worst_day_profit:risk.worst_day_profit}};
  }
  const tested=daily.filter(d=>d.status==='tested');
  return {policy,generated_from:{eligible_races:rs.length,dates,first_test_date:tested[0]?.date??null,tested_dates:tested.length,tested_races:tested.reduce((s,d)=>s+d.races,0)},summary,daily,fits,
    interpretation:'Exploratory walk-forward on dates inside the pre-registered training window; does not select a method, change the frozen forward tests or production. The all-combination ECE alone does not show usefulness (a uniform forecast also scores near 0). Few hits and large payouts drive ROI; superiority between methods is not established. Saved preclose odds move before close.'};
}

export function loadArchive(dir){
  const out=[];
  for(const f of fs.readdirSync(dir).filter(f=>/^\d{8}\.json$/.test(f)).sort()){
    const d=JSON.parse(fs.readFileSync(path.join(dir,f),'utf8'));
    for(const r of Object.values(d.records||{}))out.push(r);
  }
  return out;
}

if(import.meta.url===`file://${process.argv[1]}`){
  const root=path.resolve(import.meta.dirname,'..');
  const out=walkForward(loadArchive(path.join(root,'dev/expert-shadow-repaired-archive')));
  const dir=path.join(root,'dev/walkforward-calibration');fs.mkdirSync(dir,{recursive:true});
  fs.writeFileSync(path.join(dir,'report.json'),JSON.stringify(out,null,1)+'\n');
  const f=(x,d=4)=>x==null?'—':Number(x).toFixed(d);
  console.log(`eligible ${out.generated_from.eligible_races}, tested ${out.generated_from.tested_races} races on ${out.generated_from.tested_dates} dates from ${out.generated_from.first_test_date}`);
  for(const [m,s] of Object.entries(out.summary))
    console.log(`${m.padEnd(19)} LL ${f(s.log_loss)} Brier ${f(s.brier)} ECEall ${f(s.ece_all_combinations,5)} top ${f(s.top_ticket.mean_predicted,3)}/${f(s.top_ticket.observed_hit_rate,3)} bought ${f(s.bought_tickets.mean_predicted,4)}/${f(s.bought_tickets.observed_hit_rate,4)} (${s.bought_tickets.hits}/${f(s.bought_tickets.expected_hits,1)}) top1 ${f(s.top1_hit_rate,3)} top6 ${f(s.top6_hit_rate,3)} | EV bought ${s.ev.bought_races}/${s.ev.races_with_full_odds} hits ${s.ev.hits} inv ${s.ev.investment} pay ${s.ev.payout} ROI ${f(s.ev.roi,3)} maxDD ${s.ev.max_drawdown}`);
}
