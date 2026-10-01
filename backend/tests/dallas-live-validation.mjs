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
