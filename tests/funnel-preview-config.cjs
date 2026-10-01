// Run from the combined Dallas backend + frontend release tree.
// No network requests, credentials, D1 writes or deployments.
const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),cp=require('node:child_process');
const approvedBackend='0e3a1d500173c701a874f9b6f56de6f8e7a3d56e';
const frontend='integration-frontend-dallas-v1-signalhound-phoenix.rolandcoyburt.workers.dev';
const backend='https://278f022f-signalhound-api.rolandcoyburt.workers.dev/api';
const read=p=>fs.readFileSync(p,'utf8');
const approved=p=>cp.execFileSync('git',['show',approvedBackend+':'+p],{encoding:'utf8'});
let checks=0;function check(name,fn){fn();checks++;console.log('PASS '+name)}
// Parse only the quoted scalar settings used by these assertions, within exact TOML sections.
function section(toml,header){
 const lines=toml.split(/\r?\n/),start=lines.findIndex(x=>x.trim()===header);assert(start>=0,'Missing '+header);
 const values={};for(const line of lines.slice(start+1)){if(line.trim().startsWith('['))break;const m=line.match(/^\s*(\w+)\s*=\s*"([^"]*)"\s*(?:#.*)?$/);if(m){assert(!(m[1] in values),'Duplicate '+m[1]);values[m[1]]=m[2]}}return values;
}
let previewConfig;
for(const [host,api] of [[frontend,backend],['e73d6d43-signalhound-phoenix.rolandcoyburt.workers.dev',backend],['signalhound-phoenix.rolandcoyburt.workers.dev','https://api.revenuetrigger.ai/api'],['revenuetrigger.ai','https://api.revenuetrigger.ai/api']])check('API selection: '+host,()=>{
 const c={window:{},location:{hostname:host}};vm.runInNewContext(read('frontend/public/assets/rt-config.js'),c);assert.equal(c.window.RTConfig.apiBase,api);assert.equal(c.window.RTConfig.checkoutDisabled,false);if(host===frontend)previewConfig=c.window.RTConfig;
});
check('approved Dallas backend runtime is present',()=>{
 const paths=cp.execFileSync('git',['ls-tree','-r','--name-only',approvedBackend,'backend'],{encoding:'utf8'}).trim().split('\n').filter(p=>p.endsWith('.js')&&!p.includes('/tests/'));
 assert(paths.includes('backend/markets/dfw/dallas-now.js'));
 for(const path of paths)assert.equal(read(path),approved(path),'Runtime differs from approved Dallas backend: '+path);
});
const toml=read('backend/wrangler.toml'),baseline=approved('backend/wrangler.toml');
const production=section(toml,'[vars]'),preview=section(toml,'[previews.vars]');
check('matching preview CORS and auth/Stripe return origin',()=>{for(const key of ['ALLOWED_ORIGIN','FRONTEND_URL'])assert.equal(preview[key],'https://'+frontend)});
check('preview D1 isolation',()=>assert.deepEqual(section(toml,'[[previews.d1_databases]]'),{binding:'DB',database_name:'revenuetrigger-preview',database_id:'3e002252-2664-496f-a77f-a3a9880274d8'}));
check('production D1 and origins unchanged',()=>{
 assert.deepEqual(section(toml,'[[d1_databases]]'),{binding:'DB',database_name:'signalhound',database_id:'5b0156dc-1646-4233-abf7-5d65ef30a317'});
 for(const key of ['ALLOWED_ORIGIN','FRONTEND_URL'])assert.equal(production[key],'https://revenuetrigger.ai');
 assert.deepEqual(production,section(baseline,'[vars]'));
});
check('approved sandbox Price IDs and billing/auth configuration unchanged',()=>{
 for(const header of ['[vars]','[previews.vars]']){const actual=section(toml,header),expected=section(baseline,header);for(const key of ['STRIPE_PRICE_SCOUT','STRIPE_PRICE_HUNTER','STRIPE_PRICE_TERRITORY','BILLING_CHECKOUT_DISABLED','DEV_AUTH_BYPASS'])assert.equal(actual[key],expected[key],header+' '+key)}
 assert(!/sk_(?:live|test)_|whsec_/.test(toml),'Secrets must remain outside committed config');
 // Deployed Stripe secret mode is covered by the completed remote validation, not readable here.
});
const worker=read('backend/worker.js'),app=read('frontend/public/assets/rt-app.js');
check('Dallas and Fort Worth are distinct live markets on both sides',()=>{
 const match=worker.match(/const LIVE_MARKETS=(\[[^;]+\]);/);assert(match);const live=vm.runInNewContext(match[1]);
 for(const market of ['Dallas','Fort Worth']){assert.equal(live.filter(m=>m===market).length,1);assert.equal(previewConfig.markets.filter(m=>m===market).length,1)}
 assert.match(worker,/Dallas:\{status:'live'/);assert.match(worker,/'Fort Worth':\{status:'live'/);
});
check('Territory remains capped at six selected markets',()=>assert.match(worker,/Territory:\{[^}]*marketLimit:6\b/));
check('Early Pipeline remains Chandler-only',()=>{assert.match(app,/pipeline\?market=Chandler/);assert.match(worker,/if\(market!=='Chandler'\)return json\(\{error:'pipeline market not supported'/)});
check('public funnel limits remain eight opportunities and three pipeline teasers',()=>{
 assert.match(worker,/const publicLimit=Math\.min\(requestedLimit,8\)/);assert.match(worker,/slice\(0,publicLimit\)\.map\(publicOpportunityTeaser\)/);
 assert.match(worker,/pipeline:rows\.slice\(0,3\)\.map\(publicOpportunityTeaser\)/);assert.match(app,/days=7&limit=8/);assert(!/\/leads\?|\/refresh/.test(app));
});
console.log(`${checks}/${checks} combined Dallas release configuration checks passed.`);
