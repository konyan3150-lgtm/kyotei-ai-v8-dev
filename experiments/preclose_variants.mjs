import {preserveRevision} from './realtime_shadow.mjs';
export const VARIANT_POLICY=Object.freeze({version:'preclose-st-budget-v1',budget:600,st_weights:[0,12.5,25,50],confidence:{top:.62,gap:.25}});
const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
export function exhibitionFactors(race,rows,stWeight=25){
 const scores=Object.fromEntries(rows.map(r=>[r.k,0]));
 for(const [field,w] of [['exhibition_time',30],['start_timing',stWeight],['lap_time',20],['turn_time',15],['straight_time',10]]){
  const vals=rows.map(r=>[r.k,race.preview?.racers?.[r.k]?.[field]]).filter(([,v])=>v!=null&&v!==''&&Number.isFinite(Number(v))&&Number(v)>=0).map(([k,v])=>[k,Number(v)]);
  if(vals.length<2)continue;const lo=Math.min(...vals.map(x=>x[1])),hi=Math.max(...vals.map(x=>x[1]));
  for(const [k,v] of vals)scores[k]+=(hi===lo?.5:(hi-v)/(hi-lo))*w;
 }
 const mean=rows.reduce((s,r)=>s+scores[r.k],0)/rows.length;
 return rows.map(r=>clamp(1+(scores[r.k]-mean)*.002,.94,1.06));
}
export function budgetTickets(picks,stakes){
 const items=stakes.map((stake,i)=>({combo:picks[i],stake}));
 if(items.some(x=>!/^([1-6])-([1-6])-([1-6])$/.test(x.combo||'')||new Set(x.combo.split('-')).size!==3||!Number.isInteger(x.stake)||x.stake<=0||x.stake%100)||new Set(items.map(x=>x.combo)).size!==items.length||items.reduce((s,x)=>s+x.stake,0)!==600)throw Error('Invalid matched budget');
 return items;
}
export function captureVariants({race,rows,makeBets,capturedAt}){
 if(rows.length!==6||new Set(rows.map(x=>x.k)).size!==6)throw Error('Six lanes required');
 const close=Date.parse(String(race.closed_at).replace(' ','T')+'+09:00'),at=Date.parse(capturedAt);
 if(!Number.isFinite(at)||!Number.isFinite(close)||at>=close)throw Error('Variants must be captured preclose');
 const baseline=makeBets(rows,6,'hit').map(x=>x.combo),ranked=rows.map(x=>x.p[0]).sort((a,b)=>b-a),confident=ranked[0]>=.62&&ranked[0]-ranked[1]>=.25;
 const stakes={six_equal:budgetTickets(baseline,[100,100,100,100,100,100]),three_equal:budgetTickets(baseline,[200,200,200]),two_equal:budgetTickets(baseline,[300,300]),confident_three_weighted:confident?budgetTickets(baseline,[300,200,100]):budgetTickets(baseline,[100,100,100,100,100,100])};
 const st=rows.map(x=>race.preview?.racers?.[x.k]?.start_timing),eligible=st.every(v=>v!=null&&v!==''&&Number.isFinite(Number(v))&&Number(v)>=0&&Number(v)<=2),stArms={};
 if(eligible){
  const reference=exhibitionFactors(race,rows,25);
  for(const weight of VARIANT_POLICY.st_weights){const factor=exhibitionFactors(race,rows,weight),changed=rows.map((r,i)=>({...r,p:r.p.map(v=>v*factor[i]/reference[i])}));const picks=makeBets(changed,6,'hit').map(x=>x.combo);if(weight===25&&JSON.stringify(picks)!==JSON.stringify(baseline))throw Error('ST control differs');stArms['st_'+String(weight).replace('.','_')]=budgetTickets(picks,[100,100,100,100,100,100]);}
 }
 return {policy:VARIANT_POLICY.version,captured_at:capturedAt,st:{eligible,reason:eligible?null:'requires_six_observed_nonnegative_exhibition_st',values:st.map(v=>v==null||v===''?null:Number(v)),arms:stArms},budget:{confident,top_score:ranked[0],score_gap:ranked[0]-ranked[1],arms:stakes}};
}
export function variantRevision(previous,next){
 if(!next)return previous;
 const result=preserveRevision(previous,next);if(!previous||previous.outcome||previous.cancelled||JSON.stringify(previous.variants?{...previous.variants,captured_at:null}:null)===JSON.stringify(next?.variants?{...next.variants,captured_at:null}:null))return result;
 if(result!==previous)return {...result,change_reasons:[...result.change_reasons,'variants_changed']};
 const prior={...previous};delete prior.revisions;delete prior.outcome;delete prior.cancelled;
 return {...next,revision_number:(previous.revision_number||0)+1,change_reasons:['variants_changed'],revisions:[...(previous.revisions||[]),prior]};
}
const empty=()=>({races:0,hits:0,investment:0,payout:0});
function add(s,items,outcome){s.races++;const win=items.find(x=>x.combo===outcome.result);s.hits+=Number(!!win);s.investment+=items.reduce((n,x)=>n+x.stake,0);s.payout+=win?outcome.amount*win.stake/100:0;}
const summary=x=>({...x,hit_rate:x.races?x.hits/x.races:null,roi:x.investment?x.payout/x.investment:null});
export function evaluateVariants(records){
 const all=Object.values(records).filter(r=>r.variants?.policy===VARIANT_POLICY.version),valid=all.filter(r=>r.variants.captured_at===r.saved_at&&Date.parse(r.saved_at)<Date.parse(String(r.closed_at).replace(' ','T')+'+09:00')),settled=valid.filter(r=>r.outcome&&!r.excluded&&!r.cancelled);
 const groups={st:{},budget:{}},daily={};
 for(const r of settled)for(const group of ['st','budget'])for(const [key,items] of Object.entries(r.variants[group].arms)){
  budgetTickets(items.map(x=>x.combo),items.map(x=>x.stake));add(groups[group][key]??=empty(),items,r.outcome);
  const d=daily[r.date]??={st:{},budget:{}};add(d[group][key]??=empty(),items,r.outcome);
 }
 return {policy:VARIANT_POLICY,captured:all.length,invalid:all.length-valid.length,settled:settled.length,pending:valid.filter(r=>!r.outcome&&!r.cancelled).length,excluded:valid.filter(r=>r.excluded).length,st_eligible:valid.filter(r=>r.variants.st.eligible).length,st_missing:valid.filter(r=>!r.variants.st.eligible).length,confident_captures:valid.filter(r=>r.variants.budget.confident).length,
  arms:Object.fromEntries(Object.entries(groups).map(([g,arms])=>[g,Object.fromEntries(Object.entries(arms).map(([k,x])=>[k,summary(x)]))])),daily,
  interpretation:'Exploratory fixed-policy prospective comparison. All arms spend 600 yen per included race; ST arms share the same six-ST eligibility. No automatic best-arm selection or production promotion.'};
}
