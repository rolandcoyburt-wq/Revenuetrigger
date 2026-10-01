// All API requests mocked; no production reads/writes or email delivery.
const {chromium}=require('playwright'),assert=require('node:assert/strict');
const {mock,user}=require('./fixtures.cjs');
(async()=>{
 const browser=await chromium.launch({headless:true,executablePath:process.env.RT_CHROMIUM_PATH,args:['--no-sandbox']});let count=0;
 try{for(const width of [390,1366])for(const [plan,days,markets,industries] of [['Scout',7,['Phoenix'],['Commercial services']],['Hunter',30,['Phoenix','Dallas','Fort Worth'],['Commercial services','HVAC','Electrical']],['Territory',90,['Phoenix','Tempe','Mesa','Chandler','Dallas','Fort Worth'],['Commercial services','HVAC','Electrical','Plumbing','Roofing','Landscaping','Security','Signage']]]){
  const page=await browser.newPage({viewport:{width,height:1000}});const calls=await mock(page);
  let current={...user,plan,onboardingComplete:true,preferences:{markets,industries,minScore:0},entitlements:{...user.entitlements,historyDays:days,marketLimit:markets.length,industryLimit:industries.length}},writes=[];
  await page.addInitScript(()=>localStorage.setItem('revenuetrigger_session','qa-session'));
  await page.route('**/api/me',r=>r.fulfill({json:{user:current}}));await page.route('**/api/billing/sync',r=>r.fulfill({json:{user:current}}));
  await page.route('**/api/dashboard?**',r=>{assert.equal(new URL(r.request().url()).searchParams.get('limit'),'500');return r.fulfill({json:{leads:[],plan,historyDays:days,preferences:current.preferences,entitlements:current.entitlements}})});
  await page.route('**/api/preferences',r=>{const body=r.request().postDataJSON();writes.push(body);current={...current,onboardingComplete:true,preferences:body};return r.fulfill({json:{user:current}})});
  await page.goto('http://127.0.0.1:8765/signals');await page.waitForFunction(()=>document.querySelector('#leadList').textContent.includes('Adjust preferences'));
  let text=await page.locator('#leadList').innerText();assert(text.includes(`your ${plan} preferences`));for(const m of markets)assert(text.includes(m));for(const i of industries)assert(text.includes(i));assert(text.includes('Any score'));assert(text.includes(`${days}-day history`));
  await page.getByRole('button',{name:'Adjust preferences',exact:true}).click();await page.waitForSelector('#accountModal.open');assert.equal(await page.locator('#prefScore').inputValue(),'0');
  await page.getByRole('button',{name:'Save preferences',exact:true}).click();await page.waitForSelector('#accountModal.open',{state:'hidden'});assert.equal(writes.at(-1).minScore,0);
  await page.reload();await page.waitForFunction(()=>document.querySelector('#leadList').textContent.includes('Any score'));
  // Onboarding preserves and saves all supported values, including numeric zero.
  for(const score of [0,40,60,70,75,80]){
   current={...current,onboardingComplete:false,preferences:{...current.preferences,minScore:score}};await page.reload();await page.waitForSelector('#onboardingModal.open');assert.equal(await page.locator('#onboardingScore').inputValue(),String(score));
   await page.getByRole('button',{name:'Build my feed',exact:true}).click();await page.waitForSelector('#onboardingModal.open',{state:'hidden'});assert.equal(writes.at(-1).minScore,score);
  }
  for(const score of [70,0]){
   current={...current,onboardingComplete:true,preferences:{...current.preferences,minScore:score}};
   await page.goto('http://127.0.0.1:8765/signals?account=1');await page.waitForSelector('#accountModal.open');assert.equal(await page.locator('#prefScore').inputValue(),String(score));
   if(score===70)assert.match(await page.locator('#prefScore option:checked').innerText(),/Current preference/);
   await page.getByRole('button',{name:'Save preferences',exact:true}).click();await page.waitForSelector('#accountModal.open',{state:'hidden'});assert.equal(writes.at(-1).minScore,score);
   await page.reload();await page.waitForSelector('#accountModal.open');assert.equal(await page.locator('#prefScore').inputValue(),String(score));
  }
  for(const onboarding of [false,true])for(const bad of ['', 'invalid', '100']){
   current={...current,onboardingComplete:!onboarding,preferences:{...current.preferences,minScore:70}};
   await page.goto('http://127.0.0.1:8765/signals'+(onboarding?'':'?account=1'));
   const selector=onboarding?'#onboardingScore':'#prefScore';await page.waitForSelector(selector,{state:'visible'});
   await page.locator(selector).evaluate((select,value)=>{select.add(new Option('Invalid test value',value));select.value=value},bad);
   const before=writes.length;await page.getByRole('button',{name:onboarding?'Build my feed':'Save preferences',exact:true}).click();
   assert.equal(writes.length,before);assert.equal(current.preferences.minScore,70);assert(await page.locator(onboarding?'#onboardingModal':'#accountModal').isVisible());
  }
  assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));assert(!calls.some(x=>/\/leads|\/refresh/.test(x.path)));await page.close();count++;console.log(`PASS ${plan} ${width}px: empty-state context, adjust action, Any score reload and five onboarding thresholds`);
 }}finally{await browser.close()}
 console.log(`${count}/${count} personalized frontend scenarios passed.`);
})().catch(e=>{console.error(e);process.exitCode=1});
