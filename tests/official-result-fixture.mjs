export function officialResultFixture({date='20261009',stadium='1',race='1'}={}, {refund=false,special=false,nonstandard=false}={}){
  const sid=String(Number(stadium)).padStart(2,'0');
  const rows=Array.from({length:6},(_,i)=>`<tr><td>${nonstandard&&i===5?'F':i+1}</td><td>${i+1}</td><td><span>${4001+i}</span></td><td>1.50</td></tr>`).join('');
  const combination=special?'特払':[1,2,3].map(n=>`<span class="numberSet1_number">${n}</span>`).join('');
  return `<div class="tab3"><a href="/owpc/pc/race/racelist?rno=${race}&amp;jcd=${sid}&amp;hd=${date}">結果</a></ul></div><table>ボートレーサー レースタイム ${rows}</table><table><th>返還</th><tbody><div class="numberSet1">${refund?'<span class="numberSet1_number">6</span>':''}</div></tbody></table><table>払戻金 3連単<tbody><tr><td>3連単</td><td>${combination}</td><td><span class="is-payout1">&yen;${special?'70':'1,230'}</span></td></tr></tbody></table>`;
}
