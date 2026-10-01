const {chromium}=require('playwright');
const assert=require('node:assert/strict');
const {mock,user}=require('./fixtures.cjs');
(async()=>{
const browser=await chromium.launch({headless:true,executablePath:process.env.RT_CHROMIUM_PATH,args:['--no-sandbox','--disable-dev-shm-usage']});
try{
for(const width of [390,1366]) for(const score of [0,40,60,75,80]){
 const p=await browser.newPage({viewport:{width,height:900},serviceWorkers:'block'});
 const errors=[];p.on('pageerror',e=>errors.push(e.message));
 await mock(p);let current={...user,preferences:{...user.preferences,minScore:score}};let saved;
 await p.route('**/api/me',r=>r.fulfill({json:{user:current}}));
 await p.route('**/api/billing/sync',r=>r.fulfill({json:{user:current}}));
 await p.route('**/api/preferences',r=>{saved=r.request().postDataJSON();current={...current,preferences:saved};return r.fulfill({json:{user:current}})});
 await p.addInitScript(()=>localStorage.setItem('revenuetrigger_session','qa-session'));
 await p.goto('http://127.0.0.1:8765/signals?account=1');
 await p.waitForSelector('#accountLoggedIn',{state:'visible'});
 assert.equal(await p.locator('#prefScore').inputValue(),String(score));
 assert.deepEqual(await p.locator('#prefScore option').evaluateAll(xs=>xs.map(x=>[x.value,x.textContent])),[['0','Any score'],['40','40+ WATCH'],['60','60+ WARM'],['75','75+ HOT'],['80','80+ HOT · strict']]);
 await p.getByRole('button',{name:'Save preferences',exact:true}).click();
 await p.waitForSelector('#accountModal.open',{state:'hidden'});
 assert.equal(saved.minScore,score);
 await p.reload();await p.waitForSelector('#accountLoggedIn',{state:'visible'});
 assert.equal(await p.locator('#prefScore').inputValue(),String(score));
 assert.equal(await p.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
 assert.deepEqual(errors,[]);
 console.log(`PASS synthetic/local: ${width}px preference ${score} loads, saves numeric value, reloads, options/overflow/errors`);
 await p.close();
}
}finally{await browser.close()}
})().catch(e=>{console.error(e);process.exitCode=1});
