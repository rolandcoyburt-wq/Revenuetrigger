// Explicitly invoked network validation. No credentials, D1 access or deployment.
import assert from 'node:assert/strict';
import {fetchDallasNowBuildingRecords} from '../markets/dfw/dallas-now.js';
const records=await fetchDallasNowBuildingRecords({days:7,fetchFn:(url,options)=>fetch(url,{...options,signal:AbortSignal.timeout(90000)})});
assert(records.length>0,'Genuine Dallas reports unexpectedly empty; manual review required');
for(const record of records){
  assert(Number.isFinite(Date.parse(record.eventDate)));
  assert(record.sourceObservations.length>0);
  assert.match(record.secondaryFingerprint,/^dallas-v1:/);
  assert(record.sourceUrl,'DallasNow detail provenance missing');
  assert(record.participants.every(x=>x.role==='applicant'||x.role==='applicant_contact'));
}
console.log(JSON.stringify({genuineDallasRecords:records.length,meta:records._meta,reports:records._reports,provenanceValidated:true,remoteD1Writes:0,deployments:0},null,2));

const preview='https://integration-dallas-market-v2-signalhound-api.rolandcoyburt.workers.dev/api';
const allowed=['id','market','name','date','score','temperature','value','categories','stage','publicPreview'].sort();
for(const markets of ['Dallas','Dallas,Fort Worth']){
  const response=await fetch(`${preview}/feed?markets=${encodeURIComponent(markets)}&days=7&limit=20`);
  assert.equal(response.status,200);
  const body=await response.json();
  assert(['fresh','stale','partial','empty','unavailable'].includes(body.state));
  assert(body.leads.length<=8);
  for(const lead of body.leads){assert.deepEqual(Object.keys(lead).sort(),allowed);assert.match(lead.id,/^teaser_[0-9a-f-]{36}$/);}
  console.log(JSON.stringify({preview,markets,state:body.state,count:body.leads.length,available:body.counts.available,sanitized:true}));
}
for(const path of ['/leads','/score-audit','/temperature-calibration']){
  const response=await fetch(preview+path+'?markets=Dallas');
  assert.equal(response.status,401);
  assert.deepEqual(Object.keys(await response.json()),['error']);
  console.log(`PASS preview anonymous ${path}: 401`);
}
