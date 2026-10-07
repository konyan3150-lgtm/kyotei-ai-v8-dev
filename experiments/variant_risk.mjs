export function riskMetrics(events){
  let profit=0,peak=0,maxDrawdown=0,misses=0,maxMisses=0;
  const daily={};
  for(const e of [...events].sort((a,b)=>a.closed_at.localeCompare(b.closed_at)||Number(a.stadium)-Number(b.stadium)||Number(a.race)-Number(b.race))){
    profit+=e.payout-e.investment;peak=Math.max(peak,profit);maxDrawdown=Math.max(maxDrawdown,peak-profit);
    misses=e.hit?0:misses+1;maxMisses=Math.max(maxMisses,misses);
    daily[e.date]=(daily[e.date]||0)+e.payout-e.investment;
  }
  return {profit,max_consecutive_misses:maxMisses,max_drawdown:maxDrawdown,worst_day_profit:events.length?Math.min(...Object.values(daily)):null,daily_profit:daily,ordering:'close time, stadium, race; simultaneous races use deterministic venue order',scope:'Observed settled shadow purchases only; excludes cancellation and excluded races. No guarantee of future loss limits.'};
}
