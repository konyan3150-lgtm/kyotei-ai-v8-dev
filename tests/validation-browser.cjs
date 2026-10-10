const {chromium}=require('playwright'),assert=require('node:assert/strict'),fs=require('node:fs');
(async()=>{
  const browser=await chromium.launch({headless:true}),page=await browser.newPage({viewport:{width:390,height:844}});
  const errors=[];page.on('pageerror',e=>errors.push(e.message));let fail=false;const urls=[];
  const arm={races:0,hits:0,investment:0,payout:0,roi:null,brier:null};
  const fixture={saved:2,settled:0,pending:2,cancelled:0,invalid:0,arms:{baseline:arm,candidate:arm},value_arms:{baseline:{eligible_races:0,bought_races:0,hits:0,investment:0,payout:0,roi:null},candidate:{eligible_races:0,bought_races:0,hits:0,investment:0,payout:0,roi:null}},
    calibration:{status:'collecting',train_dates:[],test_dates:[],train_races:0,test_races:0},variants:{captured:2,settled:1,st_eligible:2,st_missing:0,arms:{st:{st_25:{races:1,hit_rate:1,roi:2}},budget:{six_equal:{races:1,hit_rate:1,roi:2},three_equal:{races:1,hit_rate:1,roi:4}}}},realtime:{preserved_previous_snapshots:1},health:{checked_at:new Date().toISOString(),status:'ok',eligible_preclose_races:1,captured_preclose_races:1,original_exhibition_status:'no_preclose_values'},
    diagnostics:{paired_intervals:{status:'insufficient_sample',races:0,dates:0},by_expert:{}},drift:{status:'collecting_reference',reference_races:2,recent_races:0}};
  fixture.odds_cap={test_races:0,test_dates:[],ready_for_review:false,arms:{}};
  await page.route('https://raw.githubusercontent.com/**',route=>{urls.push(route.request().url());return fail?route.abort():route.fulfill({status:200,contentType:'application/json',body:JSON.stringify(fixture)});});
  await page.goto(process.env.DASHBOARD_URL||'http://127.0.0.1:8765/validation.html');await page.waitForFunction(()=>document.querySelector('#counts').children.length===6);
  assert.equal(await page.locator('.count').count(),6);assert.equal(await page.locator('#variantsTable tr').count(),3);assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
  assert.ok((await page.locator('#readiness').innerText()).includes('150R必要'));assert.ok((await page.locator('#readiness').innerText()).includes('2026年10月11日'));
  fs.mkdirSync('ui-screenshots',{recursive:true});await page.screenshot({path:'ui-screenshots/validation-mobile.png',fullPage:true});
  await page.locator('#ev').click();assert.equal(await page.locator('#ev').getAttribute('aria-pressed'),'true');assert.ok((await page.locator('#comparisonNote').innerText()).includes('最大4点'));
  fixture.collection_daily={days:{20261007:{saved:2,preclose_saved:2,settled:1,pending:1,overdue:1,unrecorded_closed_races:3},20261006:{saved:1,preclose_saved:1,settled:1,pending:0,overdue:0,unrecorded_closed_races:null}}};
  fixture.st_diagnostics={counts:{eligible:2,negative_st:3,out_of_range:0,missing_or_unparseable:1}};
  fixture.collection_gaps={reasons:{not_observed_unknown:3}};
  fixture.variants.arms.budget.six_equal={races:1,hit_rate:1,roi:2,investment:600,payout:1200,risk:{max_consecutive_misses:2,max_drawdown:1800}};
  fixture.variants.daily={20261007:{budget:{six_equal:{investment:600,payout:1200}}}};
  fixture.selection_diagnostics={summary:{races:2,dates:1},axes:{decision:[{key:'confidence_yes',races:2,dates:1,hit_rate:.5,roi:1.25,profit:300,max_payout_share:1}],wind:[{key:'unknown',races:2,dates:1,hit_rate:.5,roi:1.25,profit:300,max_payout_share:1}]}};
  const bucket={lower:500,upper:null,tickets:318,races:160,dates:5,predicted_probability:.005,observed_ticket_hit_rate:0,estimated_roi:4.2,roi:0,profit:-31800};
  fixture.odds_calibration={status:'collecting_training',train_dates:['20261003','20261004','20261005','20261006','20261007'],train_races:355,model_fitted_at:null,test_dates:[],test_races:0,ready_for_review:false};
  fixture.odds_diagnostics={counts:{eligible_races:355,odds_missing_stale_or_postclose:154,odds_incomplete:1},scopes:{six_equal:{summary:{races:355,tickets:2130,dates:5},by_odds:[bucket],by_probability:[{...bucket,lower:0,upper:.01}]},ev_saved:{summary:{races:354,tickets:1416,dates:5},by_odds:[bucket],by_probability:[{...bucket,lower:0,upper:.01}]},all_combinations:{summary:{races:355,tickets:42600,dates:5},by_odds:[{...bucket,roi:undefined,profit:undefined,estimated_roi:undefined}],by_probability:[]}}};
  fixture.odds_cap={test_races:1,test_dates:['20261011'],ready_for_review:false,arms:Object.fromEntries(['reference','cap_100','cap_50','cap_30'].map((key,i)=>[key,{bought_races:1,skipped_races:0,hit_rate:1,roi:760/(400-i*100),profit:760-(400-i*100),investment:400-i*100,payout:760,risk:{max_drawdown:0,max_consecutive_misses:0}}]))};
  await page.locator('#refresh').click();await page.waitForFunction(()=>document.querySelector('#dailyCollection').children.length===2);
  assert.ok((await page.locator('#readiness').innerText()).includes('30倍未満'));assert.ok((await page.locator('#readiness').innerText()).includes('投資 ¥100・払戻 ¥760'));assert.ok((await page.locator('#readiness').innerText()).includes('判断保留。'));
  await page.locator('summary').filter({hasText:'日別の保存'}).click();
  assert.ok((await page.locator('#dailyCollection').innerText()).includes('未確認'));
  assert.ok((await page.locator('#gapNote').innerText()).includes('原因未確認 3R'));
  assert.ok((await page.locator('#stDiagnosticsNote').innerText()).includes('負のST（展示F等） 3R'));
  assert.ok((await page.locator('#variantsTable').innerText()).includes('¥1,800'));
  await page.locator('summary').filter({hasText:'買い方別の日別'}).click();assert.ok((await page.locator('#variantDaily').innerText()).includes('¥600'));
  await page.locator('#shadowSelectionPanel summary').click();assert.ok((await page.locator('#shadowSelectionRows').innerText()).includes('自信度条件あり'));await page.locator('#shadowSelectionGroup').selectOption('wind');assert.ok((await page.locator('#shadowSelectionRows').innerText()).includes('未記録・未確認'));
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
  assert.ok((await page.locator('#readiness').innerText()).includes('締切前オッズあり 355/500R'));
  await page.locator('#oddsPanel summary').click();assert.ok((await page.locator('#oddsRows').innerText()).includes('318点'));assert.ok((await page.locator('#oddsNote').innerText()).includes('355R'));
  await page.locator('#oddsScope').selectOption('ev_saved');assert.ok((await page.locator('#oddsNote').innerText()).includes('1416点'));
  await page.locator('#oddsAxis').selectOption('by_probability');assert.ok((await page.locator('#oddsRows').innerText()).includes('1.0%'));
  await page.locator('#oddsScope').selectOption('all_combinations');await page.locator('#oddsAxis').selectOption('by_odds');assert.ok((await page.locator('#oddsRows').innerText()).includes('—'));
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);await page.screenshot({path:'ui-screenshots/odds-diagnostics-mobile.png',fullPage:true});
  fixture.odds_calibration={model_fitted_at:new Date().toISOString(),test_dates:['20261021'],test_races:30,ready_for_review:false,arms:{raw:{bought_races:30,roi:.7},calibrated:{bought_races:15,roi:1.1}}};await page.locator('#refresh').click();await page.waitForFunction(()=>document.querySelector('#readiness').textContent.includes('補正を固定済み'));assert.ok((await page.locator('#readiness').innerText()).includes('まだ改善の判断は保留'));assert.ok((await page.locator('#readiness').innerText()).includes('補正後 15R'));
  const freshTime=fixture.health.checked_at;fixture.health.checked_at=new Date(Date.now()-21*60000).toISOString();await page.locator('#refresh').click();await page.waitForFunction(()=>document.querySelector('#connection').textContent.includes('遅れ'));fixture.health.checked_at=freshTime;
  fail=true;await page.locator('#refresh').click();await page.waitForFunction(()=>!document.querySelector('#refresh').disabled);
  assert.equal(await page.locator('#error').isVisible(),true);assert.equal(await page.locator('.count').count(),6);
  fail=false;await page.locator('#refresh').click();await page.waitForFunction(()=>document.querySelector('#error').hidden);await page.locator('#six').click();
  assert.ok(urls.some(u=>u.includes('expert-shadow-repaired-evaluation')));await page.locator('#cohort').selectOption('legacy');await page.waitForFunction(()=>!document.querySelector('#cohort').disabled&&document.querySelector('#counts').children.length===6);assert.ok(urls.at(-1).includes('expert-shadow-evaluation'));assert.ok((await page.locator('#cohortNote').innerText()).includes('修復前'));assert.equal(await page.locator('#variantsPanel').isVisible(),false);await page.locator('#cohort').selectOption('repaired');await page.waitForFunction(()=>!document.querySelector('#cohort').disabled&&document.querySelector('#counts').children.length===6);assert.ok(urls.at(-1).includes('expert-shadow-repaired-evaluation'));
  await page.setViewportSize({width:1280,height:900});await page.screenshot({path:'ui-screenshots/validation-desktop.png',fullPage:true});assert.deepEqual(errors,[]);
  console.log('Browser checks passed: mobile width, mode switching, failed refresh preservation, recovery, no JS errors.');await browser.close();
})().catch(e=>{console.error(e);process.exit(1)});


