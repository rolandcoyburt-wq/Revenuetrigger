// Reproducible synthetic scale qualification. Local SQLite only; never connects to D1.
// node --expose-gc backend/tests/personalized-feed-scale.mjs [selectedRows=30000]
import {DatabaseSync} from 'node:sqlite';
import {readFile} from 'node:fs/promises';
import assert from 'node:assert/strict';
const worker=new URL('../worker.js',import.meta.url);
const source=(await readFile(worker,'utf8')).replace(/from '(\.\/[^']+)'/g,(_,p)=>`from '${new URL(p,worker).href}'`);
const {listLeadsForUser}=await import('data:text/javascript;base64,'+Buffer.from(source+'\nexport {listLeadsForUser};').toString('base64'));
globalThis.fetch=()=>{throw Error('Network prohibited in scale qualification')};
const count=Number(process.argv[2]||30000);assert(Number.isInteger(count)&&count>=600&&count%6===0);
const db=new DatabaseSync(':memory:');
db.exec(`CREATE TABLE leads(id TEXT PRIMARY KEY,name TEXT,address TEXT,event_date TEXT,company TEXT,scope TEXT,score INTEGER,categories TEXT,value INTEGER,temperature TEXT,permit TEXT,permit_status TEXT,official_value REAL,source TEXT,market TEXT,updated_at TEXT,source_provenance TEXT);
CREATE INDEX idx_leads_score_date ON leads(score DESC,event_date DESC);
CREATE INDEX idx_leads_market_event ON leads(market,event_date DESC);
CREATE TABLE preferences(user_id TEXT,industries TEXT,markets TEXT,min_score INTEGER,alert_frequency TEXT);
CREATE TABLE saved_leads(user_id TEXT,lead_id TEXT);`);
if(process.env.FEED_BENCH_INDEX==='1')db.exec(await readFile(new URL('../migrations/migration-v59-personalized-feed-index.sql',import.meta.url),'utf8'));
const markets=['Phoenix','Tempe','Mesa','Chandler','Fort Worth','Dallas'],industries=['Commercial services','HVAC','Electrical','Plumbing','Roofing','Landscaping','Security','Signage'];
const insert=db.prepare('INSERT INTO leads VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)');
let provenanceBytes=0;
db.exec('BEGIN');
for(let i=0;i<count+10000;i++){
 const market=i<count?markets[i%6]:(i%2?'Tucson':'Dallas'),id=`scale-${String(i).padStart(8,'0')}`;
 const date=new Date(Date.now()-(i<count?1+i%89:120)*86400000).toISOString();
 const scope='Commercial interior tenant improvement with mechanical, electrical and plumbing work. '.repeat(8);
 const url=`https://developmentservices.dallascityhall.com/Default.aspx?TabName=Building&record=${id}`;
 const provenance=market==='Dallas'?JSON.stringify({sourceRecordId:id,sourceUrl:url,dallasNowLink:url,temporaryId:i%3===0,secondaryFingerprint:`Dallas|${id}|${date}`,participantRole:'applicant',participants:[{name:'Synthetic Applicant Business LLC',role:'applicant',type:'business'}],sourceObservations:['Submitted','Issued'].map(stage=>({stage,date,reportId:stage==='Submitted'?'8280':'8279',sourceUrl:url,raw:{'Project Description':scope,'Applicant':'Synthetic Applicant Business LLC','Opened Date':date,'Address':`${i+1000} Sample Avenue`}})),lineage:{source:'DallasNow',reports:['8280','8279']}}):null;
 if(market==='Dallas'&&i<count)provenanceBytes+=Buffer.byteLength(provenance);
 insert.run(id,'Commercial interior improvement',`${i+1000} Sample Avenue`,date,'Synthetic Applicant Business LLC',scope,90,JSON.stringify(industries),90000,'HOT',id,'Application',850000,'Synthetic scale source',market,date,provenance);
}
db.prepare('INSERT INTO preferences VALUES (?,?,?,?,?)').run('scale',JSON.stringify(industries),JSON.stringify(markets),0,'none');db.exec('COMMIT');
console.log(JSON.stringify({population90daySixMarkets:count,totalRows:count+10000,dallasAverageProvenanceBytes:Math.round(provenanceBytes/(count/6)),sqlite:db.prepare('select sqlite_version() v').get().v}));
for(const sparse of [false,true]){
 if(sparse)db.exec(`UPDATE leads SET categories='[]' WHERE CAST(substr(id,7) AS INTEGER)%100<>0`);
 let pages=0,rows=0,rawBytes=0,peakHeap=0,peakRss=0,queryMs=0,plan;
 global.gc?.();const before=process.memoryUsage();
 const DB={prepare(sql){return {args:[],bind(...args){this.args=args;return this},async first(){return db.prepare(sql).get(...this.args)},async all(){const t=performance.now();const results=db.prepare(sql).all(...this.args);queryMs+=performance.now()-t;if(sql.includes('FROM leads')){pages++;rows+=results.length;rawBytes+=Buffer.byteLength(JSON.stringify(results));if(!plan)plan=db.prepare('EXPLAIN QUERY PLAN '+sql).all(...this.args)}const m=process.memoryUsage();peakHeap=Math.max(peakHeap,m.heapUsed);peakRss=Math.max(peakRss,m.rss);return {results}}}}};
 const start=performance.now();const result=await listLeadsForUser({DB},{id:'scale',plan:'Territory',subscription_status:'active'});
 const elapsed=performance.now()-start,m=process.memoryUsage();peakHeap=Math.max(peakHeap,m.heapUsed);peakRss=Math.max(peakRss,m.rss);
 assert.equal(rows,count);assert.equal(result.leads.length,sparse?Math.min(500,count/100):500);
 if(process.env.FEED_BENCH_INDEX==='1'){assert(plan.some(x=>x.detail.includes('idx_leads_market_event_cursor')));assert(!plan.some(x=>x.detail.includes('TEMP B-TREE')))}
 console.log(JSON.stringify({scenario:sparse?'Any score / sparse 1% industry match':'Any score / all eight industries',candidateQueries:pages,rowsReturnedBySql:rows,rowsScanned:'not exposed by node:sqlite',queryMs:Math.round(queryMs),endToEndMs:Math.round(elapsed),rawCandidateBytes:rawBytes,resultBytes:Buffer.byteLength(JSON.stringify(result)),sampledPeakHeapBytes:peakHeap,heapGrowthBytes:peakHeap-before.heapUsed,sampledPeakRssBytes:peakRss,queryPlan:plan}));
}
db.close();
