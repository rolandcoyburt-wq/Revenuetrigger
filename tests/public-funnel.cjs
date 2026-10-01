// Executes the real app/format/UI/auth scripts in a minimal DOM, with delayed HTTP responses.
// No browser, municipal, Stripe, production API or D1 requests are made.
const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const read=f=>fs.readFileSync('frontend/public/assets/'+f,'utf8');
const privileged={id:'private-permit-id',company:'SECRET COMPANY LLC',name:'SECRET PROJECT',address:'123 Secret Rd',scope:'SECRET SCOPE',market:'Fort Worth',score:80,temperature:'HOT',value:90000,categories:['Electrical'],stage:'APPLICATION',permit:'PRIVATE-77',date:new Date().toISOString()};
const teaser={id:'teaser_opaque',name:'Commercial electrical activity',market:'Fort Worth',score:80,temperature:'HOT',value:90000,categories:['Electrical'],stage:'APPLICATION',publicPreview:true};
const account={email:'qa@example.test',plan:'Territory',subscriptionStatus:'active',entitlements:{marketLimit:6,industryLimit:8},preferences:{markets:['Fort Worth'],industries:['Electrical']}};
function deferred(){let resolve;const promise=new Promise(r=>resolve=r);return {promise,resolve}}
const response=(body,status=200)=>({ok:status<400,status,json:async()=>body});
function harness(){
 const nodes=new Map(),storage=new Map(),calls=[];
 function element(selector){if(nodes.has(selector))return nodes.get(selector);let content='';const classes=new Set();
  const el={value:({'#market':'all','#industry':'all','#minScore':'0','#sortFeed':'score','#savedFilter':'all','#pipelineStage':'all','#pipelineMinScore':'0'})[selector]||'',hidden:false,dataset:{},style:{setProperty(){}},
   get innerHTML(){return content},set innerHTML(v){content=v},get textContent(){return content},set textContent(v){content=v},
   classList:{add:x=>classes.add(x),remove:x=>classes.delete(x),contains:x=>classes.has(x),toggle(x,on){on?classes.add(x):classes.delete(x)}},
   closest:s=>element(selector+' '+s),setAttribute(k,v){this[k]=v},getAttribute(k){return this[k]},querySelectorAll:()=>[],addEventListener(){},focus(){},scrollIntoView(){}};
  nodes.set(selector,el);return el;
 }
 const c={console,Date,Intl,URL,URLSearchParams,Response,Promise,setTimeout:()=>0,clearTimeout(){},location:{search:'',hash:'',pathname:'/signals'},history:{replaceState(){}},document:{querySelector:element,querySelectorAll:()=>[],getElementById:id=>element('#'+id),documentElement:element('html'),body:element('body')},localStorage:{getItem:k=>storage.get(k)||null,setItem:(k,v)=>storage.set(k,v),removeItem:k=>storage.delete(k)},matchMedia:()=>({matches:false}),addEventListener(){}};
 c.window=c;
 c.handle=async(url,options)=>{
  const path=new URL(url).pathname;
  if(path.endsWith('/feed'))return response({ok:true,state:'fresh',leads:[teaser],counts:{available:20,publicReturned:1},publicPreview:true});
  if(path.endsWith('/pipeline'))return response({ok:true,pipeline:[teaser],publicPreview:true,sourceStatus:'live'});
  if(path.endsWith('/changes-teaser'))return response({opportunities:20});
  if(path.endsWith('/logout'))return response({ok:true});
  throw Error('Unexpected '+path);
 };
 c.fetch=async(url,options={})=>{calls.push({url,options});return c.handle(url,options)};
 vm.createContext(c);
 for(const f of ['rt-config.js','rt-format.js','rt-auth.js','rt-ui.js'])vm.runInContext(read(f),c);
 // Suppress only page bootstrap; all request, state and rendering functions are unmodified.
 const source=read('rt-app.js'),start=source.lastIndexOf('(async()=>{'),end=source.indexOf('})();',start)+5;
 vm.runInContext(source.slice(0,start)+source.slice(end),c);
 const run=s=>vm.runInContext(s,c);
 c.privileged=privileged;c.account=account;
 function signedIn(){storage.set('revenuetrigger_session','valid');run('user=account;leads=[privileged];pipelineRows=[privileged];currentLead=privileged;render();renderPipeline();openLead(privileged.id);openPipelineLead(privileged.id)')}
 function safe(){assert.equal(run('user'),null);assert.equal(run('currentLead'),null);assert.equal(storage.size,0);assert(!JSON.stringify(run('[leads,pipelineRows,currentFeedback]')).includes('SECRET'));for(const id of ['#mTitle','#mGrid','#mWhy','#pTitle','#pGrid','#pWhy'])assert.equal(element(id).textContent,'',id);for(const id of ['#leadModal','#pipelineModal'])assert(!element(id).classList.contains('open'));for(const id of ['#leadList','#pipelineList','#changedMoves'])assert(!element(id).innerHTML.includes('SECRET'),id)}
 return {c,run,element,calls,signedIn,safe};
}
let checks=0;async function check(name,fn){let timer;try{await Promise.race([fn(),new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error('Unsettled test: '+name)),3000)})]);checks++;console.log('PASS '+name)}finally{clearTimeout(timer)}}
(async()=>{
 await check('logout clears memory, rendered rows and open detail immediately, even before logout HTTP resolves',async()=>{
  const h=harness();h.signedIn();const pending=deferred(),normal=h.c.handle;h.c.handle=(u,o)=>u.endsWith('/logout')?pending.promise:normal(u,o);
  const done=h.run('logout()');h.safe();await Promise.resolve();assert(h.calls.some(x=>x.url.includes('/feed')));assert(h.calls.some(x=>x.url.includes('/pipeline')&&!x.options.headers));pending.resolve(response({ok:true}));await done;h.safe();assert.equal(h.run('pipelineRows.length'),1);assert.equal(h.run('leads.length'),1);
 });
 for(const route of ['dashboard','pipeline'])for(const phase of ['headers','body'])await check(`${route} authenticated ${phase} completion after logout cannot restore detail`,async()=>{
  const h=harness();h.signedIn();const pending=deferred(),normal=h.c.handle;
  h.c.handle=(u,o)=>u.includes('/'+route)&&o.headers?.Authorization?phase==='headers'?pending.promise:{ok:true,status:200,json:()=>pending.promise}:normal(u,o);
  const request=h.run(route==='dashboard'?'loadDashboard()':'loadPipeline()');await new Promise(setImmediate);const out=h.run('logout()');h.safe();await out;
  const payload=route==='dashboard'?{leads:[privileged]}:{pipeline:[privileged],sourceStatus:'live'};
  pending.resolve(phase==='headers'?response(payload):payload);await request;h.safe();assert.equal(h.run('leads[0].publicPreview'),true);assert.equal(h.run('pipelineRows[0].publicPreview'),true);
 });
 for(const route of ['dashboard','me','pipeline'])await check(`expired ${route} session safely reloads both anonymous previews`,async()=>{
  const h=harness();h.signedIn();const normal=h.c.handle;h.c.handle=(u,o)=>u.includes('/'+route)&&o.headers?.Authorization?response({error:'unauthorized'},401):normal(u,o);
  await h.run(({dashboard:'loadDashboard()',me:'loadMe()',pipeline:'loadPipeline()'})[route]);h.safe();assert.equal(h.run('leads[0].publicPreview'),true);assert.equal(h.run('pipelineRows[0].publicPreview'),true);
 });
 await check('pipeline anonymous response for an expired token removes existing dashboard data',async()=>{const h=harness();h.signedIn();await h.run('loadPipeline()');h.safe();assert.equal(h.run('leads[0].publicPreview'),true)});
 for(const route of ['me','billing/sync','preferences','changes'])await check('late '+route+' response cannot restore user or privileged changes',async()=>{
  const h=harness();h.signedIn();const pending=deferred(),normal=h.c.handle;h.c.handle=(u,o)=>new URL(u).pathname==='/api/'+route?pending.promise:normal(u,o);
  if(route==='preferences')h.c.document.querySelectorAll=()=>[{value:'Electrical'}];
  const task=h.run(({'me':'loadMe()','billing/sync':'syncBilling()','preferences':'savePreferences()','changes':'loadChanges()'})[route]);await h.run('logout()');pending.resolve(response({user:account,summary:{opportunities:4},competitorMoves:[{title:'SECRET COMPANY LLC'}]}));await task;h.safe();
 });
 await check('authenticated dashboard retains detail and six selected-market entitlement',async()=>{const h=harness();h.signedIn();h.c.handle=async()=>response({leads:[privileged]});await h.run('loadDashboard()');assert.equal(h.run('leads[0].company'),privileged.company);assert.equal(h.run('user.entitlements.marketLimit'),6)});
 for(const state of ['fresh','stale','partial','empty','unavailable'])await check('anonymous feed preserves '+state+' state and label',async()=>{const h=harness();h.c.handle=async()=>response({ok:state!=='unavailable',state,leads:['empty','unavailable'].includes(state)?[]:[teaser]},state==='unavailable'?503:200);await h.run('loadPublic()');assert.equal(h.run('publicFeed.state'),state);assert(h.element('#feedStatus').textContent.startsWith(h.run('publicFeed.label')));assert(!h.element('#feedStatus').textContent.includes('Live preview'))});
 await check('remaining aggregate count does not claim client-side filter matching',async()=>{const h=harness();await h.run('loadPublic()');const before=h.element('#publicFeedGateCount').textContent;h.element('#search').value='no matching records';h.run('render()');assert.equal(h.element('#publicFeedGateCount').textContent,before);assert.equal(before,'19 additional opportunities detected across this market window.')});
 await check('Reveal only opens sign-in while anonymous',async()=>{const h=harness();await h.run('loadPublic()');h.run('openLead(leads[0].id);openPipelineLead("unknown")');assert(h.element('#signinModal').classList.contains('open'));assert(!h.element('#leadModal').classList.contains('open'));assert(!h.element('#pipelineModal').classList.contains('open'))});
 await check('encoding normalization and phone redaction remain intact',async()=>{const h=harness();assert.equal(h.c.RTFormat.normalizeDisplayText('A ΓÇö B [PHONE REDACTED]'),'A — B [PHONE REDACTED]');assert.equal(h.c.RTFormat.normalizeDisplayText('Normal café — 日本語 [PHONE REDACTED]'),'Normal café — 日本語 [PHONE REDACTED]')});
 console.log(`${checks}/${checks} frontend funnel checks passed.`);
})().catch(e=>{console.error(e);process.exit(1)});
