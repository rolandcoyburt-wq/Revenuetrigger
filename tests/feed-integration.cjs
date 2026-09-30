// Synthetic/local contract validation. Every external request is intercepted.
const {chromium}=require('playwright'),assert=require('node:assert/strict'),fs=require('fs');
const {mock,leads}=require('./fixtures.cjs');
(async()=>{
 const browser=await chromium.launch({headless:true,executablePath:process.env.RT_CHROMIUM_PATH,args:['--no-sandbox','--disable-dev-shm-usage']});
 const results=[];fs.mkdirSync('docs/redesign/screenshots/feed-states',{recursive:true});
 async function check(name,fn){try{await fn();results.push({name,status:'PASS'});console.log('PASS '+name)}catch(e){results.push({name,status:'FAIL',error:e.message});console.log('FAIL '+name+' '+e.message)}}
 async function page(width=1366){const p=await browser.newPage({viewport:{width,height:900},reducedMotion:'reduce',serviceWorkers:'block'});p.calls=await mock(p);p.errors=[];p.on('pageerror',e=>p.errors.push(e.message));return p}
 const messages={fresh:'',stale:'Updates are delayed',partial:'stale or missing data',empty:'No stored opportunities',unavailable:'temporarily unavailable'};
 for(const width of [390,1366])for(const route of ['/','/signals'])for(const state of Object.keys(messages))await check(`${route} ${state} ${width}px`,async()=>{
  const p=await page(width);let request;
  await p.route('**/api/feed?**',r=>{request=r.request();return r.fulfill({json:{ok:state!=='unavailable',readOnly:true,source:'stored_d1',state,opportunityState:state==='empty'?'empty':state==='unavailable'?'unavailable':'available',leads:['empty','unavailable'].includes(state)?[]:leads}})});
  await p.goto('http://127.0.0.1:8765'+route);await p.waitForLoadState('networkidle');
  assert(request);assert.equal(request.method(),'GET');assert.equal(request.headers().authorization,undefined);
  assert.equal(new URL(request.url()).searchParams.get('limit'),route==='/'?'3':'120');
  assert.equal(new URL(request.url()).searchParams.get('days'),'7');
  const note=p.locator(route==='/'?'#homeFeedNotice':'#publicFeedNotice');
  if(state==='fresh')assert.equal(await note.isVisible(),false);else assert((await note.innerText()).includes(messages[state]));
  assert.equal(await p.locator(route==='/'?'.rt-preview-card':'.lead').count(),['empty','unavailable'].includes(state)?0:3);
  if(route==='/signals'){
   if(state==='unavailable')assert.equal(await p.locator('#kSignals').innerText(),'—');
   await p.locator('#search').fill('does not exist');
   if(state!=='fresh')assert((await note.innerText()).includes(messages[state]));
   await p.locator('#search').fill('');
   assert(!p.calls.some(c=>c.path==='/api/source-health'));
  }
  assert(!p.calls.some(c=>c.path==='/api/leads'||c.path==='/api/dashboard'));
  assert.equal(await p.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);assert.deepEqual(p.errors,[]);
  if(state!=='fresh'){
   if(route==='/')await p.locator('#opportunities').scrollIntoViewIfNeeded();else await p.locator('#signals').scrollIntoViewIfNeeded();
   await p.screenshot({path:`docs/redesign/screenshots/feed-states/${route==='/'?'home':'signals'}-${state}-${width}.png`});
  }
  await p.close();
 });
 for(const scenario of ['http503','malformed','missing-state','partial-empty'])await check(`Honest ${scenario} response`,async()=>{
  for(const route of ['/','/signals']){
   const p=await page();await p.route('**/api/feed?**',r=>scenario==='malformed'?r.fulfill({body:'invalid JSON'}):r.fulfill({status:scenario==='http503'?503:200,json:scenario==='partial-empty'?{ok:true,state:'partial',opportunityState:'empty',leads:[]}:{leads}}));
   await p.goto('http://127.0.0.1:8765'+route);await p.waitForLoadState('networkidle');
   assert.equal(await p.locator(route==='/'?'.rt-preview-card':'.lead').count(),0);
   assert((await p.locator(route==='/'?'#homeFeedNotice':'#publicFeedNotice').innerText()).includes(scenario==='partial-empty'?'stale or missing data':'unavailable'));
   await p.close();
  }
 });
 await check('Signed-in dashboard contract unchanged',async()=>{
  const p=await page();await p.addInitScript(()=>localStorage.setItem('revenuetrigger_session','qa-session'));
  await p.goto('http://127.0.0.1:8765/signals');await p.waitForLoadState('networkidle');
  assert(p.calls.some(c=>c.path==='/api/dashboard'&&c.method==='GET'&&c.query==='?limit=200'&&c.auth==='Bearer qa-session'));
  assert(!p.calls.some(c=>c.path==='/api/feed'||c.path==='/api/leads'));assert.equal(await p.locator('#publicFeedNotice').isVisible(),false);assert.equal(await p.locator('.lead').count(),3);await p.close();
 });
 await check('Slow previous market cannot replace latest selection',async()=>{
  const p=await page();let release,started;
  const slowStarted=new Promise(resolve=>started=resolve);
  await p.route('**/api/feed?**',async r=>{
   const market=new URL(r.request().url()).searchParams.get('markets');
   if(market==='Phoenix'){started();await new Promise(resolve=>release=resolve)}
   await r.fulfill({json:{ok:true,state:market==='Phoenix'?'stale':'fresh',opportunityState:'available',leads:market?leads.filter(x=>x.market===market):leads}});
  });
  await p.goto('http://127.0.0.1:8765/signals');await p.waitForSelector('.lead');
  await p.locator('#market').selectOption('Phoenix');await slowStarted;
  await p.locator('#market').selectOption('Tempe');await p.waitForFunction(()=>document.querySelector('#feedStatus').textContent.includes('Tempe'));
  const done=p.waitForResponse(r=>r.url().includes('markets=Phoenix'));release();await done;
  await p.waitForLoadState('networkidle');assert.match(await p.locator('#feedStatus').innerText(),/Stored opportunities.*Tempe/);assert.equal(await p.locator('#publicFeedNotice').isVisible(),false);await p.close();
 });
 await check('Long text and sparse intelligence remain readable on mobile',async()=>{
  const p=await page(390);await p.goto('http://127.0.0.1:8765/');await p.waitForLoadState('networkidle');
  const result=await p.evaluate(()=>{
   const record={id:'long-qa',name:'Synthetic QA commercial project with an unusually long permit title and extensive interior improvements',company:'Synthetic QA contractor with a very long company name '+ 'A'.repeat(90),market:'Phoenix',score:75,temperature:'HOT',categories:['HVAC','Electrical','Plumbing'],value:38000};
   document.querySelector('#signalPreviews').innerHTML=RTUI.opportunityCard(record,{preview:true});
   document.querySelector('#decisionDemo').innerHTML=RTUI.decision(record);
   return {decision:RTUI.decision({}),timeline:RTUI.triggerTimeline({}),overflow:document.documentElement.scrollWidth>innerWidth};
  });assert.equal(result.decision,'');assert.equal(result.timeline,'');assert.equal(result.overflow,false);await p.close();
 });
 await browser.close();fs.writeFileSync('docs/redesign/feed-test-results.json',JSON.stringify({validation:'synthetic/local; no production requests',coreContract:'e1ce8d50544944caef5453ba46812b441fa37d57',results},null,2));
 if(results.some(x=>x.status==='FAIL'))process.exitCode=1;
})();
