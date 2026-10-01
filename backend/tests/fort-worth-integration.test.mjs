import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {normalizeFortWorthPermit,fetchFortWorthPermits} from '../markets/dfw/fort-worth.js';
import {toLeadInput} from '../markets/dfw/normalize.js';

// Export internal integration seams only in this in-memory test module.
const workerUrl=new URL('../worker.js',import.meta.url);
const source=await readFile(workerUrl,'utf8');
const testSource=source.replace(/from '(\.\/[^']+)'/g,(_,path)=>`from '${new URL(path,workerUrl).href}'`)
  +'\nexport {fetchMarket,marketFromSource,MARKETS,LIVE_MARKETS,PLANS,leadFrom};';
const core=await import('data:text/javascript;base64,'+Buffer.from(testSource).toString('base64'));
const now=Date.now();
const raw={Unique_ID:'test-fw-1',Permit_No:'PB-TEST-1',Permit_Type:'Commercial Building Permit',Permit_SubType:'Remodel',
  B1_SPECIAL_TEXT:'Test tenant finish',B1_WORK_DESC:'Electrical and HVAC tenant improvement',
  Full_Street_Address:'100 MAIN ST',Zip_Code:'76102',Owner_Full_Name:'TEST REALTY LLC',
  File_Date:now-86400000,Status_Date:now-3600000,Current_Status:'Pending',JobValue:'2200000'};
const results=[];
async function check(name,fn){await fn();results.push(name);console.log('PASS '+name);}
await check('normalization preserves Fort Worth identity valuation participant and date',async()=>{
  const record=normalizeFortWorthPermit(raw,{now});const input=toLeadInput(record);
  assert.equal(input.market,'Fort Worth');assert.equal(input.id,'test-fw-1');
  assert.equal(input.company,'TEST REALTY LLC');assert.equal(input.officialValue,2200000);
  assert.equal(input.date,new Date(raw.Status_Date).toISOString());
  const sparse=toLeadInput(normalizeFortWorthPermit({...raw,Owner_Full_Name:null,JobValue:0},{now}));
  assert.equal(sparse.company,null);assert.equal(sparse.officialValue,null);
});
await check('adapter pagination and deduplication use injected requests only',async()=>{
  const urls=[];
  const rows=await fetchFortWorthPermits({now,pageSize:1,maxPages:3,fetchFn:async url=>{
    urls.push(new URL(url));return {ok:true,json:async()=>({features:[{attributes:raw}],exceededTransferLimit:urls.length===1})};
  }});
  assert.equal(urls.length,2);assert.equal(urls[0].searchParams.get('resultOffset'),'0');
  assert.equal(urls[1].searchParams.get('resultOffset'),'1');assert.equal(rows.length,1);
});
await check('fetchMarket uses Fort Worth adapter and unchanged core leadFrom contract',async()=>{
  const original=globalThis.fetch;let requests=0;
  globalThis.fetch=async url=>{
    requests++;assert.match(String(url),/CFW_Open_Data_Development_Permits_View/);
    return {ok:true,json:async()=>({features:[{attributes:raw}],exceededTransferLimit:false})};
  };
  try{
    const rows=await core.fetchMarket('Fort Worth',7,1);
    assert.equal(requests,1);assert.equal(rows.length,1);
    assert.equal(rows[0].id,'fort worth:test-fw-1');assert.equal(rows[0].market,'Fort Worth');
    assert.equal(rows[0].officialPermitValue,2200000);
    const expected=core.leadFrom({...toLeadInput(normalizeFortWorthPermit(raw)),source:rows[0].source});
    assert.equal(rows[0].score,expected.score);assert.deepEqual(rows[0].categories,expected.categories);
    assert.deepEqual(await core.fetchMarket('Unknown',7,1),[]);assert.equal(requests,1);
  }finally{globalThis.fetch=original;}
});
await check('Fort Worth recognition remains unchanged after additive Dallas registration',async()=>{
  assert.equal(core.marketFromSource('City of Fort Worth Development Services'),'Fort Worth');
  assert.equal(core.marketFromSource('fort_worth_development_permits'),'Fort Worth');
  const expected=['Phoenix','Tempe','Tucson','Scottsdale','Mesa','Chandler','Fort Worth','Dallas'];
  assert.deepEqual(core.MARKETS,expected);assert.deepEqual(core.LIVE_MARKETS,expected);
  assert.equal(core.PLANS.Territory.marketLimit,6);
  const original=globalThis.fetch;let attempts=0;
  globalThis.fetch=async()=>{attempts++;throw Error('No network permitted')};
  try{
    const res=await core.default.fetch(new Request('https://preview.invalid/api/sources'),{});
    const data=await res.json();assert.equal(res.status,200);assert.deepEqual(data.liveMarkets,expected);
    assert.equal(data.markets['Fort Worth'].status,'live');assert.equal(data.markets.Dallas.status,'live');
    assert.equal(attempts,0);
  }finally{globalThis.fetch=original;}
});
console.log(`${results.length}/${results.length} integration checks passed; all adapter requests mocked`);
