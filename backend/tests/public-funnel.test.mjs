import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import worker from '../worker.js';
const workerUrl=new URL('../worker.js',import.meta.url);
const source=await readFile(workerUrl,'utf8');
const seam=source.replace(/from '(\.\/[^']+)'/g,(_,p)=>`from '${new URL(p,workerUrl).href}'`)+'\nexport {publicOpportunityTeaser};';
const {publicOpportunityTeaser}=await import('data:text/javascript;base64,'+Buffer.from(seam).toString('base64'));
const secrets=['PRIVATECO LLC','91234 Secret Blvd','PERMIT-PRIVATE-77','INTERNAL-77','raw secret scope','SOURCE-PRIVATE-77'];
const sample={id:secrets[3],market:'Fort Worth',name:secrets.join(' / '),company:secrets[0],address:secrets[1],permit:secrets[2],scope:secrets[4]+' commercial electrical HVAC tenant improvement',source:secrets[5],event_date:new Date().toISOString(),updated_at:new Date().toISOString().replace('T',' ').slice(0,19),score:80,temperature:'HOT',value:90000,categories:'["Electrical","Commercial services"]',permit_status:'Application',official_value:250000};
const fields=['id','market','name','date','score','temperature','value','categories','stage','publicPreview'].sort();
function assertTeaser(x){assert.deepEqual(Object.keys(x).sort(),fields);assert.match(x.id,/^teaser_[0-9a-f-]{36}$/);for(const secret of secrets)assert(!JSON.stringify(x).includes(secret),secret);}
const customer={id:'qa-user',email:'qa@example.test',plan:'Territory',subscription_status:'active'};
class DB{
 constructor(){this.sql=[];this.writes=[];}
 prepare(sql){this.sql.push(sql);const db=this;return {bind(...args){this.args=args;return this},async first(){
  if(sql.includes('FROM sessions'))return this.args[0]===await crypto.subtle.digest('SHA-256',new TextEncoder().encode('valid')).then(b=>Buffer.from(b).toString('hex'))?customer:null;
  if(sql.includes('FROM preferences'))return {industries:'["Electrical","Commercial services"]',markets:'["Fort Worth"]',min_score:1};
  return null;
 },async all(){
  if(sql.includes('GROUP BY market'))return {results:[{market:'Fort Worth',stored_count:12,last_stored_at:sample.updated_at,latest_event_at:sample.event_date,age_minutes:0}]};
  if(/FROM leads/.test(sql))return {results:Array.from({length:12},(_,i)=>({...sample,id:sample.id+'-'+i,permit:sample.permit+'-'+i,address:String(91234+i)+' Secret Blvd'}))};
  return {results:[]};
 },async run(){db.writes.push(sql);assert.match(sql,/UPDATE sessions/);return {success:true}}};}
}
const originalFetch=globalThis.fetch;
globalThis.fetch=async()=>{throw Error('Unexpected external fetch')};
let checks=0;
async function check(name,fn){await fn();checks++;console.log('PASS '+name)}
async function call(path,session='',opts={}){const db=new DB();const response=await worker.fetch(new Request('https://preview.invalid'+path,{headers:session?{authorization:'Bearer '+session}:{}}),{DB:db,ADMIN_TOKEN:'internal-admin',...opts});return {response,body:await response.json(),db};}
const diagnostic=['/leads','/score-audit','/temperature-calibration','/backfill-preview','/historical-coverage','/relationship-gap-candidates','/relationship-candidates','/relationship-health','/tempe-enrichment-preview','/attribution-health','/tucson-recheck-preview','/source-health'];
const existing=['/roc/meta','/roc/search','/relationships','/competitors','/dashboard','/saved','/feedback','/competitor-watchlist','/changes','/export.csv','/admin/alerts-preview','/admin/tucson-debug','/admin/scottsdale-debug','/admin/chandler-permits-debug'];
for(const prefix of ['', '/api'])for(const path of [...diagnostic,...existing])await check('anonymous blocked '+prefix+path,async()=>{
 const {response,body,db}=await call(prefix+path+'?permit='+secrets[2]+'&company='+encodeURIComponent(secrets[0]));
 assert.equal(response.status,401);assert.deepEqual(Object.keys(body),['error']);assert.equal(db.sql.length,0);for(const secret of secrets)assert(!JSON.stringify(body).includes(secret));
});
await check('expired session cannot access diagnostic records',async()=>{for(const p of diagnostic){const {response,db}=await call('/api'+p,'expired');assert.equal(response.status,401);assert(db.sql.every(s=>s.includes('FROM sessions')));assert.equal(db.writes.length,0)}});
await check('teaser uses random identity and fixed title, not source fields or polluted categories/stage',async()=>{
 const raw={...sample,categories:['PRIVATECO LLC','Electrical',secrets[2]],stage:secrets[1],permitStatus:secrets[2]};
 const a=publicOpportunityTeaser(raw),b=publicOpportunityTeaser(raw);assertTeaser(a);assertTeaser(b);assert.notEqual(a.id,b.id);assert.equal(a.name,'Commercial electrical activity');assert.deepEqual(a.categories,['Electrical']);assert.equal(a.stage,null);
 assert.equal(publicOpportunityTeaser({...raw,categories:[]}).name,'Commercial project activity');
});
for(const prefix of ['', '/api'])await check('public feed allowlist and max 8 '+prefix,async()=>{
 const {body,response,db}=await call(prefix+'/feed?markets=Fort%20Worth&limit=200');assert.equal(response.status,200);assert.equal(body.leads.length,8);assert.equal(body.counts.available,12);body.leads.forEach(assertTeaser);assert.equal(body.state,'fresh');assert.equal(db.writes.length,0);for(const secret of secrets)assert(!JSON.stringify(body).includes(secret));
});
for(const token of ['valid','internal-admin'])await check('full diagnostics remain available to '+token,async()=>{
 const {response,body}=await call('/api/leads?markets=Fort%20Worth',token);assert.equal(response.status,200);assert.equal(body.leads.length,12);assert.equal(body.leads[0].company,secrets[0]);assert(body.leads[0].scope.includes(secrets[4]));assert(body.leads[0].scoreBreakdown);assert(body.leads[0].actionIntelligence);
 const audit=await call('/api/score-audit',token);assert.equal(audit.response.status,200);
 const calibration=await call('/api/temperature-calibration',token);assert.equal(calibration.response.status,200);
});
await check('authenticated dashboard retains full records, Saved, Fort Worth and six-market entitlement',async()=>{
 const {response,body}=await call('/api/dashboard','valid');assert.equal(response.status,200);assert.equal(body.leads.length,12);assert.equal(body.leads[0].company,secrets[0]);assert.equal(body.leads[0].permit,secrets[2]+'-0');assert(body.leads[0].scoreBreakdown);assert(body.leads[0].actionIntelligence);assert.equal(body.entitlements.marketLimit,6);assert.equal(body.leads[0].saved,false);
});
const features=Array.from({length:7},(_,i)=>({attributes:{OBJECTID:i,PRE_B1_ALT_ID:secrets[2]+'-'+i,PRE_PROJ_NM:secrets.join(' / '),PRE_DTL_DESC:secrets[4]}}));
globalThis.fetch=async url=>Response.json({features:String(url).includes('/20/query')?features:[]});
for(const prefix of ['', '/api'])for(const session of ['', 'expired','valid'])await check('pipeline limit/redaction '+prefix+' '+(session||'anonymous'),async()=>{
 const {response,body}=await call(prefix+'/pipeline',session);assert.equal(response.status,200);assert.equal(body.pipeline.length,session==='valid'?7:3);
 if(session==='valid'){assert.equal(body.pipeline[0].name,features[0].attributes.PRE_PROJ_NM);assert(body.pipeline[0].scoreBreakdown)}else{body.pipeline.forEach(assertTeaser);for(const secret of secrets)assert(!JSON.stringify(body).includes(secret))}
});
await check('anonymous failed pipeline does not echo source errors or identifiers',async()=>{
 globalThis.fetch=async()=>Response.json({error:{message:secrets.join(' ')}});
 const {body}=await call('/api/pipeline');assert.equal(body.sourceStatus,'unavailable');assert.deepEqual(body.pipeline,[]);for(const secret of secrets)assert(!JSON.stringify(body).includes(secret));
});
globalThis.fetch=originalFetch;
console.log(`${checks}/${checks} public funnel checks passed; only mocked D1/network used.`);
