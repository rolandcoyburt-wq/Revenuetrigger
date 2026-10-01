import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFile} from 'node:fs/promises';
import {
  fetchDallasNowBuildingRecords,
  normalizeDallasNowRow,
  mergeDallasObservations,
  parseDallasNowXlsx,
} from '../markets/dfw/dallas-now.js';
import {toLeadInput} from '../markets/dfw/normalize.js';

const enc=new TextEncoder();

function u16(n){return [n&255,(n>>>8)&255]}
function u32(n){return [n&255,(n>>>8)&255,(n>>>16)&255,(n>>>24)&255]}
function concat(parts){
  const len=parts.reduce((n,p)=>n+p.length,0),out=new Uint8Array(len);let off=0;
  for(const p of parts){out.set(p,off);off+=p.length}return out;
}
function crc32(bytes){let crc=0xffffffff;for(const byte of bytes){crc^=byte;for(let bit=0;bit<8;bit++)crc=(crc>>>1)^((crc&1)?0xedb88320:0)}return (crc^0xffffffff)>>>0}
function storedZip(entries){
  const locals=[],centrals=[];let offset=0;
  for(const [name,text] of Object.entries(entries)){
    const nb=enc.encode(name),data=enc.encode(text);
    const local=new Uint8Array([
      ...u32(0x04034b50),...u16(20),...u16(0),...u16(0),...u16(0),...u16(0),...u32(crc32(data)),
      ...u32(data.length),...u32(data.length),...u16(nb.length),...u16(0),...nb,...data
    ]);
    locals.push(local);
    const central=new Uint8Array([
      ...u32(0x02014b50),...u16(20),...u16(20),...u16(0),...u16(0),...u16(0),...u16(0),...u32(crc32(data)),
      ...u32(data.length),...u32(data.length),...u16(nb.length),...u16(0),...u16(0),...u16(0),...u16(0),...u32(0),...u32(offset),...nb
    ]);
    centrals.push(central);offset+=local.length;
  }
  const central=concat(centrals),body=concat(locals);
  const eocd=new Uint8Array([
    ...u32(0x06054b50),...u16(0),...u16(0),...u16(centrals.length),...u16(centrals.length),
    ...u32(central.length),...u32(body.length),...u16(0)
  ]);
  return concat([body,central,eocd]);
}
function esc(s=''){return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')}
function col(n){let s='';for(n++;n;n=Math.floor((n-1)/26))s=String.fromCharCode(65+(n-1)%26)+s;return s}
const headers=['Record Type','Record ID','DallasNow Link','Record Status','Opened Date','Issued Date','Description of Work','Existing Land Use','Proposed Land Use','Valuation','Applicant Name','Applicant Business Name','Record Address','Parcel Number','Council District'];

function workbook(rows,{submitted=false,transform=x=>x}={}){
  const headerRow=submitted?7:4;
  const offset=submitted?3:0;
  const cell=(r,c,v)=>{
    const ref=col(c)+r;
    if(v===null||v===undefined||v==='')return `<c r="${ref}" t="str"></c>`;
    return `<c r="${ref}" t="inlineStr"><is><t xml:space="preserve">${esc(v)}</t></is></c>`;
  };
  let xml='<?xml version="1.0" encoding="utf-8"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheetData>';
  xml+=`<row r="${headerRow}">`;
  headers.forEach((h,i)=>xml+=cell(headerRow,i+(submitted&&i>0?offset:0),h));
  xml+='</row>';
  const rels=[];const links=[];
  rows.forEach((row,ri)=>{
    const rn=headerRow+1+ri;xml+=`<row r="${rn}">`;
    headers.forEach((h,i)=>{
      const ci=i+(submitted&&i>0?offset:0);xml+=cell(rn,ci,row[h]);
      if(h==='DallasNow Link'){
        const ref=col(ci)+rn,id='rId'+(ri+1);
        links.push(`<hyperlink ref="${ref}" r:id="${id}"/>`);
        rels.push(`<Relationship Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/hyperlink" Target="${esc(row._url)}" TargetMode="External" Id="${id}" />`);
      }
    });
    xml+='</row>';
  });
  xml+='</sheetData><hyperlinks>'+links.join('')+'</hyperlinks></worksheet>';
  const rel='<?xml version="1.0" encoding="utf-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'+rels.join('')+'</Relationships>';
  return storedZip({
    '[Content_Types].xml':'<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/></Types>',
    'xl/workbook.xml':'<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Dallas" sheetId="1" r:id="rId1"></sheet></sheets></workbook>',
    'xl/_rels/workbook.xml.rels':'<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Target="worksheets/sheet1.xml" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet"></Relationship></Relationships>',
    'xl/worksheets/sheet1.xml':transform(xml),'xl/worksheets/_rels/sheet1.xml.rels':rel});
}

const submittedRows=[
  {'Record Type':'Commercial Alteration Addition Permit','Record ID':'COM-ALT-ADD-26-009999','DallasNow Link':'REC26-00000-TEST1','Record Status':'Pending','Opened Date':'09/29/2026','Issued Date':null,'Description of Work':'Interior tenant improvement with HVAC and electrical','Existing Land Use':'Office','Proposed Land Use':'Office','Valuation':'500000','Applicant Name':'Alex Applicant','Applicant Business Name':'Example Dallas LLC','Record Address':'100 MAIN ST, Dallas, TX 75201','Parcel Number':'PARCEL1','Council District':'14',_url:'https://aca-prod.accela.com/DALLASTX/Cap/CapDetail.aspx?Module=Building&capID1=REC26&capID2=00000&capID3=TEST1'},
  {'Record Type':'Commercial New Construction Permit','Record ID':'26TMP-199999','DallasNow Link':'26EST-00000-TEMP1','Record Status':null,'Opened Date':'09/30/2026','Issued Date':null,'Description of Work':'New commercial shell building','Existing Land Use':null,'Proposed Land Use':'Office','Valuation':'2500000','Applicant Name':'Temp Applicant','Applicant Business Name':'Temporary Development LLC','Record Address':'200 ELM ST, Dallas, TX 75202','Parcel Number':null,'Council District':null,_url:'https://aca-prod.accela.com/DALLASTX/Cap/CapDetail.aspx?Module=Building&capID1=26EST&capID2=00000&capID3=TEMP1'}
];
const issuedRows=[
  {...submittedRows[0],'Record Status':'Inspection Phase','Issued Date':'09/30/2026'},
  {'Record Type':'Commercial New Construction Permit','Record ID':'COM-NEW-26-009999','DallasNow Link':'REC26-00000-TEST2','Record Status':'Issued','Opened Date':'09/25/2026','Issued Date':'09/30/2026','Description of Work':'New warehouse construction','Existing Land Use':'Vacant','Proposed Land Use':'Warehouse','Valuation':'3000000','Applicant Name':'Jordan Person','Applicant Business Name':'Warehouse Builders Inc','Record Address':'300 COMMERCE ST\nDallas, TX 75203','Parcel Number':'PARCEL2','Council District':'2',_url:'https://aca-prod.accela.com/DALLASTX/Cap/CapDetail.aspx?Module=Building&capID1=REC26&capID2=00000&capID3=TEST2'}
];

const submittedXlsx=workbook(submittedRows,{submitted:true});
const issuedXlsx=workbook(issuedRows);

function parameterHtml(id){
  const issued=id==='8279';
  const s=issued?'Start_DYNAMIC_ISS':'Start_DYNAMIC_SUB',e=issued?'End_DYNAMIC_ISS':'End_DYNAMIC_SUB',d=issued?'District_DYNAMIC_ISS':'District_DYNAMIC_SUB';
  return `<form method="post">
    <input type="hidden" name="ACA_CS_FIELD" value="csrf-${id}">
    <input type="hidden" name="__VIEWSTATE" value="view-${id}">
    <input type="hidden" name="__VIEWSTATEGENERATOR" value="gen-${id}">
    <input type="hidden" name="__VIEWSTATEENCRYPTED" value="">
    <label for="${s}">Start Date:</label><input name="ctl$${s}" id="${s}">
    <label for="${e}">End Date:</label><input name="ctl$${e}" id="${e}">
    <label for="${d}">Council District:</label><select name="ctl$${d}" id="${d}"><option value="ALL">ALL</option></select>
  </form>`;
}
function response(body,{status=200,headers={}}={}){return new Response(body,{status,headers})}
function mockDallasFetch(){
  const state=new Map();
  return async (url,opts={})=>{
    assert.equal(opts.redirect,'manual');
    const u=new URL(url),id=u.searchParams.get('reportID'),method=String(opts.method||'GET').toUpperCase();
    if(u.pathname.endsWith('/ReportParameter.aspx')&&method==='GET'){
      const h=new Headers({'content-type':'text/html'});h.append('set-cookie',`SESSION_${id}=s${id}; Path=/; HttpOnly`);
      return new Response(parameterHtml(id),{status:200,headers:h});
    }
    if(u.pathname.endsWith('/ReportParameter.aspx')&&method==='POST'){
      assert.match(String(opts.headers?.cookie||opts.headers?.Cookie||''),new RegExp(`SESSION_${id}=s${id}`));
      const p=new URLSearchParams(opts.body);
      assert.equal(p.get('__VIEWSTATE'),`view-${id}`);assert.equal(p.get('ACA_CS_FIELD'),`csrf-${id}`);
      assert.equal(p.get('__EVENTTARGET'),'btnSave');assert.equal(p.get('ctl$'+(id==='8279'?'District_DYNAMIC_ISS':'District_DYNAMIC_SUB')),'ALL');
      assert.ok(p.get('ctl$'+(id==='8279'?'Start_DYNAMIC_ISS':'Start_DYNAMIC_SUB')));assert.ok(p.get('ctl$'+(id==='8279'?'End_DYNAMIC_ISS':'End_DYNAMIC_SUB')));
      state.set(id,true);
      return response(`<script>var x="/DALLASTX/Report/ShowReport.aspx?module=Building&reportID=${id}&reportType=LINK_REPORT_LIST";</script>`,{headers:{'content-type':'text/html'}});
    }
    if(u.pathname.endsWith('/ShowReport.aspx')&&method==='GET'){
      assert.equal(state.get(id),true);assert.match(String(opts.headers?.cookie||opts.headers?.Cookie||''),new RegExp(`SESSION_${id}=s${id}`));
      return response(id==='8279'?issuedXlsx:submittedXlsx,{headers:{'content-type':'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'}});
    }
    throw new Error('Unexpected Dallas fetch '+method+' '+url);
  };
}

const results=[];
async function check(name,fn){await fn();results.push(name);console.log('PASS '+name)}

await check('XLSX parser handles real Dallas sparse header shape and hyperlinks',async()=>{
  const p=await parseDallasNowXlsx(submittedXlsx.buffer);
  assert.equal(p.rows.length,2);assert.equal(p.rows[0]['Record ID'],'COM-ALT-ADD-26-009999');
  assert.equal(p.rows[0]._DallasNowURL,submittedRows[0]._url);
  assert.ok(p.headers.includes('Applicant Business Name'));
});

await check('normalizer keeps applicant business separate from contractor semantics',async()=>{
  const n=normalizeDallasNowRow(submittedRows[0],{observation:'submitted',now:Date.parse('2026-09-30T18:00:00Z')});
  assert.equal(n.market,'Dallas');assert.equal(n.companyCandidate,'Example Dallas LLC');
  assert.equal(n.participants.some(x=>x.role==='contractor'),false);
  assert.equal(n.participants.find(x=>x.name==='Example Dallas LLC').role,'applicant');
  assert.equal(n.valuation,500000);assert.equal(n.temporaryId,false);assert.match(n.secondaryFingerprint,/^dallas-v1:/);
});

await check('Submitted plus Issued exact Record ID dedupe prefers Issued and preserves provenance',async()=>{
  const now=Date.parse('2026-09-30T18:00:00Z');
  const s=submittedRows.map(r=>normalizeDallasNowRow(r,{observation:'submitted',now}));
  const i=issuedRows.map(r=>normalizeDallasNowRow(r,{observation:'issued',now}));
  const merged=mergeDallasObservations(s,i);
  assert.equal(merged.length,3);assert.equal(merged._meta.exactOverlapCount,1);assert.equal(merged._meta.temporaryIdCount,1);
  const overlap=merged.find(x=>x.sourceRecordId==='COM-ALT-ADD-26-009999');
  assert.equal(overlap.statusRaw,'Inspection Phase');assert.equal(overlap.sourceObservations.length,2);
  assert.equal(overlap.eventDate,'2026-09-30T00:00:00.000Z');
});

await check('report client performs anonymous stateful GET POST XLSX flow with rolling dates',async()=>{
  const now=Date.parse('2026-09-30T18:00:00Z');
  const rows=await fetchDallasNowBuildingRecords({days:7,now,fetchFn:mockDallasFetch()});
  assert.equal(rows.length,3);assert.equal(rows._meta.submittedCount,2);assert.equal(rows._meta.issuedCount,2);
  assert.equal(rows._meta.exactOverlapCount,1);assert.equal(rows._reports.startDate,'09/24/2026');assert.equal(rows._reports.endDate,'09/30/2026');
});

const workerUrl=new URL('../worker.js',import.meta.url);
const source=await readFile(workerUrl,'utf8');
const testSource=source.replace(/from '(\.\/[^']+)'/g,(_,path)=>`from '${new URL(path,workerUrl).href}'`)
  +'\nexport {fetchMarket,marketFromSource,MARKETS,LIVE_MARKETS,PLANS,leadFrom,persist,hydrateStoredLead,clusterLeads,publicOpportunityTeaser};';
const core=await import('data:text/javascript;base64,'+Buffer.from(testSource).toString('base64'));

await check('worker routes Dallas through unchanged leadFrom scoring and preserves direct provenance fields',async()=>{
  const original=globalThis.fetch;globalThis.fetch=mockDallasFetch();
  try{
    const rows=await core.fetchMarket('Dallas',7,10);
    assert.equal(rows.length,3);assert.ok(rows.every(x=>x.market==='Dallas'));
    const lead=rows.find(x=>x.permit==='COM-ALT-ADD-26-009999');
    assert.ok(lead);assert.equal(lead.company,'Example Dallas LLC');assert.equal(lead.participantRole,'applicant');
    assert.equal(lead.temporaryId,false);assert.equal(lead.sourceObservations.length,2);assert.match(lead.source,/Submitted \+ Issued/);
    assert.match(lead.source,/aca-prod\.accela\.com/);
    const normalized=(await fetchDallasNowBuildingRecords({days:7,now:Date.parse('2026-09-30T18:00:00Z'),fetchFn:mockDallasFetch()}))
      .find(x=>x.sourceRecordId===lead.sourceRecordId);
    const expected=core.leadFrom({...toLeadInput(normalized),source:lead.source});
    assert.equal(lead.score,expected.score);assert.deepEqual(lead.scoreBreakdown,expected.scoreBreakdown);
  }finally{globalThis.fetch=original}
});

await check('single-market /api/leads request uses the live Dallas adapter path',async()=>{
  const original=globalThis.fetch;globalThis.fetch=mockDallasFetch();
  try{
    const res=await core.default.fetch(new Request('https://preview.invalid/api/leads?markets=Dallas&days=7&limit=20',{headers:{authorization:'Bearer diagnostic-test'}}),{ADMIN_TOKEN:'diagnostic-test'});
    const data=await res.json();assert.equal(res.status,200);assert.equal(data.liveDirect,true);
    assert.deepEqual(data.markets,['Dallas']);assert.equal(data.leads.length,3);assert.ok(data.leads.every(x=>x.market==='Dallas'));
  }finally{globalThis.fetch=original}
});

await check('authenticated session can access Dallas full diagnostics',async()=>{
  const original=globalThis.fetch;globalThis.fetch=mockDallasFetch();
  const user={id:'dallas-test-user',email:'test@example.invalid',plan:'Territory',subscription_status:'active'};
  const DB={prepare(sql){return {bind(){return this},async first(){assert.match(sql,/FROM sessions/);return user},async run(){assert.match(sql,/UPDATE sessions/);return {success:true}}}}};
  try{
    const res=await core.default.fetch(new Request('https://preview.invalid/api/leads?markets=Dallas',{headers:{authorization:'Bearer session-test'}}),{DB});
    assert.equal(res.status,200);const data=await res.json();
    assert(data.leads.every(x=>x.permit&&x.sourceUrl&&x.participantRole==='applicant'&&x.sourceObservations.length));
  }finally{globalThis.fetch=original}
});

await check('Dallas registration is additive and Territory market limit remains six',async()=>{
  const expected=['Phoenix','Tempe','Tucson','Scottsdale','Mesa','Chandler','Fort Worth','Dallas'];
  assert.deepEqual(core.MARKETS,expected);assert.deepEqual(core.LIVE_MARKETS,expected);assert.equal(core.PLANS.Territory.marketLimit,6);
  assert.equal(core.marketFromSource('City of Dallas DallasNow Building'),'Dallas');
  const res=await core.default.fetch(new Request('https://preview.invalid/api/sources'),{});
  const data=await res.json();assert.equal(data.markets.Dallas.status,'live');assert.deepEqual(data.liveMarkets,expected);
});

await check('Dallas provenance survives real SQLite persist and hydrate including updates and temporary IDs',async()=>{
  const original=globalThis.fetch;globalThis.fetch=mockDallasFetch();
  const sqlite=new DatabaseSync(':memory:');
  sqlite.exec(`CREATE TABLE leads(id TEXT PRIMARY KEY,name TEXT,address TEXT,event_date TEXT,company TEXT,scope TEXT,score INTEGER,categories TEXT,value INTEGER,temperature TEXT,permit TEXT,permit_status TEXT,official_value REAL,source TEXT,market TEXT,updated_at TEXT)`);
  sqlite.exec(await readFile(new URL('../migrations/migration-v58-dallas-provenance.sql',import.meta.url),'utf8'));
  const db={prepare(sql){return {bind(...args){return {sql,args}}}},async batch(stmts){return stmts.map(({sql,args})=>sqlite.prepare(sql).run(...args))}};
  try{
    const leads=await core.fetchMarket('Dallas',7,10);
    await core.persist({DB:db},leads);
    await core.persist({DB:db},leads); // exercise ON CONFLICT as well as insert
    assert.equal(sqlite.prepare('SELECT count(*) AS n FROM leads').get().n,3);
    const fields=['sourceRecordId','sourceUrl','dallasNowLink','temporaryId','secondaryFingerprint','sourceObservations','participantRole','participants','lineage','identityHints','parcelNumber','councilDistrict'];
    for(const lead of leads){
      const stored=sqlite.prepare('SELECT * FROM leads WHERE id=?').get(lead.id);
      const hydrated=core.hydrateStoredLead(stored);
      for(const field of fields)assert.deepEqual(hydrated[field],lead[field],field);
      assert.equal(hydrated.source,lead.source);
      const teaser=core.publicOpportunityTeaser(hydrated);
      assert.deepEqual(Object.keys(teaser).sort(),['id','market','name','date','score','temperature','value','categories','stage','publicPreview'].sort());
      for(const field of [...fields,'source_provenance','permit','company','address','scope'])assert.equal(field in teaser,false,field);
      assert(!JSON.stringify(teaser).includes(lead.permit));
    }
    const other={...leads[0],id:'arizona-storage-check',market:'Mesa'};
    await core.persist({DB:db},[other]);
    assert.equal(sqlite.prepare('SELECT source_provenance FROM leads WHERE id=?').get(other.id).source_provenance,null);
  }finally{sqlite.close();globalThis.fetch=original}
});

for(const path of ['/leads','/api/leads','/score-audit','/api/score-audit','/temperature-calibration','/api/temperature-calibration']){
  await check('anonymous Dallas diagnostic blocked '+path,async()=>{
    const res=await core.default.fetch(new Request('https://preview.invalid'+path+'?markets=Dallas'),{});
    assert.equal(res.status,401);assert.deepEqual(Object.keys(await res.json()),['error']);
  });
}
await check('malformed ZIP and truncated ZIP fail closed',async()=>{
  for(const bytes of [enc.encode('not a zip'),submittedXlsx.slice(0,-10),submittedXlsx.slice(0,100)])await assert.rejects(parseDallasNowXlsx(bytes.buffer),/DallasNow/);
  const corrupt=submittedXlsx.slice();corrupt[100]^=1;
  await assert.rejects(parseDallasNowXlsx(corrupt.buffer),/integrity/);
});
for(const [name,transform] of [
 ['truncated worksheet',x=>x.slice(0,x.indexOf('</row>')+6)],
 ['truncated row with closing document',x=>x.replace('</c></row></sheetData>','</sheetData>')],
 ['missing sheetData',x=>x.replace(/<sheetData>[\s\S]*?<\/sheetData>/,'')],
 ['missing required headers',x=>x.replace('Opened Date','Unrecognized date')],
])await check(name+' rejected',async()=>{await assert.rejects(parseDallasNowXlsx(workbook(submittedRows,{transform}).buffer),/DallasNow/)});
await check('missing workbook content rejected',async()=>{await assert.rejects(parseDallasNowXlsx(storedZip({'xl/worksheets/sheet1.xml':'<worksheet><sheetData></sheetData></worksheet>'}).buffer),/required workbook content missing/)});
await check('missing worksheet rejected',async()=>{await assert.rejects(parseDallasNowXlsx(storedZip({'other.xml':'<root/>'}).buffer),/worksheet missing/)});
for(const field of ['Opened Date','Issued Date'])await check('invalid '+field+' rejected without current date fallback',async()=>{
  for(const value of [null,'not-a-date','02/30/2026','13/01/2026','09/31/2026','01/01/2099'])assert.throws(()=>normalizeDallasNowRow({...issuedRows[0],[field]:value},{observation:'issued'}),new RegExp(field));
});
await check('malformed optional Issued Date also rejects submitted record',async()=>{
  assert.throws(()=>normalizeDallasNowRow({...submittedRows[0],'Issued Date':'invalid'},{observation:'submitted'}),/Issued Date/);
});
await check('distinct Dallas records without usable property addresses never cluster',async()=>{
  for(const address of [null,'','Dallas','Dallas TX','Dallas, Texas','TX','Texas','Dallas TX 75201']){
    const leads=submittedRows.map(row=>{
      const normalized=normalizeDallasNowRow({...row,'Record Address':address},{observation:'submitted'});
      return core.leadFrom({...toLeadInput(normalized),source:'City of Dallas DallasNow Building'});
    });
    assert.equal(core.clusterLeads(leads).length,2,String(address));
  }
});
for(const redirectAt of [1,2,3])await check('redirect at report request '+redirectAt+' is explicitly rejected without forwarding cookies',async()=>{
  const mock=mockDallasFetch();const calls=new Map();
  await assert.rejects(fetchDallasNowBuildingRecords({fetchFn:async(url,opts)=>{
    const id=new URL(url).searchParams.get('reportID');calls.set(id,(calls.get(id)||0)+1);assert.equal(opts.redirect,'manual');
    if(calls.get(id)===redirectAt)return response('',{status:302,headers:{location:'https://untrusted.invalid/','set-cookie':'redirect-session=private'}});
    return mock(url,opts);
  }}),/unexpected redirect/);
  assert([...calls.values()].every(n=>n<=redirectAt));
  assert([...calls.values()].some(n=>n===redirectAt));
});
await check('control label IDs resolve actual names and sessions stay isolated per report',async()=>{
  const mock=mockDallasFetch();
  await fetchDallasNowBuildingRecords({fetchFn:async(url,opts)=>{
    const id=new URL(url).searchParams.get('reportID');
    assert(!String(opts.headers.cookie||'').includes('SESSION_'+(id==='8279'?'8280':'8279')));
    return mock(url,opts);
  }});
});
await check('missing named control fails closed',async()=>{
  await assert.rejects(fetchDallasNowBuildingRecords({fetchFn:async()=>response(parameterHtml('8279').replace(/name="ctl\$Start[^" ]*"/,''))}),/control missing/);
});
await check('report failure returns authenticated 503 without stored or refresh fallback',async()=>{
  const original=globalThis.fetch;globalThis.fetch=async()=>response('malformed');
  try{
    const res=await core.default.fetch(new Request('https://preview.invalid/api/leads?markets=Dallas',{headers:{authorization:'Bearer diagnostic-test'}}),{ADMIN_TOKEN:'diagnostic-test'});
    assert.equal(res.status,503);const body=await res.json();assert.equal(body.code,'dallas_source_unavailable');assert.equal('leads' in body,false);
  }finally{globalThis.fetch=original}
});
console.log(`${results.length}/${results.length} Dallas integration checks passed`);
