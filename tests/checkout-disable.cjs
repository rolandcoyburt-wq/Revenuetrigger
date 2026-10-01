const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),cp=require('node:child_process');
const baseline='48ab8e4c0a35e7a021dc96178f089b02d249b380';
const paths=['assets/rt-app.js','sources.html','competitors.html','assets/rt-marketing.js'];
const read=(p,preview)=>preview?cp.execFileSync('git',['show',`${baseline}:frontend/public/${p}`],{encoding:'utf8'}):fs.readFileSync(`frontend/public/${p}`,'utf8');
function handler(source){const start=source.indexOf('async function buyPlan(plan){');assert(start>=0);const rest=source.slice(start);return rest.split('\n')[0].endsWith('}}')?rest.split('\n')[0]:rest.slice(0,rest.indexOf('\n}')+2);}
(async()=>{
let count=0;
for(const preview of [false,true])for(const file of paths)for(const signedIn of [false,true])for(const plan of ['Scout','Hunter','Territory']){
 let requests=0,ui=0,writes=0;const c={window:{},location:{hostname:preview?'integration-frontend-fort-worth-v1-signalhound-phoenix.rolandcoyburt.workers.dev':'revenuetrigger.ai',href:''},user:signedIn?{id:'qa'}:null,marketingUser:signedIn?{id:'qa'}:null,localStorage:{setItem(){writes++}},openSignin(){ui++},toast(){ui++},alert(){ui++},homeNotice(){ui++},authSnapshot:()=>({}),authIsCurrent:()=>true,expireSession(){throw Error("Unexpected expired session")},authHeaders:x=>x,RTAuth:{set(){writes++},token:()=>signedIn,request:async()=>{requests++;return {url:'https://checkout.stripe.test/qa'}}},fetch:async()=>{requests++;return {ok:true,json:async()=>({url:'https://checkout.stripe.test/qa'})}}};
 vm.createContext(c);vm.runInContext(read('assets/rt-config.js',preview),c);c.RTConfig=c.window.RTConfig;c.CONFIG=c.RTConfig;vm.runInContext(handler(read(file,preview)),c);await c.buyPlan(plan);
 if(signedIn){assert.equal(requests,1);assert.equal(c.location.href,'https://checkout.stripe.test/qa');assert(c.RTConfig.apiBase.includes(preview?'integration-signal-command-fort-worth-v1':'api.revenuetrigger.ai'));}
 else{assert.equal(requests,0);assert.equal(writes,1);assert(ui>=1);}
 count++;
}
console.log(`PASS ${count} cases: current and retained preview handlers preserve all plans, signed-in checkout and signed-out sign-in; no real Stripe requests.`);
})().catch(e=>{console.error(e);process.exit(1)});
