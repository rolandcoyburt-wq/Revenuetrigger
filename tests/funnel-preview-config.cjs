const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),cp=require('node:child_process');
const frontend='integration-frontend-dallas-v1-signalhound-phoenix.rolandcoyburt.workers.dev';
const backend='https://cfe9680c-signalhound-api.rolandcoyburt.workers.dev/api';
const base='22d1d58dbbf69eee46c979177824ef9ac8cda5af';
for(const [host,api] of [[frontend,backend],['7024dabd-signalhound-phoenix.rolandcoyburt.workers.dev',backend],['signalhound-phoenix.rolandcoyburt.workers.dev','https://api.revenuetrigger.ai/api'],['revenuetrigger.ai','https://api.revenuetrigger.ai/api']]){
 const c={window:{},location:{hostname:host}};vm.runInNewContext(fs.readFileSync('frontend/public/assets/rt-config.js','utf8'),c);assert.equal(c.window.RTConfig.apiBase,api);assert.equal(c.window.RTConfig.checkoutDisabled,false);assert(c.window.RTConfig.markets.includes('Fort Worth'));assert(c.window.RTConfig.markets.includes('Dallas'));assert.equal(c.window.RTConfig.markets.length,8);
}
// Backend bindings/config and runtime are untouched on this frontend branch.
// The pinned backend's runtime CORS/auth-return settings require separate remote validation.
for(const path of ['backend/wrangler.toml','backend/worker.js','frontend/wrangler.toml'])assert.equal(fs.readFileSync(path,'utf8'),cp.execFileSync('git',['show',base+':'+path],{encoding:'utf8'}));
assert.match(fs.readFileSync('backend/worker.js','utf8'),/Territory:\{[^}]*marketLimit:6/);
const app=fs.readFileSync('frontend/public/assets/rt-app.js','utf8');assert.match(app,/pipeline\?market=Chandler/);assert(!/\/leads\?|\/refresh/.test(app));
console.log('PASS 4 host mappings, Dallas/Fort Worth distinct, unchanged backend and production bindings, Territory six-market cap, Chandler-only pipeline');
