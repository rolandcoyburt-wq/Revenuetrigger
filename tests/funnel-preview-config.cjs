const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),cp=require('node:child_process');
const frontend='feature-public-opportunity-funnel-v1-signalhound-phoenix.rolandcoyburt.workers.dev';
const backend='https://feature-public-opportunity-funnel-v1-signalhound-api.rolandcoyburt.workers.dev/api';
for(const [host,api] of [[frontend,backend],['7024dabd-signalhound-phoenix.rolandcoyburt.workers.dev',backend],['signalhound-phoenix.rolandcoyburt.workers.dev','https://api.revenuetrigger.ai/api'],['revenuetrigger.ai','https://api.revenuetrigger.ai/api']]){
 const c={window:{},location:{hostname:host}};vm.runInNewContext(fs.readFileSync('frontend/public/assets/rt-config.js','utf8'),c);assert.equal(c.window.RTConfig.apiBase,api);assert.equal(c.window.RTConfig.checkoutDisabled,false);assert(c.window.RTConfig.markets.includes('Fort Worth'));assert(!c.window.RTConfig.markets.includes('Dallas'));
}
const current=fs.readFileSync('backend/wrangler.toml','utf8');
const baseline=cp.execFileSync('git',['show','c2b5b5d9750cd9b4e108807449f38d6d9b9f66d4:backend/wrangler.toml'],{encoding:'utf8'});
assert.equal(current.split('[previews.vars]')[0],baseline.split('[previews.vars]')[0]);
const preview=current.split('[previews.vars]')[1];
assert(preview.includes('ALLOWED_ORIGIN = "https://'+frontend+'"'));assert(preview.includes('FRONTEND_URL = "https://'+frontend+'"'));
assert(preview.includes('database_name = "revenuetrigger-preview"'));assert(preview.includes('3e002252-2664-496f-a77f-a3a9880274d8'));assert(!preview.includes('5b0156dc-1646-4233-abf7-5d65ef30a317'));
for(const key of ['STRIPE_PRICE_SCOUT','STRIPE_PRICE_HUNTER','STRIPE_PRICE_TERRITORY','BILLING_CHECKOUT_DISABLED','DEV_AUTH_BYPASS'])assert.equal(preview.match(new RegExp(key+' = .*'))[0],baseline.split('[previews.vars]')[1].match(new RegExp(key+' = .*'))[0]);
console.log('PASS matching feature API/origins, preview-only D1, unchanged production config, checkout/Price IDs, Fort Worth and Dallas exclusion');
