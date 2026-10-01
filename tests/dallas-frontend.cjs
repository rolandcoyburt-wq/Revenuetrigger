// Local browser regression: all APIs intercepted; synthetic detail never served publicly.
const {chromium}=require('playwright'),assert=require('node:assert/strict'),fs=require('node:fs');
const {mock,user,leads}=require('./fixtures.cjs');
const dallas={...leads[0],id:'qa-dallas',market:'Dallas',name:'Commercial build-out',company:'QA Dallas Contractor LLC',address:'123 QA Street, Dallas TX',source:'City of Dallas DallasNow Building ΓÇö Submitted',scope:'Interior improvements [PHONE REDACTED]. '.repeat(35)};
const fw={...leads[1],id:'qa-fw',market:'Fort Worth',company:'QA Fort Worth Contractor LLC'};
async function showFilters(p){const toggle=p.locator('.rt-mobile-filter-toggle');if(await toggle.isVisible()&&await toggle.getAttribute('aria-expanded')==='false')await toggle.click()}
const teaser=x=>({id:'teaser_'+x.market.replaceAll(' ','_'),market:x.market,name:'Commercial building activity',date:x.date,score:x.score,temperature:x.temperature,value:x.value,categories:x.categories,stage:'APPLICATION',publicPreview:true});
(async()=>{
 const browser=await chromium.launch({headless:true,executablePath:process.env.RT_CHROMIUM_PATH,args:['--no-sandbox']});let count=0;
 const dir='docs/redesign/screenshots/dallas';fs.mkdirSync(dir,{recursive:true});
 try {for(const width of [390,1366]){
 const p=await browser.newPage({viewport:{width,height:1000},serviceWorkers:'block'});p.setDefaultTimeout(10000);const calls=await mock(p),errors=[];p.on('pageerror',e=>errors.push(e.message));
 let current={...user,plan:'Territory',entitlements:{...user.entitlements,marketLimit:6,industryLimit:8},preferences:{...user.preferences,markets:['Dallas','Fort Worth']}},writes=[],saved=new Set();
 await p.route('**/api/me',r=>r.fulfill({json:{user:current}}));
 await p.route('**/api/billing/sync',r=>r.fulfill({json:{user:current}}));
 await p.route('**/api/preferences',r=>{const data=r.request().postDataJSON();writes.push(data);current={...current,onboardingComplete:true,preferences:data};return r.fulfill({json:{user:current}})});
 await p.route('**/api/dashboard?**',r=>r.fulfill({json:{leads:[dallas,fw].map(x=>({...x,saved:saved.has(x.id)}))}}));
 await p.route('**/api/saved',r=>{const data=r.request().postDataJSON();saved.add(data.id||data.leadId);return r.fulfill({json:{ok:true}})});
 await p.route('**/api/feed?**',r=>{const market=new URL(r.request().url()).searchParams.get('markets');return r.fulfill({json:{ok:true,state:'fresh',publicPreview:true,leads:[dallas,fw].filter(x=>!market||market===x.market).map(teaser),counts:{available:12}}})});
 await p.route('**/api/pipeline?**',r=>r.fulfill({json:{pipeline:[{...(r.request().headers().authorization?dallas:teaser(dallas)),market:'Chandler',stage:'PRE-TECH'}],publicPreview:!r.request().headers().authorization,sourceStatus:'live'}}));
 await p.goto('http://127.0.0.1:8765/signals');await p.waitForSelector('.lead');
 assert.equal(await p.locator('#market option').count(),9);
 await showFilters(p);await p.locator('#market').selectOption('Dallas');await p.waitForFunction(()=>document.querySelectorAll('#leadList .lead').length===1);
 assert.equal(await p.locator('.lead').count(),1);assert(!/QA Dallas|123 QA|qa-dallas/.test(await p.locator('#leadList').innerHTML()));
 await p.locator('#leadList .view').click();await p.waitForSelector('#signinModal.open');assert(!(await p.locator('#leadModal').getAttribute('class')).includes('open'));count++;
 await p.evaluate(()=>localStorage.setItem('revenuetrigger_session','qa-session'));
 await p.goto('http://127.0.0.1:8765/signals?account=1');await p.waitForSelector('#accountLoggedIn',{state:'visible'});
 assert.equal(await p.locator('#marketChecks input').count(),8);assert((await p.locator('#marketLimitText').innerText()).includes('6 markets'));
 for(const box of await p.locator('#marketChecks input').all())await box.check();
 await p.getByRole('button',{name:'Save preferences',exact:true}).click();assert.equal(writes.length,0);
 for(const market of ['Phoenix','Tempe'])await p.locator(`#marketChecks input[value="${market}"]`).uncheck();
 await p.getByRole('button',{name:'Save preferences',exact:true}).click();await p.waitForSelector('#accountModal.open',{state:'hidden'});assert.equal(writes[0].markets.length,6);assert(writes[0].markets.includes('Dallas'));assert(writes[0].markets.includes('Fort Worth'));
 await p.reload();await p.waitForSelector('#accountLoggedIn',{state:'visible'});assert(await p.locator('#marketChecks input[value="Dallas"]').isChecked());await p.locator('#accountModal .close').click();count++;
 await p.waitForSelector('.lead');assert.equal(await p.locator('.lead').count(),2);await showFilters(p);await p.locator('#market').selectOption('Dallas');assert.equal(await p.locator('.lead').count(),1);
 await p.locator('#leadList .view').click();await p.waitForSelector('#leadModal.open');const detail=await p.locator('#leadModal').innerText();assert(detail.includes('QA Dallas'));assert(detail.includes('City of Dallas DallasNow Building — Submitted'));assert(detail.includes('[PHONE REDACTED]'));assert(await p.locator('#mWhy').evaluate(e=>e.scrollWidth<=e.clientWidth+1));await p.screenshot({path:`${dir}/detail-${width}.png`});await p.keyboard.press('Escape');count++;
 await p.locator('#leadList .save').click();await p.waitForSelector('#leadList .save.active');await p.reload();await p.waitForSelector('#accountLoggedIn',{state:'visible'});await p.locator('#accountModal .close').click();await showFilters(p);await p.locator('#savedFilter').selectOption('saved');assert.equal(await p.locator('.lead').count(),1);assert((await p.locator('#leadList').innerText()).includes('Dallas'));count++;
 current={...current,onboardingComplete:false};await p.goto('http://127.0.0.1:8765/signals');await p.waitForSelector('#onboardingModal.open');assert.equal(await p.locator('#onboardingMarkets input').count(),8);assert(await p.locator('#onboardingMarkets input[value="Dallas"]').isChecked());
 for(const box of await p.locator('#onboardingMarkets input').all())await box.check();
 const before=writes.length;await p.evaluate(()=>completeOnboarding());assert.equal(writes.length,before);
 for(const market of ['Mesa','Chandler'])await p.locator(`#onboardingMarkets input[value="${market}"]`).uncheck();
 await p.evaluate(()=>completeOnboarding());await p.waitForSelector('#onboardingModal.open',{state:'hidden'});assert.equal(writes.at(-1).markets.length,6);assert(writes.at(-1).markets.includes('Dallas'));assert(writes.at(-1).markets.includes('Fort Worth'));await p.reload();await p.waitForSelector('.lead');assert.equal(await p.locator('#onboardingModal.open').count(),0);count++;
 await p.evaluate(()=>logout());await p.waitForFunction(()=>document.querySelector('#leadList').textContent.includes('Commercial building activity'));assert(!/QA Dallas|123 QA/.test(await p.locator('#leadList').innerText()));assert(!(await p.locator('#leadModal').getAttribute('class')).includes('open'));assert.equal(await p.evaluate(()=>localStorage.getItem('revenuetrigger_session')),null);count++;
 await p.goto('http://127.0.0.1:8765/sources');assert.equal(await p.locator('.sources-page-grid .source').count(),8);await p.locator('[data-city="DALLAS"]').click();assert((await p.locator('#flowMode').innerText()).includes('Rolling 7-day Building Submitted + Issued reports'));assert(!(await p.locator('#flowMode').innerText()).includes('Early Pipeline'));assert((await p.locator('.source-meta').innerText()).includes('01'));assert(await p.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));await p.screenshot({path:`${dir}/sources-${width}.png`});count++;
 let competitorUrls=[];await p.route('**/api/competitors?**',r=>{competitorUrls.push(r.request().url());return r.fulfill({json:{companies:[{company:dallas.company,markets:['Dallas'],permitCount:1,recentProjects:[dallas]}],totalCount:1}})});
 await p.evaluate(()=>localStorage.setItem('revenuetrigger_session','qa-session'));await p.goto('http://127.0.0.1:8765/competitors');await p.waitForSelector('.competitor-row');await p.locator('[data-market="Dallas"]').click();await p.waitForFunction(()=>document.querySelector('#competitorMarket').value==='Dallas');await p.waitForLoadState('networkidle');assert(competitorUrls.some(u=>new URL(u).searchParams.get('market')==='Dallas'));assert(await p.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));await p.screenshot({path:`${dir}/competitors-${width}.png`});count++;
 await p.goto('http://127.0.0.1:8765/');if(width===390){for(const button of await p.locator('#markets .rt-mobile-disclosure-toggle').all())await button.click();await p.getByRole('button',{name:'Territory',exact:true}).click()}assert.equal(await p.locator('#marketList span').count(),6);assert((await p.locator('#markets').innerText()).includes('Dallas + Fort Worth'));assert((await p.locator('#markets').innerText()).includes('Chandler only'));assert((await p.locator('#pricing').innerText()).includes('up to 6 selected markets'));assert(await p.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));count++;
 assert.deepEqual(errors,[]);assert(!calls.some(x=>/\/leads|\/refresh/.test(x.path)));await p.close();console.log(`PASS ${width}px Dallas public/detail/account/onboarding/Saved/logout/Sources/Competitors/coverage checks`);
 }}finally{await browser.close()}
 console.log(`PASS ${count} Dallas browser scenarios (mocked services; not remote authentication evidence)`);
})().catch(e=>{console.error(e);process.exit(1)});
