// Genuine sanitized D1 fields, served only through intercepted local test responses.
// UI aliases below mirror field names; no invented intelligence or altered source strings.
const {chromium}=require('playwright'),assert=require('node:assert/strict'),fs=require('fs'),vm=require('vm');
const {mock}=require('./fixtures.cjs');
const rows=require('./fixtures/arizona-display.json');
const context={window:{}};vm.runInNewContext(fs.readFileSync('frontend/public/assets/rt-format.js','utf8'),context);
const F=context.window.RTFormat;
const original=JSON.stringify(rows);
assert.equal(F.normalizeDisplayText('A ΓÇö B ΓÇö C'),'A — B — C');
assert.equal(F.normalizeDisplayText('3/4ΓÇ¥ steel'),'3/4” steel');
const utf8='Normal UTF-8 — – “café” Γ Ελληνικά • 日本語 [PHONE REDACTED]';
assert.equal(F.normalizeDisplayText(utf8),utf8);
assert.equal(F.normalizeDisplayText('[PHONE REDACTED]'),'[PHONE REDACTED]');
assert.equal(F.displayCompanyName('MASTEC - [PHONE REDACTED]'),'Mastec - [PHONE REDACTED]');
assert.equal(F.sentenceCasePermit('CELLULAR ΓÇö [PHONE REDACTED]'),'Cellular — [PHONE REDACTED]');
for(const row of rows){for(const key of ['name','scope','source','company','address'])assert(!F.normalizeDisplayText(row[key]).includes('ΓÇ'));}
assert.equal(JSON.stringify(rows),original);
console.log('PASS exact mappings, UTF-8, redaction, genuine fields and immutable inputs');
(async()=>{
 const browser=await chromium.launch({headless:true,executablePath:process.env.RT_CHROMIUM_PATH,args:['--no-sandbox','--disable-dev-shm-usage']});
 const dir='docs/redesign/screenshots/encoding';fs.mkdirSync(dir,{recursive:true});
 try{
 for(const width of [390,1366])for(const market of ['Mesa','Scottsdale','Chandler']){
  const row=rows.find(x=>x.market===market),lead={...row,categories:JSON.parse(row.categories),date:row.event_date,permitStatus:row.permit_status,officialPermitValue:row.official_value};
  const page=await browser.newPage({viewport:{width,height:1000},serviceWorkers:'block'});const calls=await mock(page);
  await page.addInitScript(()=>localStorage.setItem('revenuetrigger_session','qa-session'));
  await page.route('**/api/dashboard?**',r=>r.fulfill({json:{leads:[lead]}}));
  await page.goto('http://127.0.0.1:8765/signals');await page.waitForSelector('.lead');
  assert(!(await page.locator('.lead').innerText()).includes('ΓÇ'));
  if(market==='Scottsdale')assert((await page.locator('.lead').innerText()).includes('[PHONE REDACTED]'));
  await page.locator('#leadList .view').click();await page.locator('#leadModal').waitFor({state:'visible'});
  assert((await page.locator('#mWhy').textContent()).includes(F.normalizeDisplayText(row.scope)));
  const source=page.locator('#mGrid .detail').filter({has:page.locator('small',{hasText:/^Source$/})}).locator('strong');
  assert.equal(await source.innerText(),F.normalizeDisplayText(row.source));
  assert(!(await page.locator('#leadModal').innerText()).includes('ΓÇ'));
  const layout=await page.evaluate(()=>{const el=document.querySelector('#mWhy'),r=el.getBoundingClientRect();const range=document.createRange();range.setStart(el.childNodes[2],0);range.setEnd(el.childNodes[2],el.childNodes[2].length);return {fits:el.scrollWidth<=el.clientWidth+1,page:document.documentElement.scrollWidth<=innerWidth,lines:range.getClientRects().length,width:r.width}});
  assert(layout.fits&&layout.page);if(market!=='Scottsdale')assert(layout.lines>1,'long description wraps into multiple lines');
  await page.screenshot({path:`${dir}/${market.toLowerCase()}-${width}.png`});
  await page.locator('#mWhy').scrollIntoViewIfNeeded();await page.screenshot({path:`${dir}/${market.toLowerCase()}-description-${width}.png`});
  assert(!calls.some(x=>x.path==='/api/leads'));await page.close();console.log(`PASS genuine ${market} detail/source/wrapping ${width}px`);
 }
 // Deliberately synthetic fields exercise display boundaries absent from the raw fixture schema.
 const page=await browser.newPage();await mock(page);await page.goto('http://127.0.0.1:8765/');await page.waitForLoadState('networkidle');
 const rendered=await page.evaluate(()=>{const x={name:'Café ΓÇö phase two',address:'Road ΓÇö east',company:'Acme ΓÇö LLC',actionIntelligence:{whyNow:'Scope ΓÇö active',nextBestAction:{action:'Review ΓÇö permit',reason:'Check ΓÇö source'}}};return {card:RTUI.opportunityCard(x,{preview:true}),decision:RTUI.decision(x),escape:RTUI.esc('<script>ΓÇö</script>')}});
 assert(!rendered.card.includes('ΓÇ'));assert(rendered.card.includes('Road — east'));assert(rendered.card.includes('Café — phase two'));assert(rendered.card.includes('Acme — LLC'));assert(!rendered.decision.includes('ΓÇ'));assert(rendered.decision.includes('Scope — active'));assert.equal(rendered.escape,'&lt;script&gt;—&lt;/script&gt;');
 assert.equal(JSON.stringify(rows),original);console.log('PASS shared homepage/intelligence display, escaping, immutable fixture values');await page.close();
 }finally{await browser.close()}
})().catch(e=>{console.error(e);process.exit(1)});
