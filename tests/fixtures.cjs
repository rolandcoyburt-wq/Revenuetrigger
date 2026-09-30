// Synthetic records only. No production records, credentials, or API calls.
const markets=['Phoenix','Tempe','Tucson','Scottsdale','Mesa','Chandler'];
const leads=markets.map((market,i)=>({id:`qa-${i}`,market,name:['Restaurant tenant improvement','Commercial roof replacement','Medical office build-out','Retail electrical upgrade','Warehouse HVAC upgrade','Commercial gas line repair'][i],address:`QA fixture · ${market}, AZ`,scope:'Synthetic QA record — commercial interior improvements with mechanical, electrical and plumbing scope.',date:new Date(Date.now()-i*3600000).toISOString(),company:i%2?'':'QA Example Contractor LLC',companyRole:'Contractor',score:85-i*5,temperature:i<3?'HOT':'WARM',value:38000+i*1000,officialPermitValue:250000,permit:`QA-00${i}`,permitStatus:'Issued',source:'Synthetic test fixture',categories:['HVAC','Electrical','Plumbing'],saved:i===0,lifecycle:{stage:'PERMIT ISSUED',index:3,steps:['PRE-TECH','PLANNING','APPLICATION','PERMIT ISSUED','CONSTRUCTION','COMPLETE']},actionIntelligence:{firstMover:72,opportunityWindow:{label:'Active',detail:'QA timing explanation'},buyingWindow:{label:'Review now',detail:'QA buying window'},momentum:{label:'Rising'},whyNow:'QA fixture: recently issued commercial permit.',nextBestAction:{action:'Review the published record',reason:'Verify scope and participants before outreach.'}},dataConfidence:{score:80,reasons:['Synthetic QA evidence']}}));
const user={email:'qa@example.test',onboardingComplete:true,plan:'Hunter',subscriptionStatus:'active',savedCount:1,preferences:{industries:['HVAC'],markets:['Phoenix'],minScore:60},entitlements:{industryLimit:3,marketLimit:3,export:true,historyDays:30,alert:'daily'}};
async function mock(page,options={}){
 const calls=[];
 await page.route('**/*',async route=>{
  const url=new URL(route.request().url());
  if(url.hostname==='127.0.0.1')return route.continue();
  if(url.hostname!=='api.revenuetrigger.ai')return route.abort();
  calls.push({path:url.pathname,query:url.search,method:route.request().method(),body:route.request().postData(),auth:route.request().headers().authorization});
  const path=url.pathname.replace('/api','');let body={ok:true};let status=200;
  if(options.fail?.includes(path)){status=503;body={error:'Synthetic unavailable response'};}
  else if(path==='/me'){body={user};if(options.expired){status=401;body={error:'Expired test session'}}}
  else if(path==='/leads'||path==='/dashboard')body={leads:leads.filter(x=>!url.searchParams.get('markets')||url.searchParams.get('markets')===x.market)};
  else if(path==='/pipeline')body={pipeline:leads.slice(0,2).map(x=>({...x,market:'Chandler',stage:'PRE-TECH'})),sourceStatus:options.degraded?'degraded':'live'};
  else if(path==='/source-health')body={status:options.degraded?'degraded':'live'};
  else if(path==='/sources')body={sources:markets.map(m=>({market:m,status:'live'}))};
  else if(path==='/changes-teaser')body={opportunities:6};
  else if(path==='/changes')body={summary:{opportunities:6,hot:3},competitorMoves:[]};
  else if(path==='/auth/verify')body={session:'qa-session',user};
  else if(path==='/billing/sync'||path==='/preferences')body={user};
  else if(path==='/billing/checkout'||path==='/billing/portal')body={url:'http://127.0.0.1:8765/?qa-billing=1'};
  else if(path==='/competitors')body={companies:[{company:'QA Example Contractor LLC',permitCount:3,marketCount:1,markets:['Phoenix'],reportedValue:250000,avgScore:85,recentProjects:[leads[0]],entityMatchConfidence:80}],totalCount:1};
  else if(path==='/relationships')body={historyFound:true,projectCount:3,permitLinkedRecordCount:3,territoryHistory:[{market:'Phoenix',count:3}],frequentlyAppearsWith:[{company:'QA Associated Company',sharedProjectCount:2,evidenceStrength:'repeated',markets:['Phoenix']}],relationshipSummary:{repeatedAssociationCount:1}};
  else if(path==='/competitor-watchlist')body={items:[]};
  else if(path==='/export.csv')return route.fulfill({status:200,contentType:'text/csv',body:'id,name\nqa-0,QA test\n'});
  await route.fulfill({status,contentType:'application/json',body:JSON.stringify(body)});
 });
 return calls;
}
module.exports={mock,leads,user};
