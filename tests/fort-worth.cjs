// Genuine read-only preview records; account, billing and competitor services mocked.
const {chromium}=require('playwright'),assert=require('node:assert/strict'),fs=require('fs');
const {mock,user}=require('./fixtures.cjs');
const {leads}=require('./fixtures/fort-worth-preview.json');
const origin='https://integration-signal-command-fort-worth-v1-signalhound-api.rolandcoyburt.workers.dev';
(async()=>{
 const browser=await chromium.launch({headless:true,executablePath:process.env.RT_CHROMIUM_PATH,args:['--no-sandbox']});
 const results=[],dir='docs/redesign/screenshots/fort-worth';fs.mkdirSync(dir,{recursive:true});
 async function check(name,fn){try{await fn();results.push({name,status:'PASS'});console.log('PASS '+name)}catch(e){results.push({name,status:'FAIL',error:e.message});console.error('FAIL '+name+' '+e.message)}}
 async function page(width,signed=false){const p=await browser.newPage({viewport:{width,height:1000},serviceWorkers:'block'});p.calls=await mock(p);p.errors=[];p.on('pageerror',e=>p.errors.push(e.message));p.reads=[];
 await p.route('**/api/feed?**',r=>{p.reads.push(r.request().url());const m=new URL(r.request().url()).searchParams.get('markets');return r.fulfill({json:{ok:true,state:'fresh',leads:leads.filter(x=>!m||x.market===m),freshness:{thresholdMinutes:180,markets:[{market:'Fort Worth',state:'fresh',storedCount:3}]}}})});
 await p.route('**/api/dashboard?**',r=>r.fulfill({json:{leads}}));
 if(signed)await p.addInitScript(()=>localStorage.setItem('revenuetrigger_session','qa-session'));return p;}
 for(const width of [390,1366]){
 await check(`Mixed feed, Fort Worth filter, detail ${width}px`,async()=>{
 const p=await page(width);await p.goto('http://127.0.0.1:8765/signals');await p.waitForSelector('.lead');
 assert((await p.locator('#leadList').innerText()).includes('Fort Worth'));assert.equal(await p.locator('.lead').count(),5);assert((await p.locator('#leadList').innerText()).includes('Facility Innovations Group'));
 assert.equal(await p.locator('#market option').count(),8);assert(!await p.locator('#market option').allTextContents().then(a=>a.includes('Dallas')));
 await p.locator('#market').selectOption('Fort Worth');await p.waitForLoadState('networkidle');assert(p.reads.some(u=>u.startsWith(origin)&&new URL(u).searchParams.get('markets')==='Fort Worth'));
 assert(!(await p.locator('#leadList').innerText()).includes('Mesa'));assert.equal(await p.locator('.lead').count(),3);
 assert(await p.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));await p.locator('#signals').scrollIntoViewIfNeeded();await p.screenshot({path:`${dir}/signals-${width}.png`});
 const row=leads[0];await p.locator('#leadList .view').first().click();await p.waitForSelector('#leadModal.open');const detail=await p.locator('#leadModal').innerText();
 assert(detail.includes(row.source));assert(detail.includes(row.temperature));assert(detail.includes(row.score+' / 100'));assert(detail.includes('Project cluster:'));assert(detail.includes(row.lifecycle.stage));assert(detail.includes(row.actionIntelligence.whyNow));assert(detail.toLowerCase().includes('official permit valuation'));assert(detail.includes('$850,000'));
 await p.locator('#mWhy').scrollIntoViewIfNeeded();assert(await p.locator('#mWhy').evaluate(e=>e.scrollWidth<=e.clientWidth+1));await p.screenshot({path:`${dir}/detail-${width}.png`});assert.deepEqual(p.errors,[]);assert(!p.calls.some(x=>/\/leads|\/refresh/.test(x.path)));await p.close();
 });
 await check(`Seven preference choices, Territory six-market cap, Saved ${width}px`,async()=>{
 const p=await page(width,true);let current={...user,plan:'Territory',entitlements:{...user.entitlements,industryLimit:8,marketLimit:6},preferences:{...user.preferences,markets:['Fort Worth'],minScore:75}},writes=[];
 await p.route('**/api/me',r=>r.fulfill({json:{user:current}}));await p.route('**/api/billing/sync',r=>r.fulfill({json:{user:current}}));await p.route('**/api/preferences',r=>{const d=r.request().postDataJSON();writes.push(d);current={...current,preferences:d};return r.fulfill({json:{user:current}})});
 await p.goto('http://127.0.0.1:8765/signals?account=1');await p.waitForSelector('#accountLoggedIn',{state:'visible'});assert.equal(await p.locator('#marketChecks input').count(),7);assert((await p.locator('#marketLimitText').innerText()).includes('6 markets'));
 for(const box of await p.locator('#marketChecks input').all())await box.check();await p.getByRole('button',{name:'Save preferences',exact:true}).click();assert.equal(writes.length,0);assert(await p.locator('#accountModal').isVisible());
 await p.locator('#marketChecks input[value="Tucson"]').uncheck();await p.getByRole('button',{name:'Save preferences',exact:true}).click();await p.waitForSelector('#accountModal.open',{state:'hidden'});assert.equal(writes[0].markets.length,6);assert(writes[0].markets.includes('Fort Worth'));assert.equal(writes[0].minScore,75);
 await p.goto('http://127.0.0.1:8765/signals?account=1');await p.waitForSelector('#accountLoggedIn',{state:'visible'});assert(await p.locator('#marketChecks input[value="Fort Worth"]').isChecked());await p.locator('#marketChecks').scrollIntoViewIfNeeded();await p.screenshot({path:`${dir}/preferences-${width}.png`});await p.locator('#accountModal .close').click();
 await p.locator('#market').selectOption('Fort Worth');await p.locator('#leadList .save').first().click();await p.waitForSelector('#leadList .save.active');await p.locator('#savedFilter').selectOption('saved');assert.equal(await p.locator('.lead').count(),1);assert(p.calls.some(x=>x.path==='/api/saved'&&x.method==='POST'));assert(!p.reads.length);await p.close();
 });
 await check(`Sources coverage and Dallas unavailable ${width}px`,async()=>{
 const p=await page(width);await p.goto('http://127.0.0.1:8765/sources');await p.locator('[data-city="FORT WORTH"]').click();assert((await p.locator('#flowFocus').innerText()).includes('FORT WORTH'));assert.equal(await p.locator('.sources-page-grid .source').count(),7);assert((await p.locator('.source-growth').innerText()).includes('Dallas is planned / not live'));assert(await p.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));await p.locator('#sources').scrollIntoViewIfNeeded();await p.screenshot({path:`${dir}/sources-${width}.png`});await p.close();
 });
 await check(`Competitor Fort Worth selection and encoding ${width}px`,async()=>{
 const p=await page(width,true);let urls=[];
 await p.route('**/api/competitors?**',r=>{urls.push(r.request().url());return r.fulfill({json:{companies:[{company:'QA Fort Worth ΓÇö Contractor',markets:['Fort Worth'],marketCount:1,permitCount:2,reportedValue:850000,avgScore:84,recentProjects:[leads[0]]}],totalCount:1}})});
 await p.goto('http://127.0.0.1:8765/competitors');await p.waitForSelector('.competitor-row');await p.locator('#competitorMarket').selectOption('Fort Worth');await p.locator('#competitorRun').click();await p.waitForLoadState('networkidle');assert(urls.some(u=>new URL(u).searchParams.get('market')==='Fort Worth'));assert((await p.locator('#competitorList').innerText()).includes('QA Fort Worth — Contractor'));assert(!(await p.locator('#competitorList').innerText()).includes('ΓÇö'));assert(await p.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));await p.locator('#competitorMarket').scrollIntoViewIfNeeded();await p.screenshot({path:`${dir}/competitors-${width}.png`});await p.close();
 });
 await check(`Homepage coverage and six-market plan copy ${width}px`,async()=>{
 const p=await page(width);await p.goto('http://127.0.0.1:8765/');await p.waitForLoadState('networkidle');assert((await p.locator('#markets').innerText()).includes('Dallas: planned / not live.'));assert.equal(await p.locator('#marketList span').count(),6);assert((await p.locator('#pricing').innerText()).includes('up to 6 selected markets'));assert.equal(await p.locator('.rt-headline-line').count(),4);await p.screenshot({path:`${dir}/home-${width}.png`});await p.close();
 });
 }
 for(const state of ['fresh','stale','partial','empty','unavailable'])await check(`Fort Worth ${state} state and freshness array`,async()=>{
 const p=await page(390);await p.route('**/api/feed?**',r=>r.fulfill({status:state==='unavailable'?503:200,json:{state,ok:state!=='unavailable',error:state==='unavailable'?'stored_feed_unavailable':undefined,leads:['empty','unavailable'].includes(state)?[]:[leads[0]],freshness:{markets:[{market:'Fort Worth',state,storedCount:1}]}}}));await p.goto('http://127.0.0.1:8765/signals');await p.waitForLoadState('networkidle');assert.equal(await p.locator('.lead').count(),['empty','unavailable'].includes(state)?0:1);if(['stale','partial'].includes(state))assert((await p.locator('#publicFeedNotice').innerText()).includes('Fort Worth'));assert(!p.calls.some(x=>/\/leads|\/refresh/.test(x.path)));await p.close();
 });
 fs.writeFileSync('docs/redesign/fort-worth-test-results.json',JSON.stringify({validation:'Local UI with genuine stored preview feed records. Account/Saved/Competitors operations and state variants are mocked; no real account or billing writes.',results},null,2));await browser.close();if(results.some(x=>x.status==='FAIL'))process.exitCode=1;
})().catch(e=>{console.error(e);process.exit(1)});
