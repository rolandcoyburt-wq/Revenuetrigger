import assert from 'node:assert/strict';
import worker from '../worker.js';
const stripeCalls=[];
globalThis.fetch=async(url,options)=>{assert.equal(url,'https://api.stripe.com/v1/checkout/sessions');stripeCalls.push({url,options});return Response.json({url:'https://checkout.stripe.test/qa'});};
const DB={prepare(sql){return {bind(){return this},async first(){assert(sql.includes('FROM sessions'));return {id:'qa-user',email:'qa@example.test'}},async run(){assert(sql.includes('UPDATE sessions'));return {success:true}}}}};
for(const disabled of ['true','false'])for(const path of ['/api/billing/checkout','/billing/checkout'])for(const plan of ['Scout','Hunter','Territory']){
 const before=stripeCalls.length;
 const env={DB,BILLING_CHECKOUT_DISABLED:disabled,STRIPE_SECRET_KEY:'sk_test_mock',STRIPE_PRICE_SCOUT:'price_qa_scout',STRIPE_PRICE_HUNTER:'price_qa_hunter',STRIPE_PRICE_TERRITORY:'price_qa_territory',FRONTEND_URL:disabled==='true'?'https://revenuetrigger.ai':'https://integration-frontend-fort-worth-v1-signalhound-phoenix.rolandcoyburt.workers.dev'};
 const response=await worker.fetch(new Request('https://api.example.test'+path,{method:'POST',headers:{authorization:'Bearer qa-session','content-type':'application/json'},body:JSON.stringify({plan})}),env);
 assert.equal(response.status,disabled==='true'?403:200);
 if(disabled==='true'){assert.equal(stripeCalls.length,before);assert.deepEqual(await response.json(),{error:'checkout_disabled'});}
 else{assert.equal(stripeCalls.length,before+1);const params=new URLSearchParams(stripeCalls.at(-1).options.body);assert.equal(params.get('success_url'),env.FRONTEND_URL+'/?billing=success');assert.equal(params.get('metadata[plan]'),plan);assert.equal((await response.json()).url,'https://checkout.stripe.test/qa');}
}
console.log('PASS 12 authenticated Worker route cases: disabled flag rejects every plan without contacting Stripe; enabled flag creates sandbox checkout requests. Stripe/D1 are mocked.');
