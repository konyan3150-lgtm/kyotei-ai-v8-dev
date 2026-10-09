const {chromium}=require('playwright');
const assert=require('node:assert/strict'),fs=require('node:fs');
const {savedSampleWindow}=require('./homepage-saved-window.cjs');
(async()=>{
  fs.mkdirSync('ui-screenshots',{recursive:true});
  const browser=await chromium.launch({headless:true});
  const page=await browser.newPage({viewport:{width:390,height:844},timezoneId:'Asia/Tokyo'});
  const errors=[],failures=[];
  page.on('pageerror',e=>errors.push(e.message));
  page.on('requestfailed',r=>failures.push({url:r.url().split('?')[0],error:r.failure()?.errorText}));
  const report={scope:'real network; temporary browser storage; no production writes',errors,failures};
  try{
    await page.goto(process.env.HOMEPAGE_URL||'http://127.0.0.1:8765/index.html');
    await page.waitForFunction(()=>typeof D!=='undefined'&&D&&D.date===day()&&S.length>0,{},{timeout:90000});
    await page.waitForFunction(()=>models.length===3&&window.__v8ServerPredictionData?.records,{},{timeout:90000});
    assert.ok((await page.locator('#modelDiag').innerText()).includes('V8モデル取得成功'));
    report.date=await page.evaluate(()=>day());
    report.venues=await page.locator('#venueScroll button').count();
    assert.ok(report.venues>0);
    const samples=await page.evaluate(()=>Object.entries(window.__v8ServerPredictionData.records).filter(([key,r])=>{
      const venue=String(Number(r.stadium)),race=String(Number(r.race));
      return r.date===day()&&r.modes?.hit?.picks?.length&&r.value_modes?.hit?.picks?.length&&D.programs.stadiums[venue]?.races?.[race];
    }).slice(0,3).map(([key,r])=>({key,venue:String(Number(r.stadium)),race:String(Number(r.race)),record:r})));
    const closingTimes=await page.evaluate(()=>Object.values(D.programs.stadiums).flatMap(s=>Object.values(s.races||{})).map(r=>raceCloseMs(r)));
    report.saved_sample_status=savedSampleWindow(samples.length,closingTimes);
    report.sample_keys=samples.map(x=>x.key);
    for(const sample of samples){
      await page.evaluate(({venue,race})=>{sid=venue;rno=race;autoRace=false;draw()},sample);
      for(const view of ['base','value']){
        await page.locator(`.prediction-type-tabs [data-view=${view}]`).click();
        for(const mode of ['hit','balance','return']){
          await page.locator(`.${view}-modes [data-mode=${mode}]`).click();
          const saved=sample.record[view==='base'?'modes':'value_modes'][mode];
          const target=page.locator(view==='base'?'#baseSavedAudit':'#valueSavedAudit');
          const text=await target.innerText();
          for(const combo of saved.picks||[])assert.ok(text.includes(combo),`${sample.key} ${view}/${mode} missing ${combo}`);
          const authoritative=await page.evaluate(key=>window.v8GetServerPrediction(key),sample.key);
          assert.deepEqual(authoritative[view==='base'?'modes':'value_modes'][mode].picks,saved.picks);
          assert.equal(authoritative[view==='base'?'modes':'value_modes'][mode].stake,saved.stake);
          assert.equal(authoritative[view==='base'?'modes':'value_modes'][mode].payout,saved.payout);
        }
      }
    }
    assert.ok(await page.locator('#racers tr').count()>=6,'Six real racers rendered');
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
    await page.screenshot({path:'ui-screenshots/homepage-live-mobile.png',fullPage:true});
    await page.setViewportSize({width:1280,height:900});
    await page.screenshot({path:'ui-screenshots/homepage-live-desktop.png',fullPage:true});
    // Tomorrow's absence is a valid empty state, never permission to show today data.
    await page.locator('#tomorrowBtn').click();
    await page.waitForFunction(()=>dateOffset===1&&((D&&D.date===day())||document.querySelector('#status').textContent.includes('取得待ち')),{},{timeout:90000});
    report.tomorrow=await page.evaluate(()=>({requested:day(),loaded:D?.date||null,status:document.querySelector('#status').textContent}));
    if(report.tomorrow.loaded)assert.equal(report.tomorrow.loaded,report.tomorrow.requested);
    await page.locator('#todayBtn').click();
    await page.waitForFunction(()=>dateOffset===0&&D?.date===day(),{},{timeout:90000});
    assert.deepEqual(errors,[]);
    report.status='passed';
    console.log(`Homepage real-data checks passed: program/model/server records, ${samples.length} saved races (${report.saved_sample_status}), six racers, responsive layout, date switching, no JS errors.`);
  }catch(e){
    report.status='failed';report.error=String(e);
    report.diagnostics=await page.evaluate(()=>Object.fromEntries(['status','modelDiag','serverDiag','selectedRace'].map(id=>[id,document.getElementById(id)?.textContent]))).catch(()=>({}));
    await page.screenshot({path:'ui-screenshots/homepage-live-failure.png',fullPage:true}).catch(()=>{});
    throw e;
  }finally{
    fs.writeFileSync('ui-screenshots/homepage-live-report.json',JSON.stringify(report,null,2));
    await browser.close();
  }
})().catch(e=>{console.error(e);process.exit(1)});
