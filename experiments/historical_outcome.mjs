// Settle against boat numbers. Actual entry courses can differ from ticket numbers.
export function historicalOutcome(race){
  const finishes=(race?.boats||[]).filter(b=>Number.isInteger(b.racer_place_number)&&b.racer_place_number>=1&&b.racer_place_number<=3);
  if(finishes.length!==3||new Set(finishes.map(b=>b.racer_place_number)).size!==3)return {eligible:false,reason:'missing_or_tied_top_three'};
  finishes.sort((a,b)=>a.racer_place_number-b.racer_place_number);
  const boats=finishes.map(b=>b.racer_boat_number);
  if(boats.some(b=>!Number.isInteger(b)||b<1||b>6)||new Set(boats).size!==3)return {eligible:false,reason:'invalid_boat_numbers'};
  const combo=boats.join('-');
  const payouts=race?.payouts?.trifecta;
  if(!Array.isArray(payouts)||payouts.length!==1)return {eligible:false,reason:'missing_or_multiple_trifecta_payouts'};
  const payout=payouts[0];
  if(String(payout.combination).replaceAll(' ','')!==combo||!Number.isFinite(payout.amount)||payout.amount<=0)return {eligible:false,reason:'result_payout_mismatch'};
  return {eligible:true,combo,amount:payout.amount,winner:String(boats[0])};
}
