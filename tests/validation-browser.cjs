const {chromium}=require('playwright'),assert=require('node:assert/strict'),fs=require('node:fs');
(async()=>{
  const browser=await chromium.launch({headless:true}),page=await browser.newPage({viewport:{width:390,height:844}});
  const errors=[];page.on('pageerror',e=>errors.push(e.message));let fail=false;const urls=[];
  const arm={races:0,hits:0,investment:0,payout:0,roi:null,brier:null};
  const fixture={saved:2,settled:0,pending:2,cancelled:0,invalid:0,arms:{baseline:arm,candidate:arm},value_arms:{baseline:{eligible_races:0,bought_races:0,hits:0,investment:0,payout:0,roi:null},candidate:{eligible_races:0,bought_races:0,hits:0,investment:0,payout:0,roi:null}},
    calibration:{status:'collecting',train_dates:[],test_dates:[],train_races:0,test_races:0},variants:{captured:2,settled:1,st_eligible:2,st_missing:0,arms:{st:{st_25:{races:1,hit_rate:1,roi:2}},budget:{six_equal:{races:1,hit_rate:1,roi:2},three_equal:{races:1,hit_rate:1,roi:4}}}},realtime:{preserved_previous_snapshots:1},health:{checked_at:new Date().toISOString(),status:'ok',eligible_preclose_races:1,captured_preclose_races:1,original_exhibition_status:'no_preclose_values'},
    diagnostics:{paired_intervals:{status:'insufficient_sample',races:0,dates:0},by_expert:{}},drift:{status:'collecting_reference',reference_races:2,recent_races:0}};
  await page.route('https://raw.githubusercontent.com/**',route=>{urls.push(route.request().url());return fail?route.abort():route.fulfill({status:200,contentType:'application/json',body:JSON.stringify(fixture)});});
  await page.goto(process.env.DASHBOARD_URL||'http://127.0.0.1:8765/validation.html');await page.waitForFunction(()=>document.querySelector('#counts').children.length===6);
  assert.equal(await page.locator('.count').count(),6);assert.equal(await page.locator('#variantsTable tr').count(),3);assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
  fs.mkdirSync('ui-screenshots',{recursive:true});await page.screenshot({path:'ui-screenshots/validation-mobile.png',fullPage:true});
  await page.locator('#ev').click();assert.equal(await page.locator('#ev').getAttribute('aria-pressed'),'true');assert.ok((await page.locator('#comparisonNote').innerText()).includes('最大4点'));
  fixture.collection_daily={days:{20261007:{saved:2,preclose_saved:2,settled:1,pending:1,overdue:1,unrecorded_closed_races:3},20261006:{saved:1,preclose_saved:1,settled:1,pending:0,overdue:0,unrecorded_closed_races:null}}};
  await page.locator('#refresh').click();await page.waitForFunction(()=>document.querySelector('#dailyCollection').children.length===2);
  await page.locator('summary').filter({hasText:'日別の保存'}).click();
  assert.ok((await page.locator('#dailyCollection').innerText()).includes('未確認'));
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
  const freshTime=fixture.health.checked_at;fixture.health.checked_at=new Date(Date.now()-21*60000).toISOString();await page.locator('#refresh').click();await page.waitForFunction(()=>document.querySelector('#connection').textContent.includes('遅れ'));fixture.health.checked_at=freshTime;
  fail=true;await page.locator('#refresh').click();await page.waitForFunction(()=>!document.querySelector('#refresh').disabled);
  assert.equal(await page.locator('#error').isVisible(),true);assert.equal(await page.locator('.count').count(),6);
  fail=false;await page.locator('#refresh').click();await page.waitForFunction(()=>document.querySelector('#error').hidden);await page.locator('#six').click();
  assert.ok(urls.some(u=>u.includes('expert-shadow-repaired-evaluation')));await page.locator('#cohort').selectOption('legacy');await page.waitForFunction(()=>!document.querySelector('#cohort').disabled&&document.querySelector('#counts').children.length===6);assert.ok(urls.at(-1).includes('expert-shadow-evaluation'));assert.ok((await page.locator('#cohortNote').innerText()).includes('修復前'));assert.equal(await page.locator('#variantsPanel').isVisible(),false);await page.locator('#cohort').selectOption('repaired');await page.waitForFunction(()=>!document.querySelector('#cohort').disabled&&document.querySelector('#counts').children.length===6);assert.ok(urls.at(-1).includes('expert-shadow-repaired-evaluation'));
  await page.setViewportSize({width:1280,height:900});await page.screenshot({path:'ui-screenshots/validation-desktop.png',fullPage:true});assert.deepEqual(errors,[]);
  console.log('Browser checks passed: mobile width, mode switching, failed refresh preservation, recovery, no JS errors.');await browser.close();
})().catch(e=>{console.error(e);process.exit(1)});
