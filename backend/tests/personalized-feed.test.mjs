import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFile} from 'node:fs/promises';
const url=new URL('../worker.js',import.meta.url),source=await readFile(url,'utf8');
const seam=source.replace(/from '(\.\/[^']+)'/g,(_,p)=>`from '${new URL(p,url).href}'`)+'\nexport {listLeadsForUser,hydrateStoredLead,clusterLeads,minimumScore,publicUser,PLANS};';
const core=await import('data:text/javascript;base64,'+Buffer.from(seam).toString('base64'));
const sqlite=new DatabaseSync(':memory:');
sqlite.exec(`CREATE TABLE leads(id TEXT PRIMARY KEY,name TEXT,address TEXT,event_date TEXT,company TEXT,scope TEXT,score INTEGER,categories TEXT,value INTEGER,temperature TEXT,permit TEXT,permit_status TEXT,official_value REAL,source TEXT,market TEXT,updated_at TEXT,source_provenance TEXT);
CREATE TABLE preferences(user_id TEXT PRIMARY KEY,industries TEXT,markets TEXT,min_score INTEGER,alert_frequency TEXT,updated_at TEXT);
CREATE TABLE saved_leads(user_id TEXT,lead_id TEXT);`);
let activeUser,queries=[];
const DB={prepare(sql){return {args:[],bind(...args){this.args=args;return this},async first(){if(sql.includes('FROM sessions'))return activeUser;return sqlite.prepare(sql).get(...this.args)||null},async all(){queries.push({sql,args:this.args});return {results:sqlite.prepare(sql).all(...this.args)}},async run(){if(sql.includes('UPDATE sessions'))return {success:true};return sqlite.prepare(sql).run(...this.args)}}}};
const markets=['Phoenix','Tempe','Mesa','Chandler','Dallas','Fort Worth'];
const industries=['Commercial services','HVAC','Electrical','Plumbing','Roofing','Landscaping','Security','Signage'];
const insert=sqlite.prepare('INSERT INTO leads VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)');
function row(id,market,categories,age=1,score=90){return {id,name:'Commercial tenant improvement',address:`${10000+Number(id.replace(/\D/g,''))} Unique Avenue ${market}`,event_date:new Date(Date.now()-age*86400000).toISOString(),company:'Example Company LLC',scope:'New commercial office tenant improvement build out HVAC mechanical electrical plumbing roofing fire alarm security',score,categories:JSON.stringify(categories),value:90000,temperature:'HOT',permit:id,permit_status:'Application',official_value:850000,source:'City test source',market,updated_at:new Date().toISOString(),source_provenance:null}}
function add(x){insert.run(...Object.values(x))}
let checks=0;async function check(name,fn){await fn();checks++;console.log('PASS '+name)}
function prefs(plan,score){activeUser={id:'qa',email:'qa@example.test',plan,subscription_status:'active'};const ent=core.PLANS[plan];sqlite.prepare('INSERT OR REPLACE INTO preferences VALUES (?,?,?,?,?,?)').run('qa',JSON.stringify(industries.slice(0,ent.industryLimit)),JSON.stringify(markets.slice(0,ent.marketLimit)),score,'none',new Date().toISOString());queries=[]}
const originalFetch=globalThis.fetch;globalThis.fetch=()=>{throw Error('No network allowed')};
try{
 for(let i=0;i<3000;i++)add(row('other'+i,'Tucson',industries,1,99));
 // More than a page of industry mismatches before eligible selected records.
 for(let i=0;i<600;i++)add(row('a'+i,'Phoenix',['Unmatched synthetic category']));
 for(let i=0;i<900;i++)add(row('z'+i,markets[i%6],[industries[i%8]]));
 for(let i=0;i<100;i++)add(row('old'+i,'Phoenix',['Commercial services'],100));
 // Distinct low-score data verifies that Any score does not add a SQL threshold.
 const low=row('low1','Phoenix',['Commercial services']);low.name='Record';low.scope='';low.company='';low.official_value=null;low.permit_status='';low.score=0;add(low);
 for(const plan of ['Scout','Hunter','Territory'])for(const score of [0,40,60,75,80])await check(`${plan} score ${score}: selected candidates, history, ranking, cap and saved state`,async()=>{
  prefs(plan,score);const cap=plan==='Scout'?80:plan==='Hunter'?250:500,ent=core.PLANS[plan];
  const selected=markets.slice(0,ent.marketLimit),chosen=industries.slice(0,ent.industryLimit);
  const raw=sqlite.prepare("SELECT * FROM leads WHERE datetime(event_date)>=datetime('now',?)").all(`-${ent.historyDays} days`).filter(x=>selected.includes(x.market)&&(score===0||x.score>=score));
  const expected=core.clusterLeads(raw.map(core.hydrateStoredLead)).filter(x=>x.score>=score&&x.categories.some(c=>chosen.includes(c))).sort((a,b)=>b.score-a.score||(Date.parse(b.date)||0)-(Date.parse(a.date)||0)||String(a.id).localeCompare(String(b.id))).slice(0,cap);
  assert(expected.length>0,'Fixture must exercise eligible results at this threshold');
  sqlite.exec('DELETE FROM saved_leads');sqlite.prepare('INSERT INTO saved_leads VALUES (?,?)').run('qa',expected[0].id);
  const result=await core.listLeadsForUser({DB},activeUser,{limit:9999,days:999});
  assert.deepEqual(result.leads.map(x=>x.id),expected.map(x=>x.id));assert(result.leads[0].saved);assert(result.leads.length<=cap);assert.equal(result.historyDays,ent.historyDays);assert.equal(result.preferences.minScore,score);
  const reads=queries.filter(q=>q.sql.includes('FROM leads'));assert(reads.length>=1);for(const q of reads){assert(q.sql.includes('market IN'));assert.equal(q.sql.includes('score >= ?'),score>0);assert.equal(q.args[0],`-${ent.historyDays} days`)}
  if(plan==='Scout')assert(reads.length>1,'must page beyond industry mismatches');
 });
 for(const plan of ['Scout','Hunter','Territory'])await check(`${plan} result cap and history boundary`,async()=>{
  sqlite.exec('DELETE FROM leads');for(let i=0;i<3000;i++)add(row('other'+i,'Tucson',industries,1,99));prefs(plan,0);const cap=plan==='Scout'?80:plan==='Hunter'?250:500,days=core.PLANS[plan].historyDays;
  for(let i=0;i<cap+10;i++)add(row('eligible'+i,'Phoenix',['Commercial services'],days-0.1));
  add(row('expired9999','Phoenix',['Commercial services'],days+0.1));
  const oldPool=sqlite.prepare("SELECT * FROM leads WHERE datetime(event_date)>=datetime('now',?) ORDER BY score DESC,event_date DESC LIMIT ?").all(`-${days} days`,cap*5);assert.equal(oldPool.filter(x=>x.market==='Phoenix').length,0,'old global pool starves selected market');
  let d=await core.listLeadsForUser({DB},activeUser);assert.equal(d.leads.length,cap);assert(!d.leads.some(x=>x.id==='expired9999'));
  d=await core.listLeadsForUser({DB},activeUser,{limit:5,days:1});assert.equal(d.leads.length,0);assert.equal(d.historyDays,1);
  d=await core.listLeadsForUser({DB},activeUser,{limit:5});assert.equal(d.leads.length,5);
 });
 for(const score of [0,40,60,75,80])await check(`preferences route persists and reloads score ${score}`,async()=>{
  prefs('Territory',70);const response=await core.default.fetch(new Request('https://test.invalid/api/preferences',{method:'POST',headers:{Authorization:'Bearer test','Content-Type':'application/json'},body:JSON.stringify({industries,markets,minScore:score})}),{DB});assert.equal(response.status,200);const d=await response.json();assert.equal(d.user.preferences.minScore,score);assert.equal((await core.publicUser({DB},activeUser)).preferences.minScore,score);
 });
 await check('Any score includes low-score record and paid entitlement truncation is preserved',async()=>{
  sqlite.exec('DELETE FROM leads');add(low);prefs('Scout',0);let d=await core.listLeadsForUser({DB},activeUser);assert.equal(d.leads.length,1);assert(d.leads[0].score<70);
  sqlite.prepare('UPDATE preferences SET markets=?,industries=?').run(JSON.stringify(markets),JSON.stringify(industries));d=await core.listLeadsForUser({DB},activeUser);assert.equal(d.preferences.markets.length,1);assert.equal(d.preferences.industries.length,1);
 });
 await check('inactive paid subscription retains Beta limits',async()=>{prefs('Territory',0);activeUser.subscription_status='canceled';const d=await core.listLeadsForUser({DB},activeUser,{limit:500,days:90});assert.equal(d.plan,'Beta');assert.equal(d.historyDays,7);assert.equal(d.preferences.markets.length,1);assert.equal(d.preferences.industries.length,1)});
 console.log(`${checks}/${checks} personalized-feed checks passed; in-memory SQLite only.`);
}finally{globalThis.fetch=originalFetch;sqlite.close()}
