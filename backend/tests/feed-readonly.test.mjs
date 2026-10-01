import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';

const workerSource=await readFile(new URL('../worker.js',import.meta.url),'utf8');
// File URL preserves relative adapter-module resolution.
const mod=await import(new URL('../worker.js',import.meta.url));
const worker=mod.default;

const ALLOWED='https://revenuetrigger.ai';
const markets=['Phoenix','Tempe','Tucson','Scottsdale','Mesa','Chandler'];

function sqliteTime(offsetMinutes=0){
  const d=new Date(Date.now()+offsetMinutes*60000);
  return d.toISOString().replace('T',' ').replace(/\.\d{3}Z$/,'');
}
function eventTime(offsetMinutes=0){
  return new Date(Date.now()+offsetMinutes*60000).toISOString();
}
function row(overrides={}){
  return {
    id:'x1',
    market:'Phoenix',
    name:'Commercial tenant improvement',
    address:'100 Main St Phoenix AZ',
    event_date:eventTime(-30),
    company:'Example Construction LLC',
    scope:'Commercial tenant improvement with electrical HVAC plumbing and fire alarm work',
    score:80,
    categories:'["Electrical","HVAC","Plumbing","Commercial services"]',
    value:42000,
    temperature:'HOT',
    permit:'P-100',
    source:'City test source',
    updated_at:sqliteTime(-30),
    permit_status:'Submitted',
    official_value:null,
    ...overrides
  };
}
function sampleRows(){
  return [
    row({id:'phx-a',market:'Phoenix',address:'100 Main St Phoenix AZ',permit:'PHX-1',company:'A VERY LONG PHOENIX CONTRACTING COMPANY NAME LLC',scope:'A very long permit description '.repeat(12),official_value:750000}),
    row({id:'phx-b',market:'Phoenix',address:'100 Main St Phoenix AZ',permit:'PHX-2',company:'Not listed',scope:'Electrical permit for same clustered project',score:62}),
    row({id:'tempe-a',market:'Tempe',address:'200 Rural Rd Tempe AZ',permit:'BP261214',name:'Einstein Bros Bagels',company:'Not listed',permit_status:'Issued',official_value:150000,updated_at:sqliteTime(-45)}),
    row({id:'tuc-a',market:'Tucson',address:'300 Congress St Tucson AZ',permit:'TC-COM-1',company:'Not listed',permit_status:'Submitted - Online',official_value:null,updated_at:sqliteTime(-50)}),
    row({id:'scot-a',market:'Scottsdale',address:'400 Scottsdale Rd Scottsdale AZ',permit:'SC-1',company:'Builder Example Inc',permit_status:'Issued',official_value:500000,updated_at:sqliteTime(-55)}),
    row({id:'mesa-a',market:'Mesa',address:'500 Main St Mesa AZ',permit:'ME-1',company:'Mesa Mechanical LLC',scope:'Mechanical HVAC replacement',permit_status:'Issued',updated_at:sqliteTime(-60)}),
    row({id:'ch-a',market:'Chandler',address:'600 Arizona Ave Chandler AZ',permit:'CH-1',company:'Chandler Participant Business LLC',scope:'Commercial project participant record',permit_status:'Issued',updated_at:sqliteTime(-70)})
  ];
}
class MockDB{
  constructor(rows=[],opts={}){this.rows=rows;this.fail=opts.fail||false;this.statements=[];}
  prepare(sql){
    this.statements.push(sql);
    const db=this;
    if(!/^\s*SELECT\b/i.test(sql))throw new Error('NON_SELECT_SQL:'+sql.trim().slice(0,80));
    return {
      args:[],
      bind(...args){this.args=args;return this;},
      async all(){
        if(db.fail)throw new Error('D1 unavailable');
        const selected=sql.includes('GROUP BY market')
          ? this.args.slice(1)
          : this.args.slice(1,-1);
        const filtered=db.rows.filter(x=>selected.includes(x.market));
        if(sql.includes('GROUP BY market')){
          const result=[];
          for(const market of selected){
            const rs=filtered.filter(x=>x.market===market);
            if(!rs.length)continue;
            const lastStored=rs.map(x=>x.updated_at).filter(Boolean).sort().at(-1)||null;
            const latestEvent=rs.map(x=>x.event_date).filter(Boolean).sort().at(-1)||null;
            const age=lastStored?Math.max(0,Math.floor((Date.now()-new Date(lastStored.replace(' ','T')+'Z').getTime())/60000)):null;
            result.push({market,stored_count:rs.length,last_stored_at:lastStored,latest_event_at:latestEvent,age_minutes:age});
          }
          return {results:result};
        }
        const limit=Number(this.args.at(-1)||5000);
        const sorted=[...filtered].sort((a,b)=>(Number(b.score)-Number(a.score))||(new Date(b.event_date)-new Date(a.event_date)));
        return {results:sorted.slice(0,limit)};
      }
    };
  }
}
async function call(path,{rows=sampleRows(),dbOptions={},headers={}}={}){
  const db=new MockDB(rows,dbOptions);
  const req=new Request('https://api.revenuetrigger.ai/api'+path,{headers});
  const originalFetch=globalThis.fetch;
  let externalAttempts=0;
  globalThis.fetch=async()=>{externalAttempts++;throw new Error('EXTERNAL_FETCH_FORBIDDEN')};
  try{
    const response=await worker.fetch(req,{DB:db,ALLOWED_ORIGIN:ALLOWED});
    const body=await response.json();
    return {response,body,db};
  }finally{
    globalThis.fetch=originalFetch;
    assert.equal(externalAttempts,0,'Feed must not attempt any external fetch');
  }
}

const results=[];
async function check(name,fn){
  try{await fn();results.push({name,ok:true});}
  catch(error){results.push({name,ok:false,error:error.stack||String(error)});}
}

// 1–4: route-level side-effect guarantees.
await check('01 route contains no refresh/fetchMarket/persist/authUser call',async()=>{
  const start=workerSource.indexOf("if(path==='/feed'");
  const end=workerSource.indexOf("if(path==='/leads'",start);
  assert.ok(start>0&&end>start);
  const block=workerSource.slice(start,end);
  for(const forbidden of ['refresh(','fetchMarket(','persist(','authUser('])assert.equal(block.includes(forbidden),false,forbidden);
});
await check('02 feed runtime performs SELECT statements only',async()=>{
  const {db}=await call('/feed?days=7&limit=120');
  assert.ok(db.statements.length>=2);
  assert.ok(db.statements.every(x=>/^\s*SELECT\b/i.test(x)));
});
await check('03 Authorization header does not cause auth/session writes',async()=>{
  const {response,db}=await call('/feed?markets=Phoenix',{headers:{Authorization:'Bearer definitely-not-a-session'}});
  assert.equal(response.status,200);
  assert.ok(db.statements.every(x=>/^\s*SELECT\b/i.test(x)));
  assert.equal(db.statements.some(x=>/sessions/i.test(x)),false);
});
await check('04 Chandler/Tucson reads make no external municipal requests',async()=>{
  assert.equal((await call('/feed?markets=Chandler')).response.status,200);
  assert.equal((await call('/feed?markets=Tucson')).response.status,200);
});

// 5–8: honest failure/empty behavior.
await check('05 empty requested market remains empty',async()=>{
  const {body}=await call('/feed?markets=Tucson',{rows:[row({market:'Phoenix'})]});
  assert.equal(body.state,'empty');assert.equal(body.leads.length,0);
});
await check('06 empty database remains honestly empty',async()=>{
  const {body}=await call('/feed',{rows:[]});
  assert.equal(body.state,'empty');assert.equal(body.leads.length,0);
  assert.equal(body.freshness.markets.every(x=>x.state==='empty'),true);
});
await check('07 D1 error returns unavailable 503',async()=>{
  const {response,body}=await call('/feed',{dbOptions:{fail:true}});
  assert.equal(response.status,503);assert.equal(body.state,'unavailable');assert.deepEqual(body.leads,[]);
});
await check('08 invalid explicit market returns 400',async()=>{
  const {response,body}=await call('/feed?markets=Phoenix,Atlantis');
  assert.equal(response.status,400);assert.equal(body.error,'invalid_market');assert.deepEqual(body.invalidMarkets,['Atlantis']);
});

// 9–11: filtering and constraints.
await check('09 all six Arizona market filters return only requested market',async()=>{
  for(const market of markets){
    const {body}=await call('/feed?markets='+encodeURIComponent(market)+'&limit=20');
    assert.equal(body.markets.length,1);assert.equal(body.markets[0],market);
    assert.ok(body.leads.every(x=>x.market===market));
  }
});
await check('10 days and limits clamp to approved bounds',async()=>{
  const low=await call('/feed?days=0&limit=0');
  assert.equal(low.body.query.days,1);assert.equal(low.body.query.limit,1);
  const high=await call('/feed?days=999&limit=999');
  assert.equal(high.body.query.days,30);assert.equal(high.body.query.limit,200);
});
await check('11 defaults are 7 days and 120 opportunities',async()=>{
  const {body}=await call('/feed');
  assert.equal(body.query.days,7);assert.equal(body.query.limit,120);
});

// 12–15: authoritative hydration and clustering.
await check('12 feed reuses authoritative hydrateStoredLead and clusterLeads',async()=>{
  assert.match(workerSource,/const hydrated=\(rowResult\.results\|\|\[\]\)\.map\(hydrateStoredLead\)/);
  assert.match(workerSource,/const clustered=clusterLeads\(hydrated\)/);
});
await check('13 clustering occurs before final response limit',async()=>{
  const rows=[
    row({id:'a',permit:'A',address:'777 Same St Phoenix AZ',score:99}),
    row({id:'b',permit:'B',address:'777 Same St Phoenix AZ',score:98}),
    row({id:'c',permit:'C',address:'888 Other St Phoenix AZ',score:97})
  ];
  const {body}=await call('/feed?markets=Phoenix&limit=2',{rows});
  assert.equal(body.leads.length,2);
  const cluster=body.leads.find(x=>x.address==='777 Same St Phoenix AZ');
  assert.ok(cluster);assert.equal(cluster.relatedPermitCount,2);assert.equal(cluster.projectCluster,true);
});
await check('14 temperature/lifecycle/action intelligence are authoritative hydrated output',async()=>{
  const {body}=await call('/feed?markets=Phoenix&limit=10');
  assert.ok(body.leads.length>0);
  for(const lead of body.leads){
    assert.ok(['HOT','WARM','WATCH','LOW'].includes(lead.temperature));
    assert.equal(lead.temperature,lead.score>=75?'HOT':lead.score>=60?'WARM':lead.score>=40?'WATCH':'LOW');
    assert.ok(lead.scoreBreakdown&&typeof lead.scoreBreakdown==='object');
    assert.ok(lead.lifecycle&&typeof lead.lifecycle==='object');
    assert.ok(lead.actionIntelligence&&typeof lead.actionIntelligence==='object');
  }
});
await check('15 missing and long fields survive hydration without fake replacements',async()=>{
  const rows=[row({
    id:'long-edge',
    market:'Phoenix',
    address:'999 Edge Case Ave Phoenix AZ',
    permit:'PHX-LONG',
    company:'Not listed',
    scope:'A deliberately long municipal permit description '.repeat(12),
    official_value:null
  })];
  const {body}=await call('/feed?markets=Phoenix&limit=10',{rows});
  const lead=body.leads[0];
  assert.ok(lead);
  assert.equal(lead.company,'Not listed');
  assert.equal(lead.officialPermitValue,null);
  assert.ok(String(lead.scope).length>100);
});

// 16–18: data-state semantics.
await check('16 fresh state uses stored updated_at only',async()=>{
  const {body}=await call('/feed?markets=Phoenix',{rows:[row({market:'Phoenix',updated_at:sqliteTime(-20)})]});
  assert.equal(body.state,'fresh');assert.equal(body.freshness.basis.includes('municipal source health is not polled'),true);
});
await check('17 stale and partial states are distinguishable',async()=>{
  const stale=await call('/feed?markets=Phoenix',{rows:[row({market:'Phoenix',updated_at:sqliteTime(-500)})]});
  assert.equal(stale.body.state,'stale');
  const partial=await call('/feed?markets=Phoenix,Tempe',{rows:[
    row({market:'Phoenix',updated_at:sqliteTime(-20)}),
    row({id:'t',market:'Tempe',updated_at:sqliteTime(-500),address:'2 Tempe Ave Tempe AZ'})
  ]});
  assert.equal(partial.body.state,'partial');
});
await check('18 market metadata distinguishes empty from stale',async()=>{
  const {body}=await call('/feed?markets=Phoenix,Tempe',{rows:[row({market:'Phoenix',updated_at:sqliteTime(-500)})]});
  const map=Object.fromEntries(body.freshness.markets.map(x=>[x.market,x.state]));
  assert.equal(map.Phoenix,'stale');assert.equal(map.Tempe,'empty');assert.equal(body.state,'partial');
});

// 19–20: public HTTP contract.
await check('19 CORS and cache headers match approved public contract',async()=>{
  const {response}=await call('/feed');
  assert.equal(response.headers.get('access-control-allow-origin'),ALLOWED);
  assert.equal(response.headers.get('cache-control'),'public, max-age=30, s-maxage=120, stale-while-revalidate=300');
  assert.equal(response.headers.get('x-revenuetrigger-read-only'),'true');
});
await check('20 response shape is suitable for homepage/public Signals without demo fallback',async()=>{
  const {body}=await call('/feed?limit=3');
  assert.equal(body.ok,true);
  assert.ok(['fresh','stale','empty','partial'].includes(body.state));
  assert.ok(Array.isArray(body.leads));
  assert.ok(Array.isArray(body.markets));
  assert.ok(body.query&&body.counts&&body.freshness);
  assert.equal(workerSource.slice(workerSource.indexOf("if(path==='/feed'"),workerSource.indexOf("if(path==='/leads'",workerSource.indexOf("if(path==='/feed'"))).includes('SAMPLE'),false);
});


// Fort Worth integration: the existing LIVE_MARKETS-driven contract must extend
// without fetching adapters, writing D1, or enabling Dallas.
await check('21 default feed includes Fort Worth and Dallas with explicit empty states',async()=>{
  const {body,db}=await call('/feed');
  assert.deepEqual(body.markets,[...markets,'Fort Worth','Dallas']);
  assert.equal(body.freshness.markets.find(x=>x.market==='Fort Worth').state,'empty');
  assert.equal(body.freshness.markets.find(x=>x.market==='Dallas').state,'empty');
  assert.equal(body.state,'partial');
  assert.equal(db.statements.length,2);
});
await check('22 Fort Worth filter hydrates and clusters stored rows only',async()=>{
  const fw=row({id:'fw-a',market:'Fort Worth',address:'100 Main St Fort Worth TX',source:'City of Fort Worth Development Services',permit:'FW-A'});
  const {response,body,db}=await call('/feed?markets=Fort%20Worth&limit=10',{
    rows:[...sampleRows(),fw,{...fw,id:'fw-b',permit:'FW-B'}],
    headers:{Authorization:'Bearer must-not-trigger-session-write'}
  });
  assert.equal(response.status,200);
  assert.deepEqual(body.markets,['Fort Worth']);
  assert.equal(body.leads.length,1);
  assert.equal(body.leads[0].market,'Fort Worth');
  assert.equal(body.leads[0].relatedPermitCount,2);
  assert.ok(body.leads[0].scoreBreakdown);
  assert.equal(body.state,'fresh');
  assert.equal(db.statements.length,2);
  assert.ok(db.statements.every(x=>/^\s*SELECT\b/i.test(x)&&!/(sessions|users|market_cursors)/i.test(x)));
});
await check('23 Fort Worth empty stale unavailable and mixed states remain honest',async()=>{
  const path='/feed?markets=Fort%20Worth';
  assert.equal((await call(path,{rows:[]})).body.state,'empty');
  const fw=row({id:'fw',market:'Fort Worth',address:'1 Main St Fort Worth TX',updated_at:sqliteTime(-500)});
  assert.equal((await call(path,{rows:[fw]})).body.state,'stale');
  const mixed=await call('/feed?markets=Phoenix,Fort%20Worth',{rows:[...sampleRows(),fw]});
  assert.equal(mixed.body.state,'partial');
  assert.equal(mixed.body.freshness.markets.find(x=>x.market==='Fort Worth').state,'stale');
  const failed=await call(path,{dbOptions:{fail:true}});
  assert.equal(failed.response.status,503);assert.equal(failed.body.state,'unavailable');
});
await check('24 unknown markets remain rejected while Dallas and Fort Worth are allowed',async()=>{
  const {response,body,db}=await call('/feed?markets=Atlantis');
  assert.equal(response.status,400);assert.deepEqual(body.invalidMarkets,['Atlantis']);
  assert.ok(body.allowedMarkets.includes('Fort Worth'));assert.ok(body.allowedMarkets.includes('Dallas'));
  assert.equal(db.statements.length,0);
});
await check('25 Dallas filter returns stored Dallas rows without municipal fetches',async()=>{
  const d=row({id:'dallas-a',market:'Dallas',address:'1445 Ross Ave Dallas TX',source:'City of Dallas DallasNow Building — Issued',permit:'COM-ALT-ADD-26-002263',company:'1445 ROSS AVE LLC',official_value:3200000});
  const {response,body,db}=await call('/feed?markets=Dallas&days=7&limit=20',{rows:[...sampleRows(),d]});
  assert.equal(response.status,200);assert.deepEqual(body.markets,['Dallas']);assert.equal(body.leads.length,1);
  assert.equal(body.leads[0].market,'Dallas');assert.equal(body.leads[0].permit,'COM-ALT-ADD-26-002263');assert.equal(body.state,'fresh');
  assert.equal(db.statements.length,2);
});
await check('26 Dallas plus Fort Worth mixed stored-feed query remains additive',async()=>{
  const fw=row({id:'fw-mixed',market:'Fort Worth',address:'100 Main St Fort Worth TX',source:'City of Fort Worth Development Services',permit:'FW-MIX'});
  const d=row({id:'dallas-mixed',market:'Dallas',address:'1445 Ross Ave Dallas TX',source:'City of Dallas DallasNow Building — Submitted + Issued',permit:'COM-ALT-ADD-26-002263'});
  const {response,body,db}=await call('/feed?markets=Dallas,Fort%20Worth&days=7&limit=20',{rows:[...sampleRows(),fw,d]});
  assert.equal(response.status,200);assert.deepEqual(body.markets,['Dallas','Fort Worth']);assert.equal(body.leads.length,2);
  assert.deepEqual(new Set(body.leads.map(x=>x.market)),new Set(['Dallas','Fort Worth']));assert.equal(db.statements.length,2);
});

const failed=results.filter(x=>!x.ok);
for(const r of results)console.log(`${r.ok?'PASS':'FAIL'} ${r.name}${r.ok?'':'\n'+r.error}`);
console.log(`\n${results.length-failed.length}/${results.length} checks passed`);
if(failed.length)process.exit(1);
