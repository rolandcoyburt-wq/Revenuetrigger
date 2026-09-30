import assert from 'node:assert/strict';
import fs from 'node:fs/promises';

const workerUrl=new URL('../worker.js',import.meta.url);
const workerSource=await fs.readFile(workerUrl,'utf8');
const mod=await import('data:text/javascript;base64,'+Buffer.from(workerSource).toString('base64'));
const worker=mod.default;

const LIVE_MARKETS=['Phoenix','Tempe','Tucson','Scottsdale','Mesa','Chandler'];
const iso=(ms=Date.now())=>new Date(ms).toISOString();
const sqlite=(ms=Date.now())=>new Date(ms).toISOString().replace('T',' ').replace(/\.\d{3}Z$/,'');
const HOUR=3600000;
const DAY=86400000;

function rawLead({
  market='Phoenix',
  id='1',
  name='Commercial tenant improvement',
  address='100 MAIN ST',
  company='ACME CONSTRUCTION LLC',
  scope='Commercial tenant improvement with electrical and plumbing work',
  status='Submitted - Online',
  eventMs=Date.now()-HOUR,
  updatedMs=Date.now()-10*60000,
  officialValue=250000,
  value=45000,
  categories=['Electrical','Plumbing','Commercial services']
}={}){
  return {
    id:market==='Phoenix'?String(id):market.toLowerCase()+':'+String(id),
    name,
    address,
    event_date:iso(eventMs),
    company,
    scope,
    score:50,
    categories:JSON.stringify(categories),
    value,
    temperature:'WATCH',
    permit:'PERMIT-'+id,
    permit_status:status,
    official_value:officialValue,
    source:'Stored '+market+' test source',
    market,
    created_at:sqlite(updatedMs-HOUR),
    updated_at:sqlite(updatedMs)
  };
}

function parseWindowArg(arg){
  const m=String(arg||'').match(/-(\d+) days/);
  return m?Number(m[1]):7;
}

class SelectOnlyDB{
  constructor(rows=[],options={}){
    this.rows=rows;
    this.operations=[];
    this.fail=Boolean(options.fail);
  }
  prepare(sql){
    this.operations.push({type:'prepare',sql});
    if(!/^\s*SELECT\b/i.test(sql))throw new Error('NON_SELECT_SQL:'+sql);
    const db=this;
    return {
      bind(...args){
        db.operations.push({type:'bind',sql,args});
        return {
          async all(){
            db.operations.push({type:'all',sql,args});
            if(db.fail)throw new Error('simulated D1 failure');
            const days=parseWindowArg(args[0]);
            const markets=args.slice(1);
            const cutoff=Date.now()-days*DAY;
            if(/COUNT\(\*\) AS stored_count/i.test(sql)){
              const grouped=[];
              for(const market of markets){
                const all=db.rows.filter(x=>x.market===market);
                if(!all.length)continue;
                const inWindow=all.filter(x=>new Date(x.event_date).getTime()>=cutoff);
                const latestStored=all.map(x=>x.updated_at).filter(Boolean).sort().at(-1)||null;
                const latestEvent=all.map(x=>x.event_date).filter(Boolean).sort().at(-1)||null;
                grouped.push({
                  market,
                  stored_count:all.length,
                  window_count:inWindow.length,
                  latest_stored_at:latestStored,
                  latest_event_at:latestEvent
                });
              }
              return {results:grouped};
            }
            if(/SELECT\s+\*/i.test(sql)){
              const out=db.rows
                .filter(x=>markets.includes(x.market))
                .filter(x=>new Date(x.event_date).getTime()>=cutoff)
                .sort((a,b)=>(Number(b.score||0)-Number(a.score||0))||(new Date(b.event_date)-new Date(a.event_date)));
              return {results:out};
            }
            throw new Error('Unexpected SELECT:'+sql);
          },
          async first(){throw new Error('FIRST_NOT_ALLOWED_IN_FEED')},
          async run(){throw new Error('MUTATION_NOT_ALLOWED_IN_FEED')}
        };
      },
      async all(){throw new Error('UNBOUND_ALL_NOT_EXPECTED')},
      async first(){throw new Error('FIRST_NOT_ALLOWED_IN_FEED')},
      async run(){throw new Error('MUTATION_NOT_ALLOWED_IN_FEED')}
    };
  }
}

function env(db){
  return {DB:db,ALLOWED_ORIGIN:'https://revenuetrigger.ai'};
}
async function callFeed(db,query='',headers={}){
  const req=new Request('https://api.revenuetrigger.ai/api/feed'+query,{headers});
  return worker.fetch(req,env(db));
}
async function body(res){return res.json();}

const tests=[];
function test(name,fn){tests.push([name,fn]);}

// Static architectural isolation.
test('feed route/helper contain no ingestion, auth, cursor, or persistence calls',async()=>{
  const h0=workerSource.indexOf('async function readStoredFeed');
  const h1=workerSource.indexOf('\n\nasync function scoringAudit',h0);
  const r0=workerSource.indexOf("if(path==='/feed'");
  const r1=workerSource.indexOf("if(path==='/leads'",r0);
  assert.ok(h0>0&&h1>h0&&r0>0&&r1>r0);
  const isolated=workerSource.slice(h0,h1)+'\n'+workerSource.slice(r0,r1);
  for(const token of ['refresh(','fetchMarket(','persist(','authUser(','fetchChandler','fetchTucson','setTucsonCursor']){
    assert.equal(isolated.includes(token),false,token+' must not appear in feed path');
  }
  assert.ok(r0<workerSource.indexOf('const user=await authUser',r0),'/feed must be routed before global authUser');
});

test('feed performs SELECT-only D1 access and no network calls',async()=>{
  const db=new SelectOnlyDB([rawLead()]);
  const originalFetch=globalThis.fetch;
  let networkCalls=0;
  globalThis.fetch=async()=>{networkCalls++;throw new Error('network forbidden')};
  try{
    const res=await callFeed(db);
    assert.equal(res.status,200);
    assert.equal(networkCalls,0);
    const sql=db.operations.filter(x=>x.type==='prepare').map(x=>x.sql);
    assert.equal(sql.length,2);
    assert.ok(sql.every(q=>/^\s*SELECT\b/i.test(q)));
    assert.ok(sql.every(q=>!/\b(?:INSERT|UPDATE|DELETE|REPLACE|UPSERT)\b/i.test(q)));
  }finally{globalThis.fetch=originalFetch}
});

test('authorization header does not invoke session/auth writes',async()=>{
  const db=new SelectOnlyDB([rawLead()]);
  const res=await callFeed(db,'',{Authorization:'Bearer should-be-ignored'});
  assert.equal(res.status,200);
  const sql=db.operations.filter(x=>x.sql).map(x=>x.sql.toLowerCase()).join('\n');
  assert.equal(sql.includes('sessions'),false);
  assert.equal(sql.includes('last_seen_at'),false);
});

test('empty database returns honest empty state',async()=>{
  const res=await callFeed(new SelectOnlyDB([]));
  const j=await body(res);
  assert.equal(res.status,200);
  assert.equal(j.state,'empty');
  assert.equal(j.opportunityState,'empty');
  assert.deepEqual(j.leads,[]);
});

test('empty requested market stays empty without repair',async()=>{
  const db=new SelectOnlyDB([rawLead({market:'Phoenix'})]);
  const originalFetch=globalThis.fetch;
  let networkCalls=0;
  globalThis.fetch=async()=>{networkCalls++;throw new Error('network forbidden')};
  try{
    const res=await callFeed(db,'?markets=Mesa');
    const j=await body(res);
    assert.equal(j.state,'empty');
    assert.equal(j.opportunityState,'empty');
    assert.deepEqual(j.leads,[]);
    assert.equal(networkCalls,0);
  }finally{globalThis.fetch=originalFetch}
});

test('D1 errors return unavailable 503 and are not cached',async()=>{
  const res=await callFeed(new SelectOnlyDB([], {fail:true}));
  const j=await body(res);
  assert.equal(res.status,503);
  assert.equal(j.state,'unavailable');
  assert.equal(j.opportunityState,'unavailable');
  assert.equal(res.headers.get('cache-control'),'no-store');
});

test('all six Arizona markets filter independently',async()=>{
  const rows=LIVE_MARKETS.map((market,i)=>rawLead({market,id:String(i+1),address:(100+i)+' MARKET ST'}));
  const db=new SelectOnlyDB(rows);
  for(const market of LIVE_MARKETS){
    const res=await callFeed(db,'?markets='+encodeURIComponent(market));
    const j=await body(res);
    assert.equal(res.status,200);
    assert.ok(j.leads.length>=1,market+' should return a lead');
    assert.ok(j.leads.every(x=>x.market===market));
    assert.deepEqual(j.requested.markets,[market]);
  }
});

test('invalid explicit market returns 400',async()=>{
  const res=await callFeed(new SelectOnlyDB([]),'?markets=Phoenix,Atlantis');
  const j=await body(res);
  assert.equal(res.status,400);
  assert.equal(j.error,'invalid market');
  assert.deepEqual(j.invalidMarkets,['Atlantis']);
});

test('days and limits clamp to contract',async()=>{
  let j=await body(await callFeed(new SelectOnlyDB([]),'?days=999&limit=999'));
  assert.equal(j.requested.days,30);
  assert.equal(j.requested.limit,200);
  j=await body(await callFeed(new SelectOnlyDB([]),'?days=0&limit=0'));
  assert.equal(j.requested.days,1);
  assert.equal(j.requested.limit,1);
  j=await body(await callFeed(new SelectOnlyDB([]),'?days=nope&limit=nope'));
  assert.equal(j.requested.days,7);
  assert.equal(j.requested.limit,120);
});

test('hydration uses authoritative stored transformation and temperature',async()=>{
  const row=rawLead({
    scope:'Commercial tenant improvement with electrical plumbing HVAC security fire alarm work',
    status:'Submitted - Online',
    officialValue:2000000,
    value:150000
  });
  const j=await body(await callFeed(new SelectOnlyDB([row]),'?markets=Phoenix'));
  const lead=j.leads[0];
  assert.ok(lead.scoreBreakdown&&typeof lead.scoreBreakdown.projectStage==='number');
  assert.ok(lead.sellerFit&&typeof lead.sellerFit==='object');
  assert.ok(lead.dataConfidence&&typeof lead.dataConfidence.score==='number');
  assert.ok(lead.lifecycle&&Array.isArray(lead.lifecycle.steps));
  assert.ok(lead.actionIntelligence&&lead.actionIntelligence.nextBestAction);
  const expected=lead.score>=75?'HOT':lead.score>=60?'WARM':lead.score>=40?'WATCH':'LOW';
  assert.equal(lead.temperature,expected);
});

test('clustering happens before final limit',async()=>{
  const rows=[
    rawLead({id:'A',address:'500 W TEST ST',scope:'Commercial electrical tenant improvement',officialValue:1000000}),
    rawLead({id:'B',address:'500 W TEST ST STE 200',scope:'Commercial plumbing tenant improvement',officialValue:500000}),
    rawLead({id:'C',address:'900 OTHER ST'})
  ];
  const j=await body(await callFeed(new SelectOnlyDB(rows),'?markets=Phoenix&limit=1'));
  assert.equal(j.leads.length,1);
  assert.equal(j.leads[0].relatedPermitCount,2);
  assert.equal(j.leads[0].projectCluster,true);
  assert.equal(j.totalClusteredInWindow,2);
});

test('long and missing fields hydrate without fake repair',async()=>{
  const long='LONG DESCRIPTION '.repeat(40).trim();
  const row=rawLead({company:'Not listed',scope:long,officialValue:null,address:'',name:'Other Commercial'});
  const j=await body(await callFeed(new SelectOnlyDB([row]),'?markets=Phoenix'));
  const lead=j.leads[0];
  assert.equal(lead.company,'Not listed');
  assert.equal(lead.scope,long);
  assert.equal(lead.officialPermitValue,null);
  assert.ok(lead.dataConfidence);
});

test('fresh state reports stored freshness metadata',async()=>{
  const db=new SelectOnlyDB([rawLead({updatedMs:Date.now()-20*60000})]);
  const j=await body(await callFeed(db,'?markets=Phoenix'));
  assert.equal(j.state,'fresh');
  assert.equal(j.freshness.markets.Phoenix.state,'fresh');
  assert.ok(j.freshness.markets.Phoenix.ageMinutes<=180);
});

test('stale state reports old stored data without refreshing it',async()=>{
  const db=new SelectOnlyDB([rawLead({updatedMs:Date.now()-5*HOUR})]);
  const j=await body(await callFeed(db,'?markets=Phoenix'));
  assert.equal(j.state,'stale');
  assert.equal(j.freshness.markets.Phoenix.state,'stale');
});

test('partial state reports mixed stored-market freshness',async()=>{
  const rows=[
    rawLead({market:'Phoenix',id:'p',updatedMs:Date.now()-10*60000}),
    rawLead({market:'Tempe',id:'t',updatedMs:Date.now()-5*HOUR,address:'200 TEMPE ST'})
  ];
  const j=await body(await callFeed(new SelectOnlyDB(rows),'?markets=Phoenix,Tempe,Tucson'));
  assert.equal(j.state,'partial');
  assert.equal(j.freshness.markets.Phoenix.state,'fresh');
  assert.equal(j.freshness.markets.Tempe.state,'stale');
  assert.equal(j.freshness.markets.Tucson.state,'empty');
});

test('successful feed returns required CORS and cache headers',async()=>{
  const res=await callFeed(new SelectOnlyDB([rawLead()]));
  assert.equal(res.headers.get('access-control-allow-origin'),'https://revenuetrigger.ai');
  assert.equal(res.headers.get('cache-control'),'public, max-age=30, s-maxage=120, stale-while-revalidate=300');
});

test('Chandler read does not call municipal services',async()=>{
  const db=new SelectOnlyDB([rawLead({market:'Chandler',address:'300 CHANDLER ST'})]);
  const originalFetch=globalThis.fetch;
  let networkCalls=0;
  globalThis.fetch=async()=>{networkCalls++;throw new Error('municipal call forbidden')};
  try{
    const j=await body(await callFeed(db,'?markets=Chandler'));
    assert.equal(j.leads[0].market,'Chandler');
    assert.equal(networkCalls,0);
  }finally{globalThis.fetch=originalFetch}
});

test('Tucson read cannot mutate market cursors',async()=>{
  const db=new SelectOnlyDB([rawLead({market:'Tucson',address:'400 TUCSON ST'})]);
  const j=await body(await callFeed(db,'?markets=Tucson'));
  assert.equal(j.leads[0].market,'Tucson');
  const sql=db.operations.filter(x=>x.sql).map(x=>x.sql.toLowerCase()).join('\n');
  assert.equal(sql.includes('market_cursors'),false);
  assert.equal(db.operations.some(x=>x.type==='run'),false);
});

test('response exposes enough state for homepage and public Signals without fallback data',async()=>{
  const fresh=await body(await callFeed(new SelectOnlyDB([rawLead()])));
  const empty=await body(await callFeed(new SelectOnlyDB([])));
  assert.equal(fresh.readOnly,true);
  assert.equal(fresh.source,'stored_d1');
  assert.equal(fresh.opportunityState,'available');
  assert.equal(empty.opportunityState,'empty');
  assert.ok(['fresh','stale','empty','partial'].includes(fresh.state));
  assert.equal(empty.state,'empty');
});

test('feed row SELECT has no SQL limit before clustering',async()=>{
  const h0=workerSource.indexOf('const rowsQuery=',workerSource.indexOf('async function readStoredFeed'));
  const h1=workerSource.indexOf('const healthQuery=',h0);
  assert.ok(h0>0&&h1>h0);
  const rowQuerySource=workerSource.slice(h0,h1);
  assert.equal(/\bLIMIT\b/i.test(rowQuerySource),false);
});

let passed=0;
for(const [name,fn] of tests){
  try{
    await fn();
    passed++;
    console.log('PASS',name);
  }catch(err){
    console.error('FAIL',name);
    console.error(err);
    process.exitCode=1;
  }
}
console.log('\n'+passed+'/'+tests.length+' feed architecture checks passed');
if(passed!==tests.length)process.exit(1);
