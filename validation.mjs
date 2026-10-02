export const SOURCE='https://raw.githubusercontent.com/konyan3150-lgtm/kyotei-ai-v8-dev/main/dev/expert-shadow-evaluation.json';
const names={normal:'通常',inside:'イン逃げ',upset:'イン崩れ・穴',exhibition:'展示変化',water:'水面'};
const venues=['','桐生','戸田','江戸川','平和島','多摩川','浜名湖','蒲郡','常滑','津','三国','びわこ','住之江','尼崎','鳴門','丸亀','児島','宮島','徳山','下関','若松','芦屋','福岡','唐津','大村'];
export const percentage=v=>Number.isFinite(v)?(v*100).toFixed(1)+'%':'—';
export const money=v=>Number.isFinite(v)?'¥'+v.toLocaleString('ja-JP'):'—';
export function hitRate(arm,value=false){const n=value?arm?.bought_races:arm?.races;return n>0?arm.hits/n:null}
export function status(d,now=Date.now()){
  const age=(now-Date.parse(d.health?.checked_at))/60000;
  if((d.invalid||0)>0||d.health?.status==='needs_attention')return {text:'確認が必要',kind:'warn'};
  if(Number.isFinite(age)&&age>20)return {text:'更新が遅れています',kind:'warn'};
  return {text:'収集中・比較は検証段階',kind:'good'};
}
export function validate(d){if(!d||typeof d!=='object'||!d.arms?.baseline||!d.arms?.candidate||!Number.isInteger(d.saved)||d.saved<0)throw Error('集計データの形式を確認できません');return d}
function element(tag,text,cls){const n=document.createElement(tag);if(text!=null)n.textContent=text;if(cls)n.className=cls;return n}
function row(body,values){const tr=element('tr');for(const v of values)tr.append(element('td',v));body.append(tr)}
let data=null,valueMode=false,busy=false;
function render(){
  const d=data,s=status(d),connection=document.getElementById('connection');connection.textContent=s.text;connection.className='pill '+s.kind;
  const time=d.health?.checked_at;document.getElementById('updated').textContent=time?'収集確認：'+new Date(time).toLocaleString('ja-JP',{timeZone:'Asia/Tokyo',month:'numeric',day:'numeric',hour:'2-digit',minute:'2-digit'}):'収集時刻は未確認';
  const counts=document.getElementById('counts');counts.replaceChildren();for(const [label,n] of [['保存',d.saved],['確定',d.settled],['結果待ち',d.pending],['中止',d.cancelled||0],['記録エラー',d.invalid||0],['変更履歴',d.realtime?.preserved_previous_snapshots||0]]){const c=element('div',null,'count');c.append(element('span',label),element('strong',String(n??0)));counts.append(c)}
  document.getElementById('six').setAttribute('aria-pressed',String(!valueMode));document.getElementById('ev').setAttribute('aria-pressed',String(valueMode));
  const arms=valueMode?d.value_arms:d.arms,a=arms?.baseline||{},b=arms?.candidate||{},body=document.getElementById('comparison');body.replaceChildren();
  row(body,['購入対象',String((valueMode?a.bought_races:a.races)??0)+'R',String((valueMode?b.bought_races:b.races)??0)+'R']);
  row(body,['的中率',percentage(hitRate(a,valueMode)),percentage(hitRate(b,valueMode))]);row(body,['回収率',percentage(a.roi),percentage(b.roi)]);
  row(body,['仮想投資',money(a.investment),money(b.investment)]);row(body,['仮想払戻',money(a.payout),money(b.payout)]);
  if(!valueMode)row(body,['確率誤差',Number.isFinite(a.brier)?a.brier.toFixed(4):'—',Number.isFinite(b.brier)?b.brier.toFixed(4):'—']);
  document.getElementById('sample').textContent=(d.settled||0)+'R確定';document.getElementById('comparisonNote').textContent=valueMode?'仮想購入・最大4点×100円。確率は未校正の推定値。古い・欠けたオッズは除外。':'仮想購入・両方式6点×100円。本番実績とは別集計。確率誤差は小さい方が良い値です。';
  const health=document.getElementById('health');health.replaceChildren();
  const info=(title,detail)=>{const li=element('li');li.append(element('strong',title),element('span',detail));health.append(li)};
  info('締切前の保存',`${d.health?.captured_preclose_races??0} / ${d.health?.eligible_preclose_races??0}R（現在の収集対象）`);
  const missing=d.health?.missing_preclose_records?.length||0,stale=d.health?.stale_preclose_records?.length||0;info('更新漏れ・遅れ',missing||stale?`保存漏れ ${missing}R・更新遅れ ${stale}R`:'今回の確認で検出なし');
  info('結果反映',d.health?.overdue_results?.length?`締切から30分以上の結果待ち ${d.health.overdue_results.length}R`:'30分以上の反映待ちは検出なし');
  const orig=d.health?.original_exhibition_status;info('周回・回り足・直線展示',orig==='captured_preclose'?'締切前の追加展示を取得':orig==='no_preclose_values'?'今回の対象に追加値なし':orig==='fetch_or_parse_error'?'取得または読み取りに失敗':orig?.startsWith('HTTP_')?'取得元からデータを受信できません':'未確認');
  const ready=document.getElementById('readiness');ready.replaceChildren();
  const item=(title,detail)=>{const n=element('div');n.append(element('strong',title),element('span',detail));ready.append(n)};
  const p=d.diagnostics?.paired_intervals,dr=d.drift;item('改善の判断',p?.status==='descriptive_interval'?'差のばらつきを集計中。将来期間での確認が必要。':`データ不足：確定 ${p?.races??0}/100R・${p?.dates??0}/5日`);
  item('傾向変化の検知',dr?.status==='distribution_change_detected'?'データの分布変化を検知。内容確認が必要。':dr?.status==='stable'?'今回の基準では大きな変化なし':`基準 ${dr?.reference_races??0}/200R・比較 ${dr?.recent_races??0}/50R`);
  renderGroups();
}
function renderGroups(){
  const field=document.getElementById('group').value,body=document.getElementById('groups');body.replaceChildren();
  const groups=data?.diagnostics?.[field]||{};
  if(!Object.keys(groups).length){const tr=element('tr'),td=element('td','確定結果が溜まると表示します','empty');td.colSpan=4;tr.append(td);body.append(tr);return}
  for(const [k,g] of Object.entries(groups)){const label=field==='by_expert'?names[k]||k:field==='by_stadium'?venues[Number(k)]||k:k;row(body,[label,g.races+'R',percentage(g.arms?.baseline?.hit_rate),percentage(g.arms?.candidate?.hit_rate)])}
}
async function refresh(){
  if(busy)return;busy=true;const button=document.getElementById('refresh');button.disabled=true;const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),12000);
  try{const response=await fetch(SOURCE+'?t='+Date.now(),{cache:'no-store',signal:controller.signal});if(!response.ok)throw Error('データを取得できませんでした');data=validate(await response.json());render();document.getElementById('error').hidden=true}
  catch(e){const error=document.getElementById('error');error.hidden=false;error.textContent=(data?'更新に失敗しました。前回のデータを表示しています。':'データを取得できません。時間を置いて「更新」を押してください。');const connection=document.getElementById('connection');connection.textContent='接続を確認してください';connection.className='pill warn'}
  finally{clearTimeout(timer);busy=false;button.disabled=false}
}
if(typeof document!=='undefined'){
  document.getElementById('refresh').addEventListener('click',refresh);document.getElementById('six').addEventListener('click',()=>{valueMode=false;if(data)render()});document.getElementById('ev').addEventListener('click',()=>{valueMode=true;if(data)render()});document.getElementById('group').addEventListener('change',renderGroups);
  refresh();setInterval(refresh,180000);
}
