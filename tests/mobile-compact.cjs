const {chromium}=require('playwright'),assert=require('node:assert/strict');
const {mock}=require('./fixtures.cjs');
(async()=>{
 const browser=await chromium.launch({executablePath:process.env.RT_CHROMIUM_PATH,headless:true,args:['--no-sandbox']});
 try{for(const width of [390,700,1366])for(const route of ['/','/signals','/sources','/competitors']){
  const p=await browser.newPage({viewport:{width,height:844}});await mock(p);const errors=[];p.on('pageerror',e=>errors.push(e.message));
  await p.goto('http://127.0.0.1:8765'+route);await p.waitForTimeout(350);
  const mobile=width<=700;
  if(route==='/competitors')assert(await p.locator('.rt-market-row').evaluateAll(rows=>rows.every(row=>getComputedStyle(row,'::after').content==='none')));
  assert.equal(await p.locator('.pricing .price:visible').count(),mobile?1:3);
  if(mobile){
   assert.match(await p.locator('.pricing .price:visible h3').innerText(),/Hunter/);
   await p.getByRole('button',{name:'Scout',exact:true}).click();assert.match(await p.locator('.pricing .price:visible h3').innerText(),/Scout/);
   await p.getByRole('button',{name:'Compare all plans'}).click();assert.equal(await p.locator('.pricing .price:visible').count(),3);
   await p.getByRole('button',{name:'Show one plan'}).click();await p.getByRole('button',{name:'Hunter',exact:true}).click();
   if(route==='/sources'){assert.equal(await p.locator('.source .rt-mobile-disclosure-body:visible').count(),0);await p.getByRole('button',{name:'Source details'}).first().click();assert.equal(await p.locator('.source .rt-mobile-disclosure-body:visible').count(),1)}
   if(route==='/signals'){assert(!(await p.locator('#market').isVisible()));await p.locator('.rt-mobile-filter-toggle').click();await p.locator('#market').selectOption('Dallas');await p.locator('.rt-mobile-filter-toggle').click();assert.match(await p.locator('.rt-mobile-filter-toggle').innerText(),/Dallas/)}
   if(width===390&&route==='/'){await p.locator('#pricing').scrollIntoViewIfNeeded();await p.screenshot({path:'/tmp/mobile-plans.png'});await p.locator('#markets').scrollIntoViewIfNeeded();await p.screenshot({path:'/tmp/mobile-coverage.png'})}
   if(width===390&&route==='/sources'){await p.locator('#sources').scrollIntoViewIfNeeded();await p.screenshot({path:'/tmp/mobile-sources.png'})}
   await p.setViewportSize({width:1366,height:900});assert.equal(await p.locator('.pricing .price:visible').count(),3);assert.equal(await p.locator('.rt-mobile-disclosure-body:visible').count(),await p.locator('.rt-mobile-disclosure-body').count());await p.setViewportSize({width,height:844});
  }
  assert(await p.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));assert.deepEqual(errors,[]);
  console.log('PASS '+width+' '+route);await p.close();
 }}finally{await browser.close()}
})().catch(e=>{console.error(e);process.exitCode=1});
