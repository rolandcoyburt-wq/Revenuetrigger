// RevenueTrigger V3 — Cloudflare Worker
// Public-data opportunity feed + D1 persistence + passwordless auth + saved leads
// + plan entitlements + Stripe Checkout/Portal/Webhooks + Resend email alerts.
//
// Secrets (wrangler secret put ...):
//   ADMIN_TOKEN
//   RESEND_API_KEY
//   STRIPE_SECRET_KEY
//   STRIPE_WEBHOOK_SECRET
//
// Vars (wrangler.toml):
//   ALLOWED_ORIGIN, FRONTEND_URL, EMAIL_FROM
//   STRIPE_PRICE_SCOUT, STRIPE_PRICE_HUNTER, STRIPE_PRICE_TERRITORY
//   DEV_AUTH_BYPASS=false

import { fetchFortWorthPermits } from './markets/dfw/fort-worth.js';
import { fetchDallasNowBuildingRecords } from './markets/dfw/dallas-now.js';
import { toLeadInput } from './markets/dfw/normalize.js';

const PHX_PERMITS='https://maps.phoenix.gov/pub/rest/services/Public/Planning_Permit/MapServer/1/query';
const TEMPE_PERMITS='https://services.arcgis.com/lQySeXwbBg53XWDi/ArcGIS/rest/services/building_permits/FeatureServer/0/query';
const TUCSON_PRO_BASE='https://pro.tucsonaz.gov';
const SCOTTSDALE_REPORTS='https://eservices.scottsdaleaz.gov/bldgresources/BuildingPermit/Reports';
const SCOTTSDALE_CSV='https://eservices.scottsdaleaz.gov/bldgresources/BuildingPermit/DownloadCSVReport';
const MESA_PERMITS='https://data.mesaaz.gov/resource/m2kk-w2hz.json';
const CHANDLER_ACTIVE='https://gis.chandleraz.gov/appsanonymous/rest/services/DevelopmentServices/DSActiveProjects/MapServer';
const CHANDLER_CONSTRUCTION='https://gis.chandleraz.gov/portalserver/rest/services/EM/DevelopmentServices/MapServer/56';
const CHANDLER_ACCELA_PERMITS='https://gis.chandleraz.gov/appsanonymous/rest/services/Tolemi/Building_Blocks/MapServer/0/query';
const MARKETS=['Phoenix','Tempe','Tucson','Scottsdale','Mesa','Chandler','Fort Worth','Dallas'];
const LIVE_MARKETS=['Phoenix','Tempe','Tucson','Scottsdale','Mesa','Chandler','Fort Worth','Dallas'];
const SOURCE_STATUS={
  Phoenix:{status:'live',cadence:'City feed',source:'City of Phoenix Planning & Development'},
  Tempe:{status:'live',cadence:'Published weekly',source:'City of Tempe Building Safety'},
  Tucson:{status:'live',cadence:'Hourly RevenueTrigger discovery',source:'City of Tucson Property Research Online (PRO)'},
  Scottsdale:{status:'live',cadence:'Official CSV permit report',source:'City of Scottsdale Building Permit Reports'},
  Mesa:{status:'live',cadence:'City open-data API',source:'City of Mesa Data Hub — Building Permits'},
  Chandler:{status:'live',cadence:'Official Accela/ArcGIS permit feed + Early Pipeline',source:'City of Chandler Accela permit layer + DSActiveProjects'},
  'Fort Worth':{status:'live',cadence:'Updated hourly during business hours',source:'City of Fort Worth Development Services — Development Permits Open Data'},
  Dallas:{status:'live',cadence:'Rolling 7-day DallasNow Building Submitted + Issued reports',source:'City of Dallas DallasNow Building'}
};
const INDUSTRIES=['Commercial services','HVAC','Electrical','Plumbing','Roofing','Landscaping','Security','Signage'];
const PLANS={
  Beta:{historyDays:7,industryLimit:1,marketLimit:1,export:false,alert:'none'},
  Scout:{historyDays:7,industryLimit:1,marketLimit:1,export:false,alert:'weekly'},
  Hunter:{historyDays:30,industryLimit:3,marketLimit:3,export:true,alert:'daily'},
  Territory:{historyDays:90,industryLimit:8,marketLimit:6,export:true,alert:'instant'}
};

const clamp=(n,a,b)=>Math.max(a,Math.min(b,n));
const cors=(env)=>({
  'Access-Control-Allow-Origin':env.ALLOWED_ORIGIN||'*',
  'Access-Control-Allow-Headers':'Content-Type, Authorization, Stripe-Signature',
  'Access-Control-Allow-Methods':'GET,POST,OPTIONS',
  'Access-Control-Max-Age':'86400'
});
const json=(body,status=200,env={})=>new Response(JSON.stringify(body),{status,headers:{'content-type':'application/json;charset=utf-8',...cors(env)}});
const nowIso=()=>new Date().toISOString();
const normalizeEmail=(v)=>String(v||'').trim().toLowerCase();
const validEmail=(v)=>/^\S+@\S+\.\S+$/.test(v);
const safePlan=(p)=>PLANS[p]?p:'Beta';
const parseJson=(v,fallback=[])=>{try{return JSON.parse(v||'')}catch{return fallback}};
const htmlEsc=(s='')=>String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));

function sellerFitScores(text=''){
  const t=String(text||'').toLowerCase();
  const best=(rules)=>{let v=0;for(const [re,pts] of rules)if(re.test(t))v=Math.max(v,pts);return v;};
  const out={
    HVAC:best([[/\b(?:rtu|rooftop\s+(?:unit|ac|a\/c|hvac)|air\s+handler|chiller|heat\s*pump)\b/i,98],[/\b(?:hvac|air\s*condition(?:ing)?|a\/?c|ac\s+unit|mechanical|duct(?:work)?|cooling|heating)\b/i,88]]),
    Electrical:best([[/\b(?:main\s+panel|panel\s+upgrade|service\s+upgrade|switchgear|transformer|generator|solar|photovoltaic|\bpv\b|ev\s+charger)\b/i,96],[/\b(?:electric(?:al)?|service\s+panel|breaker|lighting|power)\b/i,84]]),
    Plumbing:best([[/\b(?:grease\s+interceptor|backflow|sewer|water\s+(?:line|service)|gas\s+line)\b/i,96],[/\b(?:plumb(?:ing)?|restroom|fixture)\b/i,84]]),
    Roofing:best([[/\b(?:reroof|re-roof|roof\s+(?:replacement|recover|project)|recover\s+roof|roof\s+membrane|single[- ]ply)\b/i,98],[/\b(?:roofing|roof\s+repair|shingle|tile\s+roof)\b/i,86]]),
    Landscaping:best([[/\b(?:landscap(?:e|ing)|irrigation)\b/i,92],[/\b(?:pool|spa|patio|outdoor)\b/i,72]]),
    Security:best([[/\b(?:access\s+control|fire\s+alarm|security\s+system|camera|cctv)\b/i,96],[/\b(?:security|alarm|low\s+voltage)\b/i,82]]),
    Signage:best([[/\b(?:monument\s+sign|wall\s+sign|signage|sign\s+permit)\b/i,96],[/\bsign\b/i,82]])
  };
  out['Commercial services']=/\b(?:commercial|retail|office|warehouse|industrial|medical|hotel|restaurant|business|tenant\s+improvement)\b/i.test(t)?82:58;
  return out;
}

function classify(text=''){
  const fits=sellerFitScores(text);
  const specific=Object.entries(fits).filter(([k,v])=>k!=='Commercial services'&&v>=60).sort((a,b)=>b[1]-a[1]).map(([k])=>k);
  const out=specific.slice(0,5);
  if(fits['Commercial services']>=60 || !out.length)out.push('Commercial services');
  return out;
}

function temperatureForScore(score){
  if(score>=75)return 'HOT';
  if(score>=60)return 'WARM';
  if(score>=40)return 'WATCH';
  return 'LOW';
}

function opportunityScore({text='',status='',date=Date.now(),officialValue=null,address='',company=''}={}){
  const t=String(text||'').toLowerCase();
  const s=String(status||'').toLowerCase();
  const fits=sellerFitScores(t);

  // 25% — project stage
  let projectStage=12;
  if(/\b(?:pre[- ]?tech|planning|zoning|development review|site plan|concept review)\b/i.test(`${t} ${s}`))projectStage=25;
  else if(/\b(?:submitted|applied|application|in review|under review|plan review|pending)\b/i.test(s))projectStage=22;
  else if(/\b(?:approved|ready to issue)\b/i.test(s))projectStage=18;
  else if(/\b(?:issued|permit issued)\b/i.test(s))projectStage=14;
  else if(/\b(?:inspection|construction)\b/i.test(s))projectStage=7;
  else if(/\b(?:final|completed|complete|closed)\b/i.test(s))projectStage=2;
  else if(/\b(?:cancel|expired|withdrawn|void|denied)\b/i.test(s))projectStage=0;

  // 20% — recency
  const ts=Number(date)>10000000000?Number(date):new Date(date||Date.now()).getTime();
  const ageDays=Math.max(0,(Date.now()-ts)/86400000);
  const recency=ageDays<=1?20:ageDays<=3?18:ageDays<=7?15:ageDays<=14?11:ageDays<=30?7:ageDays<=90?3:1;

  // 15% — project value
  const ov=Number(officialValue);
  let projectValue=5;
  if(Number.isFinite(ov)&&ov>0){
    if(ov>=2000000)projectValue=15;
    else if(ov>=750000)projectValue=13;
    else if(ov>=250000)projectValue=11;
    else if(ov>=100000)projectValue=9;
    else if(ov>=25000)projectValue=7;
    else projectValue=4;
  }else if(/\b(?:ground.?up|new construction|shell building|multifamily|industrial|hotel)\b/i.test(t))projectValue=10;
  else if(/\b(?:tenant improvement|restaurant|medical|commercial remodel|build.?out)\b/i.test(t))projectValue=8;

  // 15% — trade relevance (generic score; personalized scoring can later reweight this by user profile)
  const specificFits=Object.entries(fits).filter(([k])=>k!=='Commercial services').map(([,v])=>Number(v)||0);
  const bestFit=specificFits.length?Math.max(...specificFits):Number(fits['Commercial services']||0);
  const tradeRelevance=clamp(Math.round(bestFit*.15),0,15);

  // 10% — project type
  let projectType=4;
  if(/\b(?:restaurant|retail|multifamily|industrial|medical|hospital|hotel|hospitality|warehouse|office|commercial)\b/i.test(t))projectType=10;
  else if(/\b(?:tenant improvement|remodel|renovation|addition|alteration|build.?out)\b/i.test(t))projectType=8;
  else if(/\b(?:hvac|mechanical|electrical|plumbing|roofing|signage|security|fire alarm)\b/i.test(t))projectType=6;
  else if(/\b(?:residential|sfr|single[- ]family|pool|spa|garage)\b/i.test(t))projectType=2;

  // 10% — pre-permit / early intelligence
  let prePermit=0;
  if(/\b(?:pre[- ]?tech|planning|zoning|development review|site plan|concept review)\b/i.test(`${t} ${s}`))prePermit=10;
  else if(/\b(?:submitted|applied|application|in review|under review|plan review|pending)\b/i.test(s))prePermit=6;
  else if(/\b(?:approved|ready to issue)\b/i.test(s))prePermit=4;
  else if(/\b(?:issued)\b/i.test(s))prePermit=1;

  // 5% — company context / historical behavior foundation.
  // Full repeat-behavior weighting is added in company intelligence, where history is available.
  const c=String(company||'').trim();
  const companyBehavior=isMeaningfulCompanyName(c)?2:0;

  const score=clamp(Math.round(projectStage+recency+projectValue+tradeRelevance+projectType+prePermit+companyBehavior),0,100);
  return {
    score,
    temperature:temperatureForScore(score),
    breakdown:{projectStage,recency,projectValue,tradeRelevance,projectType,prePermit,companyBehavior},
    sellerFit:fits
  };
}


// V110 shadow scorer. This is diagnostic only: production opportunity scores are
// intentionally unchanged until the comparison data is reviewed.
function strictScoreDateMs(date){
  if(date===null||date===undefined||date==='')return null;
  let ts=null;
  if(typeof date==='number' || /^\d+(?:\.\d+)?$/.test(String(date).trim())){
    const n=Number(date);
    if(Number.isFinite(n))ts=n>10000000000?n:n*1000;
  }else{
    const parsed=new Date(date).getTime();
    if(Number.isFinite(parsed))ts=parsed;
  }
  return Number.isFinite(ts)?ts:null;
}

function opportunityScoreCandidate({text='',status='',date=null,officialValue=null,address='',company=''}={}){
  const t=String(text||'').toLowerCase();
  const s=String(status||'').toLowerCase();
  const fits=sellerFitScores(t);

  // Preserve the production stage logic, but cap the combined lifecycle +
  // early-signal contribution at 30 points so PRE-TECH is not rewarded twice
  // at the full 25 + 10 weighting.
  let projectStage=12;
  if(/\b(?:pre[- ]?tech|planning|zoning|development review|site plan|concept review)\b/i.test(`${t} ${s}`))projectStage=25;
  else if(/\b(?:submitted|applied|application|in review|under review|plan review|pending)\b/i.test(s))projectStage=22;
  else if(/\b(?:approved|ready to issue)\b/i.test(s))projectStage=18;
  else if(/\b(?:issued|permit issued)\b/i.test(s))projectStage=14;
  else if(/\b(?:inspection|construction)\b/i.test(s))projectStage=7;
  else if(/\b(?:final|completed|complete|closed)\b/i.test(s))projectStage=2;
  else if(/\b(?:cancel|expired|withdrawn|void|denied)\b/i.test(s))projectStage=0;

  let prePermitRaw=0;
  if(/\b(?:pre[- ]?tech|planning|zoning|development review|site plan|concept review)\b/i.test(`${t} ${s}`))prePermitRaw=10;
  else if(/\b(?:submitted|applied|application|in review|under review|plan review|pending)\b/i.test(s))prePermitRaw=6;
  else if(/\b(?:approved|ready to issue)\b/i.test(s))prePermitRaw=4;
  else if(/\b(?:issued)\b/i.test(s))prePermitRaw=1;
  const prePermit=Math.min(prePermitRaw,Math.max(0,30-projectStage));

  // Missing/invalid dates receive no recency points. A future date more than
  // two days ahead is treated as unreliable rather than "brand new".
  const ts=strictScoreDateMs(date);
  let recency=0;
  if(ts!==null){
    const delta=Date.now()-ts;
    if(delta>=-2*86400000){
      const ageDays=Math.max(0,delta/86400000);
      recency=ageDays<=1?20:ageDays<=3?18:ageDays<=7?15:ageDays<=14?11:ageDays<=30?7:ageDays<=90?3:0;
    }
  }

  const ov=Number(officialValue);
  let projectValue=5;
  if(Number.isFinite(ov)&&ov>0){
    if(ov>=2000000)projectValue=15;
    else if(ov>=750000)projectValue=13;
    else if(ov>=250000)projectValue=11;
    else if(ov>=100000)projectValue=9;
    else if(ov>=25000)projectValue=7;
    else projectValue=4;
  }else if(/\b(?:ground.?up|new construction|shell building|multifamily|industrial|hotel)\b/i.test(t))projectValue=10;
  else if(/\b(?:tenant improvement|restaurant|medical|commercial remodel|build.?out)\b/i.test(t))projectValue=8;

  const specificFits=Object.entries(fits).filter(([k])=>k!=='Commercial services').map(([,v])=>Number(v)||0);
  const bestFit=specificFits.length?Math.max(...specificFits):Number(fits['Commercial services']||0);
  const tradeRelevance=clamp(Math.round(bestFit*.15),0,15);

  let projectType=4;
  if(/\b(?:restaurant|retail|multifamily|industrial|medical|hospital|hotel|hospitality|warehouse|office|commercial)\b/i.test(t))projectType=10;
  else if(/\b(?:tenant improvement|remodel|renovation|addition|alteration|build.?out)\b/i.test(t))projectType=8;
  else if(/\b(?:hvac|mechanical|electrical|plumbing|roofing|signage|security|fire alarm)\b/i.test(t))projectType=6;
  else if(/\b(?:residential|sfr|single[- ]family|pool|spa|garage)\b/i.test(t))projectType=2;

  const c=String(company||'').trim();
  const companyBehavior=isMeaningfulCompanyName(c)?2:0;
  const score=clamp(Math.round(projectStage+recency+projectValue+tradeRelevance+projectType+prePermit+companyBehavior),0,100);
  return {
    score,
    temperature:temperatureForScore(score),
    breakdown:{projectStage,recency,projectValue,tradeRelevance,projectType,prePermit,companyBehavior},
    diagnostics:{prePermitRaw,lifecycleCapApplied:prePermitRaw-prePermit,hasValidDate:ts!==null},
    sellerFit:fits
  };
}


// V112 balanced Early Pipeline shadow scorer. This remains diagnostic-only.
// Key change from V110: a record that is present in a freshly fetched active-project
// source but lacks its own event date receives modest source-freshness credit rather
// than either the production model's full 20 points or V110's zero. Missing event
// dates still reduce Data Confidence separately.
function opportunityScorePipelineCandidateV112({text='',status='',date=null,officialValue=null,address='',company='',sourceFresh=true}={}){
  const t=String(text||'').toLowerCase();
  const s=String(status||'').toLowerCase();
  const fits=sellerFitScores(t);

  let projectStage=12;
  if(/\b(?:pre[- ]?tech|planning|zoning|development review|site plan|concept review)\b/i.test(`${t} ${s}`))projectStage=25;
  else if(/\b(?:submitted|applied|application|in review|under review|plan review|pending)\b/i.test(s))projectStage=22;
  else if(/\b(?:approved|ready to issue)\b/i.test(s))projectStage=18;
  else if(/\b(?:issued|permit issued)\b/i.test(s))projectStage=14;
  else if(/\b(?:inspection|construction)\b/i.test(s))projectStage=7;
  else if(/\b(?:final|completed|complete|closed)\b/i.test(s))projectStage=2;
  else if(/\b(?:cancel|expired|withdrawn|void|denied)\b/i.test(s))projectStage=0;

  let prePermitRaw=0;
  if(/\b(?:pre[- ]?tech|planning|zoning|development review|site plan|concept review)\b/i.test(`${t} ${s}`))prePermitRaw=10;
  else if(/\b(?:submitted|applied|application|in review|under review|plan review|pending)\b/i.test(s))prePermitRaw=6;
  else if(/\b(?:approved|ready to issue)\b/i.test(s))prePermitRaw=4;
  else if(/\b(?:issued)\b/i.test(s))prePermitRaw=1;
  // Preserve more early-stage signal than V110, but still prevent full 25+10 stacking.
  const prePermit=Math.min(prePermitRaw,Math.max(0,32-projectStage));

  const ts=strictScoreDateMs(date);
  let recency=0;
  let recencyBasis='event-date';
  if(ts!==null){
    const delta=Date.now()-ts;
    if(delta>=-2*86400000){
      const ageDays=Math.max(0,delta/86400000);
      recency=ageDays<=1?20:ageDays<=3?18:ageDays<=7?15:ageDays<=14?11:ageDays<=30?7:ageDays<=90?3:0;
    }
  }else if(sourceFresh){
    // Current membership in an authoritative active-project feed is evidence that the
    // signal is still live, but it is not equivalent to a known event date.
    recency=10;
    recencyBasis='fresh-source-snapshot';
  }else{
    recencyBasis='unknown';
  }

  const ov=Number(officialValue);
  let projectValue=5;
  if(Number.isFinite(ov)&&ov>0){
    if(ov>=2000000)projectValue=15;
    else if(ov>=750000)projectValue=13;
    else if(ov>=250000)projectValue=11;
    else if(ov>=100000)projectValue=9;
    else if(ov>=25000)projectValue=7;
    else projectValue=4;
  }else if(/\b(?:ground.?up|new construction|shell building|multifamily|industrial|hotel)\b/i.test(t))projectValue=10;
  else if(/\b(?:tenant improvement|restaurant|medical|commercial remodel|build.?out)\b/i.test(t))projectValue=8;

  const specificFits=Object.entries(fits).filter(([k])=>k!=='Commercial services').map(([,v])=>Number(v)||0);
  const bestFit=specificFits.length?Math.max(...specificFits):Number(fits['Commercial services']||0);
  const tradeRelevance=clamp(Math.round(bestFit*.15),0,15);

  let projectType=4;
  if(/\b(?:restaurant|retail|multifamily|industrial|medical|hospital|hotel|hospitality|warehouse|office|commercial)\b/i.test(t))projectType=10;
  else if(/\b(?:tenant improvement|remodel|renovation|addition|alteration|build.?out)\b/i.test(t))projectType=8;
  else if(/\b(?:hvac|mechanical|electrical|plumbing|roofing|signage|security|fire alarm)\b/i.test(t))projectType=6;
  else if(/\b(?:residential|sfr|single[- ]family|pool|spa|garage)\b/i.test(t))projectType=2;

  const c=String(company||'').trim();
  const companyBehavior=isMeaningfulCompanyName(c)?2:0;
  const score=clamp(Math.round(projectStage+recency+projectValue+tradeRelevance+projectType+prePermit+companyBehavior),0,100);
  return {
    score,
    temperature:temperatureForScore(score),
    breakdown:{projectStage,recency,projectValue,tradeRelevance,projectType,prePermit,companyBehavior},
    diagnostics:{prePermitRaw,lifecycleCapApplied:prePermitRaw-prePermit,hasValidDate:ts!==null,recencyBasis},
    sellerFit:fits
  };
}



// V113 refined Early Pipeline shadow scorer. Diagnostic only.
// Keep the existing lifecycle + first-mover weights intact because they represent
// distinct concepts, but stop treating an unknown event date as "today". A record
// observed in the current authoritative active-project snapshot receives 15 timing
// points (equivalent to an active/recent source observation), while Data Confidence
// separately reflects that the exact event date is missing.
function opportunityScorePipelineCandidateV113({text='',status='',date=null,officialValue=null,address='',company='',sourceFresh=true}={}){
  const t=String(text||'').toLowerCase();
  const s=String(status||'').toLowerCase();
  const fits=sellerFitScores(t);

  let projectStage=12;
  if(/\b(?:pre[- ]?tech|planning|zoning|development review|site plan|concept review)\b/i.test(`${t} ${s}`))projectStage=25;
  else if(/\b(?:submitted|applied|application|in review|under review|plan review|pending)\b/i.test(s))projectStage=22;
  else if(/\b(?:approved|ready to issue)\b/i.test(s))projectStage=18;
  else if(/\b(?:issued|permit issued)\b/i.test(s))projectStage=14;
  else if(/\b(?:inspection|construction)\b/i.test(s))projectStage=7;
  else if(/\b(?:final|completed|complete|closed)\b/i.test(s))projectStage=2;
  else if(/\b(?:cancel|expired|withdrawn|void|denied)\b/i.test(s))projectStage=0;

  let prePermit=0;
  if(/\b(?:pre[- ]?tech|planning|zoning|development review|site plan|concept review)\b/i.test(`${t} ${s}`))prePermit=10;
  else if(/\b(?:submitted|applied|application|in review|under review|plan review|pending)\b/i.test(s))prePermit=6;
  else if(/\b(?:approved|ready to issue)\b/i.test(s))prePermit=4;
  else if(/\b(?:issued)\b/i.test(s))prePermit=1;

  const ts=strictScoreDateMs(date);
  let recency=0;
  let recencyBasis='event-date';
  if(ts!==null){
    const delta=Date.now()-ts;
    if(delta>=-2*86400000){
      const ageDays=Math.max(0,delta/86400000);
      recency=ageDays<=1?20:ageDays<=3?18:ageDays<=7?15:ageDays<=14?11:ageDays<=30?7:ageDays<=90?3:0;
    }
  }else if(sourceFresh){
    recency=15;
    recencyBasis='active-source-snapshot';
  }else{
    recencyBasis='unknown';
  }

  const ov=Number(officialValue);
  let projectValue=5;
  if(Number.isFinite(ov)&&ov>0){
    if(ov>=2000000)projectValue=15;
    else if(ov>=750000)projectValue=13;
    else if(ov>=250000)projectValue=11;
    else if(ov>=100000)projectValue=9;
    else if(ov>=25000)projectValue=7;
    else projectValue=4;
  }else if(/\b(?:ground.?up|new construction|shell building|multifamily|industrial|hotel)\b/i.test(t))projectValue=10;
  else if(/\b(?:tenant improvement|restaurant|medical|commercial remodel|build.?out)\b/i.test(t))projectValue=8;

  const specificFits=Object.entries(fits).filter(([k])=>k!=='Commercial services').map(([,v])=>Number(v)||0);
  const bestFit=specificFits.length?Math.max(...specificFits):Number(fits['Commercial services']||0);
  const tradeRelevance=clamp(Math.round(bestFit*.15),0,15);

  let projectType=4;
  if(/\b(?:restaurant|retail|multifamily|industrial|medical|hospital|hotel|hospitality|warehouse|office|commercial)\b/i.test(t))projectType=10;
  else if(/\b(?:tenant improvement|remodel|renovation|addition|alteration|build.?out)\b/i.test(t))projectType=8;
  else if(/\b(?:hvac|mechanical|electrical|plumbing|roofing|signage|security|fire alarm)\b/i.test(t))projectType=6;
  else if(/\b(?:residential|sfr|single[- ]family|pool|spa|garage)\b/i.test(t))projectType=2;

  const c=String(company||'').trim();
  const companyBehavior=isMeaningfulCompanyName(c)?2:0;
  const score=clamp(Math.round(projectStage+recency+projectValue+tradeRelevance+projectType+prePermit+companyBehavior),0,100);
  return {
    score,
    temperature:temperatureForScore(score),
    breakdown:{projectStage,recency,projectValue,tradeRelevance,projectType,prePermit,companyBehavior},
    diagnostics:{hasValidDate:ts!==null,recencyBasis},
    sellerFit:fits
  };
}

// V114 production Early Pipeline scorer.
// This promotes the validated V113 shadow model for Early Pipeline only.
// Live permit scoring remains on the existing production model.
function opportunityScorePipelineV2(args={}){
  return opportunityScorePipelineCandidateV113(args);
}

function dataConfidenceCandidate({company='',officialValue=null,address='',permit='',status='',scope='',source='',date=null}={}){
  let score=0;
  const reasons=[];
  if(String(source||'').trim()){score+=10;reasons.push('Source attributed')}
  if(String(permit||'').trim() && String(permit)!=='—'){score+=15;reasons.push('Permit / project ID present')}
  if(strictScoreDateMs(date)!==null){score+=15;reasons.push('Valid event date')}
  if(String(address||'').trim()){score+=15;reasons.push('Address present')}
  const c=String(company||'').trim();
  if(isMeaningfulCompanyName(c)){score+=20;reasons.push('Company identified')}
  const ov=Number(officialValue);
  if(Number.isFinite(ov)&&ov>0){score+=15;reasons.push('Reported value present')}
  if(String(status||'').trim() && String(status)!=='—'){score+=5;reasons.push('Stage/status present')}
  if(String(scope||'').trim().length>=35){score+=10;reasons.push('Detailed description')}
  return {score:clamp(score,0,100),reasons};
}

function dataConfidence({company='',officialValue=null,address='',permit='',status='',scope='',source='',market=''}={}){
  let score=25; // known source record exists
  const reasons=[];
  const c=String(company||'').trim();
  if(isMeaningfulCompanyName(c)){score+=15;reasons.push('Company identified')}
  const ov=Number(officialValue);
  if(Number.isFinite(ov)&&ov>0){score+=15;reasons.push('Reported value present')}
  if(String(address||'').trim()){score+=15;reasons.push('Address present')}
  if(String(permit||'').trim() && String(permit)!=='—'){score+=10;reasons.push('Permit / project ID present')}
  if(String(status||'').trim() && String(status)!=='—'){score+=10;reasons.push('Stage/status present')}
  if(String(scope||'').trim().length>=35){score+=7;reasons.push('Detailed description')}
  if(String(source||'').trim()){score+=3;reasons.push('Source attributed')}
  return {score:clamp(score,0,100),reasons};
}

function lifecycleFrom({text='',status=''}={}){
  const v=`${String(text||'')} ${String(status||'')}`.toLowerCase();
  let stage='APPLICATION',index=2;
  if(/\b(?:pre[- ]?tech|concept review|zoning|development review)\b/.test(v)){stage='PRE-TECH';index=0}
  else if(/\b(?:planning|site plan)\b/.test(v)){stage='PLANNING';index=1}
  else if(/\b(?:submitted|applied|application|review|pending)\b/.test(v)){stage='APPLICATION';index=2}
  else if(/\b(?:approved|issued|ready to issue)\b/.test(v)){stage='PERMIT ISSUED';index=3}
  else if(/\b(?:inspection|construction|under construction)\b/.test(v)){stage='CONSTRUCTION';index=4}
  else if(/\b(?:complete|completed|closed|final)\b/.test(v)){stage='COMPLETE';index=5}
  return {stage,index,steps:['PRE-TECH','PLANNING','APPLICATION','PERMIT ISSUED','CONSTRUCTION','COMPLETE']};
}


function actionIntelligence(lead={}){
  const life=lead.lifecycle||lifecycleFrom({text:`${lead.name||''} ${lead.scope||''}`,status:lead.permitStatus||lead.permit_status||''});
  const ageDays=Math.max(0,(Date.now()-new Date(lead.date||lead.event_date||Date.now()).getTime())/86400000);
  const related=Math.max(1,Number(lead.relatedPermitCount||1));
  const hasCompany=isMeaningfulCompanyName(lead.company);

  const baseByStage=[92,86,72,48,22,5];
  let firstMover=baseByStage[life.index]??60;
  if(!hasCompany)firstMover+=7;
  if(ageDays<=3)firstMover+=5;
  if(related>=3)firstMover-=Math.min(12,(related-1)*3);
  firstMover=clamp(Math.round(firstMover),0,100);

  let opportunityWindow={label:'NOW',detail:'Next 14 days'};
  if(life.index<=1)opportunityWindow={label:'EARLY',detail:'30–90 days'};
  else if(life.index===2)opportunityWindow={label:'NOW',detail:'Next 14–30 days'};
  else if(life.index===3)opportunityWindow={label:'NOW',detail:'Next 7–14 days'};
  else if(life.index===4)opportunityWindow={label:'LATE',detail:'Construction likely underway'};
  else if(life.index>=5)opportunityWindow={label:'CLOSED',detail:'Primary construction window likely passed'};

  let buyingWindow={label:'OPEN',detail:'Project appears to still be in an active vendor-selection window.'};
  if(life.index<=1)buyingWindow={label:'FORMING',detail:'Project is early; decision-makers and vendor needs may still be forming.'};
  else if(life.index===2)buyingWindow={label:'OPEN',detail:'Application-stage activity suggests vendor selection may still be active.'};
  else if(life.index===3)buyingWindow={label:'CLOSING',detail:'Permit issuance suggests the project is moving toward execution.'};
  else if(life.index===4)buyingWindow={label:'LATE',detail:'Construction-stage activity suggests many primary selections may already be made.'};
  else if(life.index>=5)buyingWindow={label:'CLOSED',detail:'This project appears beyond the primary buying window.'};

  const dates=[lead.date,...(lead.relatedPermits||[]).map(x=>x.date)].filter(Boolean).map(x=>new Date(x).getTime()).filter(Number.isFinite).sort();
  const spanDays=dates.length>1?Math.max(1,(dates[dates.length-1]-dates[0])/86400000):null;
  let velocity={label:'LOW',detail:'One recent project event detected.'};
  if(related>=4 && spanDays!==null && spanDays<=14)velocity={label:'HIGH ↑',detail:`${related} related events detected in ${Math.max(1,Math.round(spanDays))} days.`};
  else if(related>=2)velocity={label:'RISING ↑',detail:`${related} related project events detected in the current window.`};

  let momentum={label:'STABLE',detail:'Activity is continuing at a normal pace.'};
  if(velocity.label.startsWith('HIGH'))momentum={label:'ACCELERATING',detail:'Related project activity is arriving in a compressed time window.'};
  else if(ageDays>60 && life.index<5)momentum={label:'STALLED',detail:`No recent project event has been detected for ${Math.round(ageDays)} days.`};
  else if(ageDays>30 && life.index<5)momentum={label:'SLOWING',detail:'Recent activity has slowed compared with a fresh project signal.'};
  else if(life.index>=5)momentum={label:'COMPLETE',detail:'The observed lifecycle indicates the project is complete or closed.'};

  const ageText=ageDays<1?'within the last 24 hours':ageDays<2?'about a day ago':`${Math.max(1,Math.round(ageDays))} days ago`;
  let whyNow=`${life.stage} activity was detected ${ageText}.`;
  if(life.index<=2 && !hasCompany)whyNow+=` No company is identified on the current public record, which can indicate an earlier point in the project lifecycle.`;
  else if(life.index<=3 && hasCompany)whyNow+=` ${lead.company} is already associated with the public record, giving you a concrete company to research now.`;
  if(related>1)whyNow+=` RevenueTrigger also grouped ${related} related permit records at this location.`;

  let nextBestAction={action:'MONITOR',reason:'Keep the project on your radar until more actionable project participants appear.'};
  if(life.index<=1)nextBestAction={action:'RESEARCH DECISION MAKERS',reason:'The project is early. Identify the owner, developer, architect, or likely GC before vendor selection advances.'};
  else if(life.index===2 && hasCompany)nextBestAction={action:'CONTACT COMPANY ON PERMIT',reason:`The project is in application/review and ${lead.company} is already tied to the public record.`};
  else if(life.index===2)nextBestAction={action:'RESEARCH OWNER / GC',reason:'The project is in application/review but the current public record does not identify a company to contact.'};
  else if(life.index===3 && hasCompany)nextBestAction={action:'CONTACT COMPANY ON PERMIT NOW',reason:'Permit issuance indicates the project is moving toward execution and the public record identifies a company.'};
  else if(life.index===3)nextBestAction={action:'CONTACT PROJECT TEAM NOW',reason:'The permit is issued, so the available selling window may be narrowing.'};
  else if(life.index===4)nextBestAction={action:'PURSUE REMAINING SERVICE GAPS',reason:'Construction appears underway. Focus on unfilled, change-order, maintenance, or downstream needs rather than early bidding.'};
  else if(life.index>=5)nextBestAction={action:'LOOK FOR FOLLOW-ON WORK',reason:'The primary project appears complete; monitor the company/location for service, maintenance, expansion, or future projects.'};

  return {firstMover,opportunityWindow,buyingWindow,velocity,momentum,whyNow,nextBestAction};
}

function applyActionIntelligence(lead){
  const enriched={...lead};
  enriched.actionIntelligence=actionIntelligence(enriched);
  return enriched;
}

function normalizeAddressKey(v=''){
  return String(v||'').toUpperCase().replace(/[.,#]/g,' ').replace(/\b(?:SUITE|STE|UNIT)\s+\w+/g,'').replace(/\s+/g,' ').trim();
}
function usableClusterAddress(lead={}){
  const addr=normalizeAddressKey(lead.address);
  if(!addr)return '';
  const market=normalizeAddressKey(lead.market||'');
  // Municipality-only placeholders such as "Chandler, AZ" are not project
  // addresses. Clustering them would collapse an entire city's feed into one card.
  const generic=new Set([
    market,
    market?`${market} AZ`:'',
    market?`${market} ARIZONA`:'',
    'ARIZONA','AZ'
  ].filter(Boolean));
  return generic.has(addr)?'':addr;
}
function clusterLeads(leads=[]){
  const groups=new Map();
  for(const lead of leads){
    const addrKey=usableClusterAddress(lead);
    if(!addrKey){groups.set(`id:${lead.id}`,[lead]);continue}
    const key=`${lead.market||''}|${addrKey}`;
    const arr=groups.get(key)||[];arr.push(lead);groups.set(key,arr);
  }
  const out=[];
  for(const group of groups.values()){
    group.sort((a,b)=>(Number(b.score||0)-Number(a.score||0))||(new Date(b.date)-new Date(a.date)));
    const primary={...group[0]};
    primary.relatedPermitCount=group.length;
    primary.relatedPermits=group.slice(1).map(x=>({id:x.id,permit:x.permit,name:x.name,score:x.score,date:x.date,source:x.source}));
    if(group.length>1)primary.projectCluster=true;
    out.push(applyActionIntelligence(primary));
  }
  return out.sort((a,b)=>(Number(b.score||0)-Number(a.score||0))||(new Date(b.date)-new Date(a.date)));
}

function estimateValueFromText(text,categories,score,officialValue=null){
  const t=String(text||'').toLowerCase();
  let v=4500;
  if(/new building|ground.?up|shell building/.test(t))v=65000;
  else if(/restaurant|tenant improvement|commercial remodel|complete remodel/.test(t))v=32000;
  else if(/commercial|warehouse|industrial|medical|office|retail/.test(t))v=22000;
  else if(/pool|spa/.test(t))v=12000;
  else if(/remodel|addition|renovation/.test(t))v=14000;
  else if(/roof|mechanical|electrical|plumbing|hvac|solar/.test(t))v=7500;
  v+=Math.max(0,categories.length-2)*2500;
  const ov=Number(officialValue);
  if(Number.isFinite(ov)&&ov>0)v=Math.max(v,Math.min(150000,Math.round(ov*.12)));
  return Math.round(v*(.82+score/520));
}

function leadFrom({market,id,name,address,date,company,scope,permit,permitStatus,source,officialValue=null}){
  const text=[name,scope,company].filter(Boolean).join(' ');
  const safeDate=Number.isFinite(Number(date))&&Number(date)>10000000000?Number(date):(date||Date.now());
  const model=opportunityScore({text,status:permitStatus,date:safeDate,officialValue,address,company});
  const categories=classify(text);
  return {
    id:market==='Phoenix'?String(id||permit||crypto.randomUUID()):`${market.toLowerCase()}:${String(id||permit||crypto.randomUUID())}`,
    market,name:name||`${market} permit activity`,address:address||`${market}, AZ`,date:safeDate,
    company:company||'Not listed',scope:scope||'Recent permit activity detected.',
    score:model.score,scoreBreakdown:model.breakdown,sellerFit:model.sellerFit,categories,
    value:estimateValueFromText(text,categories,model.score,officialValue),
    officialPermitValue:Number.isFinite(Number(officialValue))&&Number(officialValue)>0?Number(officialValue):null,
    temperature:model.temperature,permit:permit||'—',permitStatus:permitStatus||'—',source,
    dataConfidence:dataConfidence({company,officialValue,address,permit,status:permitStatus,scope,source,market}),
    lifecycle:lifecycleFrom({text,status:permitStatus}),
    checkedAt:Date.now()
  };
}
function normalizePhoenix(f){
  const a=f.attributes||{};
  return leadFrom({market:'Phoenix',id:a.OBJECTID||a.PER_NUM,name:a.PERMIT_NAME||a.PER_TYPE_DESC,address:a.STREET_FULL_NAME,date:a.PER_ISSUE_DATE||a.PER_ENT_DATE,company:a.PROFESS_NAME,scope:a.SCOPE_DESC||a.MOD_DESC||a.PER_TYPE_DESC,permit:a.PER_NUM,permitStatus:a.PERMIT_STAT,source:'City of Phoenix Planning & Development — public permits'});
}
function normalizeTempe(f){
  const a=f.attributes||{};
  const address=[a.OriginalAddress1,a.OriginalAddress2,a.OriginalCity||'Tempe',a.OriginalState||'AZ',a.OriginalZip].filter(Boolean).join(' ');
  const officialValue=Number(a.EstProjectCost);
  return leadFrom({market:'Tempe',id:a.OBJECTID||a.PermitNum,name:a.ProjectName||a.Description||a.PermitTypeDesc||a.PermitType,address,date:a.IssuedDateDtm||a.AppliedDateDtm||a.StatusDateDtm,company:a.ContractorCompanyName,scope:[a.Description,a.PermitClass,a.PermitTypeDesc,a.Type].filter(Boolean).join(' — '),permit:a.PermitNum,permitStatus:a.StatusCurrent,source:'City of Tempe Building Safety — building permits',officialValue:Number.isFinite(officialValue)&&officialValue>0?officialValue:null});
}
function decodeTucsonHtml(s=''){
  return String(s||'')
    .replace(/&nbsp;/gi,' ')
    .replace(/&amp;/gi,'&')
    .replace(/&quot;/gi,'"')
    .replace(/&#39;/gi,"'")
    .replace(/&lt;/gi,'<')
    .replace(/&gt;/gi,'>');
}
function stripTucsonHtml(s=''){
  return decodeTucsonHtml(
    String(s||'')
      .replace(/<script[\s\S]*?<\/script>/gi,' ')
      .replace(/<style[\s\S]*?<\/style>/gi,' ')
      .replace(/<[^>]+>/g,' ')
      .replace(/\s+/g,' ')
  ).trim();
}
const tucsonPad5=n=>String(n).padStart(5,'0');
const sleep=ms=>new Promise(r=>setTimeout(r,ms));

function tucsonPrefixNow(){
  const parts=new Intl.DateTimeFormat('en-US',{
    timeZone:'America/Phoenix',month:'2-digit',year:'2-digit'
  }).formatToParts(new Date());
  const mm=parts.find(x=>x.type==='month')?.value||String(new Date().getUTCMonth()+1).padStart(2,'0');
  const yy=parts.find(x=>x.type==='year')?.value||String(new Date().getUTCFullYear()).slice(-2);
  return `TC-COM-${mm}${yy}-`;
}
function tucsonDateMs(v){
  if(!v)return Date.now();
  const m=String(v).match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if(m)return Date.UTC(Number(m[3]),Number(m[1])-1,Number(m[2]),12,0,0);
  const n=new Date(v).getTime();
  return Number.isFinite(n)?n:Date.now();
}
function parseTucsonCommercialPermit(html,permit){
  const text=stripTucsonHtml(html);
  if(/No Records Found/i.test(text))return null;

  let address=null;
  for(const p of [
    /Map Address\s+(.+?)\s+Parcel Attributes Issue\?/i,
    /Address:\s*(.+?)\s+Date\s*-\s*\d{1,2}\/\d{1,2}\/\d{4}/i
  ]){
    const m=text.match(p);
    if(m?.[1]){address=m[1].trim();break;}
  }

  const escaped=permit.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
  const occ=[...text.matchAll(new RegExp(escaped,'gi'))];
  let status=null,applyDate=null,expiredDate=null,unit=null,description=null;

  for(let i=occ.length-1;i>=0;i--){
    const tail=text.slice(occ[i].index,occ[i].index+1800);
    const row=tail.match(new RegExp(
      '^'+escaped+
      '\\s+(.{1,80}?)'+
      '\\s+(\\d{1,2}\\/\\d{1,2}\\/\\d{4})'+
      '\\s+(N\\/A|\\d{1,2}\\/\\d{1,2}\\/\\d{4})'+
      '\\s+(.*?)'+
      '\\s+Commercial Building\\s+'+
      '(.+?)(?=\\s+(?:TC-|TR-|TE-|TS-|TP-|Plans\\s|Inspections\\s|Fees\\s|$))',
      'i'
    ));
    if(!row)continue;
    const candidate=(row[1]||'').trim();
    if(/Activity Number|Search Parcel|Parcel Attributes|Permits Date/i.test(candidate))continue;
    status=candidate||null;
    applyDate=(row[2]||'').trim()||null;
    expiredDate=(row[3]||'').trim()||null;
    unit=(row[4]||'').trim()||null;
    description=(row[5]||'').trim()||null;
    break;
  }

  if(!applyDate){
    for(let i=occ.length-1;i>=0;i--){
      const tail=text.slice(occ[i].index+permit.length,occ[i].index+permit.length+1200).trim();
      const dm=tail.match(/^(.{1,80}?)\s+(\d{1,2}\/\d{1,2}\/\d{4})\s+(N\/A|\d{1,2}\/\d{1,2}\/\d{4})\s+(.*)$/i);
      if(!dm)continue;
      const candidate=(dm[1]||'').trim();
      if(/Activity Number|Search Parcel|Parcel Attributes|Permits Date/i.test(candidate))continue;
      status=candidate||null;
      applyDate=dm[2].trim();
      expiredDate=dm[3].trim();
      const after=dm[4].trim();
      const cm=after.match(/^(.*?)\s*Commercial Building\s+(.+?)(?=\s+(?:TC-|TR-|TE-|TS-|TP-|Plans\s|Inspections\s|Fees\s|$))/i);
      if(cm){
        unit=cm[1].trim()||null;
        description=cm[2].trim()||null;
      }else description=after.slice(0,900);
      break;
    }
  }

  if(!text.toUpperCase().includes(permit.toUpperCase()))return null;

  return {permit,status,applyDate,expiredDate,unit,type:'Commercial Building',address,description};
}
async function fetchTucsonPermit(permit){
  const url=`${TUCSON_PRO_BASE}/activity_search/${encodeURIComponent(permit)}`;
  const r=await fetch(url,{redirect:'follow',headers:{'user-agent':'RevenueTrigger/3.2 Tucson PRO scanner'}});
  const html=await r.text();
  if(!r.ok)throw new Error(`Tucson PRO ${r.status}`);
  return parseTucsonCommercialPermit(html,permit);
}

// Tucson's permit-detail page publishes an Applicant field that is not present on
// the activity-search row. Only promote that field to Company on permit when the
// source itself clearly identifies an organization. Person names remain Not listed.
function tucsonBusinessApplicantName(v=''){
  const name=String(v||'').replace(/\s+/g,' ').trim();
  if(!isMeaningfulCompanyName(name)||/^(n\/a|not available|not provided)$/i.test(name))return null;
  const businessSignal=/\b(?:LLC|PLLC|LLP|LP|LTD|INC|INCORPORATED|CORP|CORPORATION|COMPANY|CO|CONSTRUCTION|CONTRACTING|CONTRACTORS?|BUILDERS?|ELECTRIC|ELECTRICAL|PLUMBING|MECHANICAL|ROOFING|SOLAR|ENGINEERING|ARCHITECTS?|ARCHITECTURE|DESIGN|FIRE|SECURITY|SERVICES?|SYSTEMS?|SOLUTIONS?|ENTERPRISES?|INDUSTRIES|DEVELOPMENT|PROPERTIES|HOLDINGS|GROUP|PARTNERS|ASSOCIATES|ENVIRONMENTAL|HEATING|COOLING|HVAC|PAINTING|CONCRETE|MASONRY|LANDSCAP(?:E|ING)|GLASS|DOORS?|WINDOWS?|SIGNS?|COMMUNICATIONS|TECHNOLOG(?:Y|IES)|RESTAURANT|RETAIL)\b/i;
  return businessSignal.test(name)?name:null;
}
function parseTucsonPermitDetail(html,permit){
  const text=stripTucsonHtml(html);
  if(!text||/No Records Found/i.test(text))return null;
  const applicantMatch=text.match(/\bApplicant:\s*(.*?)\s*(?=\bDescription:|\bPermit Reviews|$)/i);
  const addressMatch=text.match(/\bAddress:\s*(.*?)\s*(?=\bAddress NEW:|\bApply Date:|$)/i);
  const statusMatch=text.match(/\bStatus:\s*(.*?)\s*(?=\bType:|$)/i);
  const descriptionMatch=text.match(/\bDescription:\s*(.*?)\s*(?=\bPermit Reviews|$)/i);
  const applicant=String(applicantMatch?.[1]||'').trim()||null;
  return {
    permit,
    applicant,
    businessApplicant:tucsonBusinessApplicantName(applicant),
    address:String(addressMatch?.[1]||'').trim()||null,
    status:String(statusMatch?.[1]||'').trim()||null,
    description:String(descriptionMatch?.[1]||'').trim()||null
  };
}
async function fetchTucsonPermitDetail(permit){
  const url=`${TUCSON_PRO_BASE}/permitdetails/${encodeURIComponent(permit)}/`;
  const r=await fetch(url,{redirect:'follow',headers:{'user-agent':'RevenueTrigger/6.0 Tucson attribution'}});
  const html=await r.text();
  if(!r.ok)throw new Error(`Tucson permit detail ${r.status}`);
  return parseTucsonPermitDetail(html,permit);
}
function normalizeTucsonPro(row){
  const company=tucsonBusinessApplicantName(row.businessApplicant||row.applicant)||'Not listed';
  return leadFrom({
    market:'Tucson',
    id:row.permit,
    name:row.description ? `Commercial Building — ${row.description.slice(0,90)}` : 'Tucson commercial permit',
    address:row.address||'Tucson, AZ',
    date:tucsonDateMs(row.applyDate),
    company,
    scope:[row.type,row.description].filter(Boolean).join(' — '),
    permit:row.permit,
    permitStatus:row.status||'—',
    source:'City of Tucson Property Research Online (PRO)'
  });
}
async function getTucsonCursor(env){
  const prefix=tucsonPrefixNow();
  if(!env.DB)return {prefix,lastSeq:0};
  const row=await env.DB.prepare(`SELECT cursor_key,cursor_value FROM market_cursors WHERE market='Tucson'`).first();
  if(!row||row.cursor_key!==prefix){
    await env.DB.prepare(`INSERT INTO market_cursors (market,cursor_key,cursor_value,updated_at)
      VALUES ('Tucson',?,?,datetime('now'))
      ON CONFLICT(market) DO UPDATE SET cursor_key=excluded.cursor_key,cursor_value=excluded.cursor_value,updated_at=datetime('now')`)
      .bind(prefix,'0').run();
    return {prefix,lastSeq:0};
  }
  return {prefix,lastSeq:Math.max(0,Number(row.cursor_value)||0)};
}
async function setTucsonCursor(env,prefix,lastSeq){
  if(!env.DB)return;
  await env.DB.prepare(`INSERT INTO market_cursors (market,cursor_key,cursor_value,updated_at)
    VALUES ('Tucson',?,?,datetime('now'))
    ON CONFLICT(market) DO UPDATE SET cursor_key=excluded.cursor_key,cursor_value=excluded.cursor_value,updated_at=datetime('now')`)
    .bind(prefix,String(lastSeq)).run();
}
async function fetchArcGIS(url,params,label){
  const r=await fetch(`${url}?${new URLSearchParams(params)}`,{headers:{'user-agent':'RevenueTrigger/3.0 public-data intelligence'}});
  if(!r.ok)throw new Error(`${label} API ${r.status}`);
  const j=await r.json();if(j.error)throw new Error(j.error.message||`${label} API error`);return j.features||[];
}
async function fetchPhoenix(days=7,limit=500){
  const d=new Date(Date.now()-days*86400000).toISOString().slice(0,10);
  const features=await fetchArcGIS(PHX_PERMITS,{where:`PER_ISSUE_DATE >= DATE '${d}'`,outFields:'OBJECTID,PER_TYPE,PER_NUM,PROJECT,PERMIT_NAME,PERMIT_STAT,PER_ENT_DATE,PER_ISSUE_DATE,STREET_FULL_NAME,PROFESS_NAME,PER_TYPE_DESC,MOD_DESC,SCOPE_CODE,SCOPE_DESC',orderByFields:'PER_ISSUE_DATE DESC',resultRecordCount:String(Math.min(limit,1000)),returnGeometry:'false',f:'json'},'Phoenix');
  return features.map(normalizePhoenix);
}

const TEMPE_CITIZEN_SEARCH='https://epermits.tempe.gov/citizenaccess/Cap/CapHome.aspx?module=Building&TabName=Building';

function decodeTempeHtml(v=''){
  return String(v||'')
    .replace(/&nbsp;/gi,' ')
    .replace(/&amp;/gi,'&')
    .replace(/&quot;/gi,'"')
    .replace(/&#39;|&#x27;/gi,"'")
    .replace(/&lt;/gi,'<')
    .replace(/&gt;/gi,'>');
}
function tempeHiddenInput(html,name){
  const safe=String(name||'');
  const p1=new RegExp("<input[^>]+name=[\"']"+safe+"[\"'][^>]+value=[\"']([^\"']*)[\"'][^>]*>","i");
  const p2=new RegExp("<input[^>]+value=[\"']([^\"']*)[\"'][^>]+name=[\"']"+safe+"[\"'][^>]*>","i");
  for(const p of [p1,p2]){
    const m=String(html||'').match(p);
    if(m&&m[1]!==undefined)return decodeTempeHtml(m[1]);
  }
  return '';
}
function tempeCookieHeader(response){
  try{
    const all=typeof response?.headers?.getSetCookie==='function'?response.headers.getSetCookie():[];
    if(all&&all.length)return all.map(x=>String(x).split(';')[0]).filter(Boolean).join('; ');
  }catch{}
  const raw=response?.headers?.get?.('set-cookie')||'';
  if(!raw)return '';
  return raw.split(/,(?=\s*[^;,=]+=[^;,]*)/).map(x=>x.trim().split(';')[0]).filter(Boolean).join('; ');
}
function tempeCapDetailUrl(html,baseUrl=TEMPE_CITIZEN_SEARCH){
  const raw=String(html||'');
  const matches=[...raw.matchAll(/href=["']([^"']*\/Cap\/CapDetail\.aspx\?[^"']+)["']/gi)];
  const href=matches.map(m=>decodeTempeHtml(m[1])).find(Boolean);
  if(!href)return null;
  try{return new URL(href,baseUrl).toString()}catch{return null}
}
function parseTempeCitizenDetail(html,permit){
  const text=stripTucsonHtml(html);
  const contractor=(text.match(/Contractor's Name:\s*(.*?)\s*Contractor's Lic\. No\.:/i)?.[1]||'').trim()||null;
  const license=(text.match(/Contractor's Lic\. No\.:\s*([A-Za-z0-9-]+)/i)?.[1]||'').trim()||null;
  const valuationRaw=(text.match(/Project Valuation\(\$\):\s*\$?([\d,]+(?:\.\d+)?)/i)?.[1]||'').trim();
  const valuation=valuationRaw?Number(valuationRaw.replace(/,/g,'')):null;
  const status=(text.match(/Record Status:\s*(.*?)\s*Create a New Collection/i)?.[1]||'').trim()||null;
  const issued=(text.match(/Permit Issued:\s*(\d{1,2}\/\d{1,2}\/\d{4})/i)?.[1]||'').trim()||null;
  const applied=(text.match(/Applied Date:\s*(\d{1,2}\/\d{1,2}\/\d{4})/i)?.[1]||'').trim()||null;
  const project=(text.match(/Project Description:\s*(.*?)\s*More Details/i)?.[1]||'').trim()||null;
  return {
    permit:String(permit||'').trim(),
    contractor,
    contractorLicense:license,
    officialValuation:Number.isFinite(valuation)?valuation:null,
    status,
    appliedDate:applied,
    issuedDate:issued,
    projectDescription:project,
    source:'City of Tempe Citizen Access — public Building record'
  };
}


function tempeProfessionalCompany(p={}){
  const candidates=[
    p.businessName,p.businessName2,p.contractorBusinessName,p.organizationName,
    p.tradeName,p.companyName,p.name,p.fullName
  ].map(x=>String(x||'').trim()).filter(Boolean);
  return candidates.find(isMeaningfulCompanyName)||null;
}
function tempeProfessionalLicense(p={}){
  return String(p.licenseNumber||p.contractorLicenseNumber||p.businessLicense||p.referenceLicenseId||'').trim()||null;
}
async function fetchTempeAccelaApiRecord(permit){
  const record=String(permit||'').trim().toUpperCase();
  const endpoint='https://apis.accela.com/v4/search/records?limit=10&expand=professionals,contacts,addresses';
  const bodies=[
    {customId:record,serviceProviderCode:'TEMPE',module:'Building'},
    {customId:record,module:'Building'},
    {customId:record,serviceProviderCode:'TEMPE'}
  ];
  const headerVariants=[
    {},
    {'x-accela-agency':'TEMPE'},
    {'x-accela-agency':'TEMPE','x-accela-environment':'PROD'}
  ];
  const attempts=[];

  for(let i=0;i<bodies.length;i++){
    for(let j=0;j<headerVariants.length;j++){
      try{
        const r=await fetch(endpoint,{
          method:'POST',
          headers:{
            'content-type':'application/json',
            'accept':'application/json',
            'user-agent':'RevenueTrigger/6.3 Tempe Accela API enrichment',
            ...headerVariants[j]
          },
          body:JSON.stringify(bodies[i])
        });
        const text=await r.text();
        let data=null;
        try{data=JSON.parse(text)}catch{}
        const results=Array.isArray(data?.result)?data.result:[];
        const exact=results.find(x=>String(x?.customId||'').trim().toUpperCase()===record)||results[0]||null;
        attempts.push({
          bodyVariant:i+1,
          headerVariant:j+1,
          status:r.status,
          resultCount:results.length,
          message:data?.message||data?.code||null
        });
        if(r.ok&&exact){
          const professionals=Array.isArray(exact.professionals)?exact.professionals:[];
          const companyCandidates=professionals.map(tempeProfessionalCompany).filter(Boolean);
          const company=companyCandidates[0]||null;
          const professional=professionals.find(p=>tempeProfessionalCompany(p)===company)||professionals[0]||null;
          const valuation=Number(exact.estimatedTotalJobCost||exact.estimatedJobCost||exact.jobValue||exact.valuation||0)||null;
          return {
            ok:true,
            record:exact,
            contractor:company,
            contractorLicense:professional?tempeProfessionalLicense(professional):null,
            officialValuation:valuation,
            status:exact.status?.text||exact.status?.value||exact.status||null,
            description:exact.description||exact.name||null,
            source:'Accela V4 Search Records API — Tempe',
            attempts
          };
        }
      }catch(e){
        attempts.push({bodyVariant:i+1,headerVariant:j+1,status:null,error:String(e?.message||e)});
      }
    }
  }
  return {ok:false,attempts};
}

async function fetchTempeCitizenDetailByPermit(permit){
  const record=String(permit||'').trim().toUpperCase();
  if(!/^BP\d{6}$/i.test(record))throw new Error('Tempe permit must look like BP261214');

  const start=await fetch(TEMPE_CITIZEN_SEARCH,{
    headers:{
      'user-agent':'RevenueTrigger/6.2 Tempe public permit enrichment',
      'accept':'text/html,application/xhtml+xml'
    },
    redirect:'follow'
  });
  const startHtml=await start.text();
  if(!start.ok)throw new Error('Tempe Citizen Access search '+start.status);
  const cookie=tempeCookieHeader(start);

  const hidden={};
  for(const field of ['__VIEWSTATE','__VIEWSTATEGENERATOR','__EVENTVALIDATION','__EVENTTARGET','__EVENTARGUMENT','__LASTFOCUS','__VIEWSTATEENCRYPTED','ACA_CS_FIELD']){
    hidden[field]=tempeHiddenInput(startHtml,field)||'';
  }

  const now=new Date();
  const mm=String(now.getUTCMonth()+1).padStart(2,'0');
  const dd=String(now.getUTCDate()).padStart(2,'0');
  const yyyy=now.getUTCFullYear();
  const endDate=mm+'/'+dd+'/'+yyyy;

  const common={
    ...hidden,
    'ctl00$PlaceHolderMain$ddlSearchType':'0',
    'ctl00$PlaceHolderMain$generalSearchForm$txtGSPermitNumber':record,
    'ctl00$PlaceHolderMain$generalSearchForm$ddlGSPermitType':'',
    'ctl00$PlaceHolderMain$generalSearchForm$txtGSProjectName':'',
    'ctl00$PlaceHolderMain$generalSearchForm$txtGSStartDate':'01/01/2015',
    'ctl00$PlaceHolderMain$generalSearchForm$txtGSEndDate':endDate,
    'ctl00$PlaceHolderMain$generalSearchForm$txtGSAppZipSearchPermit_ZipFromAA':'0',
    'ctl00$HeaderNavigation$hdnShowReportLink':'N'
  };

  const variants=[
    {
      ...common,
      'ctl00$ScriptManager1':'ctl00$PlaceHolderMain$updatePanel|ctl00$PlaceHolderMain$btnNewSearch',
      '__ASYNCPOST':'true',
      'Submit':'Submit'
    },
    {
      ...common,
      '__EVENTTARGET':'ctl00$PlaceHolderMain$btnNewSearch',
      'ctl00$ScriptManager1':'ctl00$PlaceHolderMain$updatePanel|ctl00$PlaceHolderMain$btnNewSearch',
      '__ASYNCPOST':'true'
    },
    {
      ...common,
      'ctl00$PlaceHolderMain$btnNewSearch':'Search'
    }
  ];

  let searchHtml='',searchUrl=TEMPE_CITIZEN_SEARCH,detailUrl=null,matchedVariant=null;
  const errors=[];

  for(let i=0;i<variants.length;i++){
    const body=new URLSearchParams();
    for(const [k,v] of Object.entries(variants[i]))body.set(k,String(v??''));

    try{
      const search=await fetch(TEMPE_CITIZEN_SEARCH,{
        method:'POST',
        headers:{
          'user-agent':'RevenueTrigger/6.2 Tempe public permit enrichment',
          'accept':'text/html,application/xhtml+xml,*/*',
          'content-type':'application/x-www-form-urlencoded; charset=UTF-8',
          ...(cookie?{'cookie':cookie}:{}),
          ...(i<2?{
            'x-microsoftajax':'Delta=true',
            'x-requested-with':'XMLHttpRequest'
          }:{})
        },
        body:body.toString(),
        redirect:'follow'
      });
      const html=await search.text();
      if(!search.ok){
        errors.push('variant '+(i+1)+' HTTP '+search.status);
        continue;
      }

      const text=stripTucsonHtml(html);
      const containsRecord=text.toUpperCase().includes(record);
      const candidate=/\/Cap\/CapDetail\.aspx/i.test(search.url||'')
        ?search.url
        :tempeCapDetailUrl(html,TEMPE_CITIZEN_SEARCH);

      if(containsRecord||candidate){
        searchHtml=html;
        searchUrl=search.url||TEMPE_CITIZEN_SEARCH;
        detailUrl=candidate;
        matchedVariant=i+1;
        break;
      }
      errors.push('variant '+(i+1)+' returned search form without permit');
    }catch(e){
      errors.push('variant '+(i+1)+' '+String(e?.message||e));
    }
  }

  if(!searchHtml)throw new Error('Tempe Citizen Access search postback did not return permit. '+errors.join(' | '));
  if(!detailUrl){
    const text=stripTucsonHtml(searchHtml);
    if(!text.toUpperCase().includes(record))throw new Error('Tempe permit not found in Citizen Access search response');
    throw new Error('Tempe permit found but CapDetail link could not be resolved');
  }

  const detail=await fetch(detailUrl,{
    headers:{
      'user-agent':'RevenueTrigger/6.2 Tempe public permit enrichment',
      'accept':'text/html,application/xhtml+xml',
      ...(cookie?{'cookie':cookie}:{})
    },
    redirect:'follow'
  });
  const detailHtml=await detail.text();
  if(!detail.ok)throw new Error('Tempe Citizen Access detail '+detail.status);
  const parsed=parseTempeCitizenDetail(detailHtml,record);
  return {
    ...parsed,
    detailUrl:detail.url||detailUrl,
    searchVariant:matchedVariant,
    searchUrl
  };
}


async function fetchTempe(days=7,limit=500){
  const d=new Date(Date.now()-days*86400000).toISOString().slice(0,10);
  const features=await fetchArcGIS(TEMPE_PERMITS,{where:`IssuedDateDtm >= DATE '${d}'`,outFields:'OBJECTID,PermitNum,Description,AppliedDateDtm,IssuedDateDtm,Type,StatusCurrent,OriginalAddress1,OriginalAddress2,OriginalCity,OriginalState,OriginalZip,PermitClass,PermitType,PermitTypeDesc,StatusDateDtm,EstProjectCost,ContractorCompanyName,ProjectName',orderByFields:'IssuedDateDtm DESC',resultRecordCount:String(Math.min(limit,1800)),returnGeometry:'false',f:'json'},'Tempe');
  return features.map(normalizeTempe);
}
async function fetchTucson(days=7,limit=500,env=null){
  const {prefix,lastSeq}=await getTucsonCursor(env);
  const maxProbe=Math.min(80,Math.max(20,Number(limit)||60));
  const hitRows=[],errors=[],detailErrors=[];
  let highestFound=lastSeq;
  const cutoff=Date.now()-days*86400000;

  for(let offset=1;offset<=maxProbe;offset+=5){
    const nums=[];
    for(let j=0;j<5&&offset+j<=maxProbe;j++)nums.push(lastSeq+offset+j);
    const results=await Promise.all(nums.map(async n=>{
      const permit=prefix+tucsonPad5(n);
      try{return {n,row:await fetchTucsonPermit(permit)}}catch(e){return {n,error:String(e?.message||e)}}
    }));
    for(const x of results){
      if(x.error){errors.push({sequence:x.n,error:x.error});continue;}
      if(!x.row)continue;
      highestFound=Math.max(highestFound,x.n);
      if(tucsonDateMs(x.row.applyDate)>=cutoff)hitRows.push(x.row);
    }
    if(offset+5<=maxProbe)await sleep(200);
  }

  if(highestFound>lastSeq)await setTucsonCursor(env,prefix,highestFound);

  const enriched=[];
  for(let i=0;i<hitRows.length;i+=5){
    const batch=await Promise.all(hitRows.slice(i,i+5).map(async row=>{
      try{
        const detail=await fetchTucsonPermitDetail(row.permit);
        return {...row,applicant:detail?.applicant||null,businessApplicant:detail?.businessApplicant||null};
      }catch(e){
        detailErrors.push({permit:row.permit,error:String(e?.message||e)});
        return row;
      }
    }));
    enriched.push(...batch);
    if(i+5<hitRows.length)await sleep(150);
  }

  const hits=enriched.map(normalizeTucsonPro).sort((a,b)=>new Date(b.date)-new Date(a.date));

  // Attach non-enumerable diagnostics for refresh() without changing lead JSON shape.
  Object.defineProperty(hits,'_meta',{value:{
    prefix,start:lastSeq+1,scannedTo:lastSeq+maxProbe,highestFound,
    errors:errors.slice(0,5),
    attribution:{
      detailPagesChecked:hitRows.length,
      businessApplicants:hits.filter(x=>isMeaningfulCompanyName(x.company)).length,
      notListed:hits.filter(x=>!isMeaningfulCompanyName(x.company)).length,
      detailErrors:detailErrors.slice(0,5)
    }
  },enumerable:false});
  return hits.slice(0,limit);
}

async function tucsonDebug(env){
  const {prefix,lastSeq}=await getTucsonCursor(env);
  const rows=[];
  for(let n=lastSeq+1;n<=lastSeq+10;n++){
    const permit=prefix+tucsonPad5(n);
    try{
      const row=await fetchTucsonPermit(permit);
      if(row)rows.push(row);
    }catch(e){
      rows.push({permit,error:String(e?.message||e)});
    }
  }
  return {prefix,lastSeq,nextFrom:lastSeq+1,rows};
}

function scottsdaleDate(v){
  const s=String(v||'').trim();
  if(!s)return null;
  const m=s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})(?:\s+\d{1,2}:\d{2}(?::\d{2})?\s*[AP]M)?$/i);
  if(m)return Date.UTC(Number(m[3]),Number(m[1])-1,Number(m[2]),12,0,0);
  const n=new Date(s).getTime();
  return Number.isFinite(n)?n:null;
}
function scottsdaleMmddyyyy(d){
  const mm=String(d.getUTCMonth()+1).padStart(2,'0');
  const dd=String(d.getUTCDate()).padStart(2,'0');
  return `${mm}/${dd}/${d.getUTCFullYear()}`;
}
function parseScottsdaleCsv(text){
  const rows=[];let row=[],field='',quoted=false;
  for(let i=0;i<text.length;i++){
    const c=text[i];
    if(quoted){
      if(c==='"'&&text[i+1]==='"'){field+='"';i++;}
      else if(c==='"')quoted=false;
      else field+=c;
    }else{
      if(c==='"')quoted=true;
      else if(c===','){row.push(field);field='';}
      else if(c==='\n'){row.push(field);field='';if(row.some(x=>String(x).trim()!==''))rows.push(row);row=[];}
      else if(c!=='\r')field+=c;
    }
  }
  if(field.length||row.length){row.push(field);if(row.some(x=>String(x).trim()!==''))rows.push(row);}
  if(!rows.length)return [];
  const headers=rows[0].map(x=>String(x).trim().replace(/^\uFEFF/,''));
  return rows.slice(1).map(r=>Object.fromEntries(headers.map((h,i)=>[h,String(r[i]??'').trim()])));
}
async function fetchScottsdale(days=7,limit=500){
  const page=await fetch(SCOTTSDALE_REPORTS,{
    redirect:'follow',
    headers:{'user-agent':'RevenueTrigger/3.5 Scottsdale permit ingestion','accept':'text/html,application/xhtml+xml'}
  });
  if(!page.ok)throw new Error(`Scottsdale reports page ${page.status}`);
  await page.text();
  const cookie=page.headers.get('set-cookie')||'';

  const end=new Date();
  const start=new Date(Date.now()-days*86400000);
  const body=new URLSearchParams({
    permitTypeID:'',
    startDate:scottsdaleMmddyyyy(start),
    endDate:scottsdaleMmddyyyy(end),
    currentPage:'1'
  });
  const headers={
    'user-agent':'RevenueTrigger/3.5 Scottsdale permit ingestion',
    'accept':'text/csv,application/csv,text/plain,*/*',
    'content-type':'application/x-www-form-urlencoded; charset=UTF-8',
    'referer':SCOTTSDALE_REPORTS,
    'origin':'https://eservices.scottsdaleaz.gov'
  };
  if(cookie)headers.cookie=cookie;

  const r=await fetch(SCOTTSDALE_CSV,{method:'POST',redirect:'follow',headers,body:body.toString()});
  const text=await r.text();
  if(!r.ok)throw new Error(`Scottsdale CSV ${r.status}`);
  if(!/permit/i.test(text.slice(0,200)))throw new Error('Scottsdale CSV response was not permit data');

  const rows=parseScottsdaleCsv(text);
  const seen=new Set(),out=[];
  const startMs=Date.UTC(start.getUTCFullYear(),start.getUTCMonth(),start.getUTCDate(),0,0,0);
  const endMs=Date.UTC(end.getUTCFullYear(),end.getUTCMonth(),end.getUTCDate(),23,59,59);
  for(const a of rows){
    const permit=String(a.Permit||'').trim();
    if(!permit||seen.has(permit))continue;
    const issueDate=scottsdaleDate(a.IssueDate);
    // Never manufacture recency for a Scottsdale row. If the city omits or returns
    // an unparseable issue date, exclude it from a date-window opportunity feed.
    if(!Number.isFinite(issueDate)||issueDate<startMs||issueDate>endMs)continue;
    seen.add(permit);

    const scope=[a.PermitType,a.Subdivision,a.Builder].filter(Boolean).join(' — ');
    const official=Number(String(a.Valuation||'').replace(/[$,]/g,''));
    const lead=leadFrom({
      market:'Scottsdale',
      id:permit,
      name:a.PermitType||'Scottsdale permit activity',
      address:a.Address||'Scottsdale, AZ',
      date:issueDate,
      company:a.Builder||a.Owner||'Not listed',
      scope,
      permit,
      permitStatus:'Issued',
      source:'City of Scottsdale Building Permit Reports — official CSV',
      officialValue:Number.isFinite(official)&&official>0?official:null
    });
    out.push(lead);
    if(out.length>=limit)break;
  }
  return out.sort((a,b)=>new Date(b.date)-new Date(a.date));
}


async function scottsdaleDebug(days=7){
  const page=await fetch(SCOTTSDALE_REPORTS,{
    redirect:'follow',
    headers:{'user-agent':'RevenueTrigger/5.0 Scottsdale diagnostics','accept':'text/html,application/xhtml+xml'}
  });
  if(!page.ok)throw new Error(`Scottsdale reports page ${page.status}`);
  await page.text();
  const cookie=page.headers.get('set-cookie')||'';
  const end=new Date();
  const start=new Date(Date.now()-days*86400000);
  const body=new URLSearchParams({permitTypeID:'',startDate:scottsdaleMmddyyyy(start),endDate:scottsdaleMmddyyyy(end),currentPage:'1'});
  const headers={
    'user-agent':'RevenueTrigger/5.0 Scottsdale diagnostics',
    'accept':'text/csv,application/csv,text/plain,*/*',
    'content-type':'application/x-www-form-urlencoded; charset=UTF-8',
    'referer':SCOTTSDALE_REPORTS,
    'origin':'https://eservices.scottsdaleaz.gov'
  };
  if(cookie)headers.cookie=cookie;
  const r=await fetch(SCOTTSDALE_CSV,{method:'POST',redirect:'follow',headers,body:body.toString()});
  const text=await r.text();
  if(!r.ok)throw new Error(`Scottsdale CSV ${r.status}`);
  const rows=parseScottsdaleCsv(text);
  const headersFound=rows.length?Object.keys(rows[0]):[];
  const issueDates={};
  let withPermit=0,withBuilder=0,withOwner=0,withValuation=0,invalidIssueDate=0;
  let newestIssueDate=null,oldestIssueDate=null;
  for(const a of rows){
    if(String(a.Permit||'').trim())withPermit++;
    if(String(a.Builder||'').trim())withBuilder++;
    if(String(a.Owner||'').trim())withOwner++;
    if(Number(String(a.Valuation||'').replace(/[$,]/g,''))>0)withValuation++;
    const d=String(a.IssueDate||'').trim()||'(missing)';
    issueDates[d]=(issueDates[d]||0)+1;
    const ts=scottsdaleDate(a.IssueDate);
    if(!Number.isFinite(ts))invalidIssueDate++;
    else{
      if(newestIssueDate===null||ts>newestIssueDate)newestIssueDate=ts;
      if(oldestIssueDate===null||ts<oldestIssueDate)oldestIssueDate=ts;
    }
  }
  return {
    requested:{days,startDate:scottsdaleMmddyyyy(start),endDate:scottsdaleMmddyyyy(end)},
    http:{status:r.status,contentType:r.headers.get('content-type')||null,bytes:text.length},
    parsed:{
      rows:rows.length,headers:headersFound,withPermit,withBuilder,withOwner,withValuation,
      invalidIssueDate,
      newestIssueDate:newestIssueDate?new Date(newestIssueDate).toISOString():null,
      oldestIssueDate:oldestIssueDate?new Date(oldestIssueDate).toISOString():null
    },
    issueDates:Object.entries(issueDates).sort((a,b)=>String(b[0]).localeCompare(String(a[0]))).slice(0,20),
    sample:rows.slice(0,5).map(a=>({Permit:a.Permit||null,IssueDate:a.IssueDate||null,PermitType:a.PermitType||null,Address:a.Address||null,Valuation:a.Valuation||null,Builder:a.Builder||null,Owner:a.Owner||null}))
  };
}

function mesaDateValue(v){
  if(!v)return null;
  const n=new Date(v).getTime();
  return Number.isFinite(n)?n:null;
}
function mesaRecentDate(a){
  const vals=[a.opened_date,a.update_date,a.finaled_date]
    .map(mesaDateValue).filter(v=>Number.isFinite(v));
  return vals.length?Math.max(...vals):Date.now();
}
async function fetchMesa(days=7,limit=500){
  const cutoff=new Date(Date.now()-days*86400000).toISOString().slice(0,19);
  const qs=new URLSearchParams({
    '$where':`opened_date >= '${cutoff}' AND permit_type = 'COM'`,
    '$order':'opened_date DESC',
    '$limit':String(Math.min(Math.max(limit*2,100),1000))
  });
  const r=await fetch(`${MESA_PERMITS}?${qs}`,{
    redirect:'follow',
    headers:{
      'user-agent':'RevenueTrigger/3.8 Mesa permit ingestion',
      'accept':'application/json'
    }
  });
  const text=await r.text();
  if(!r.ok)throw new Error(`Mesa API ${r.status}`);
  let rows;
  try{rows=JSON.parse(text)}catch{throw new Error('Mesa API returned invalid JSON');}
  if(!Array.isArray(rows))throw new Error('Mesa API response was not an array');

  const seen=new Set(),out=[];
  for(const a of rows){
    const permit=String(a.permit_number||'').trim();
    if(!permit||seen.has(permit))continue;
    seen.add(permit);

    const description=[
      a.type_of_work,
      a.description_of_work,
      a.permit_module,
      a.contractor_name
    ].filter(Boolean).join(' — ');

    const official=Number(String(a.icc_value||'').replace(/[$,]/g,''));
    const sqft=Number(String(a.total_square_feet||'').replace(/[,]/g,''));
    const scope=[description,Number.isFinite(sqft)&&sqft>0?`${sqft.toLocaleString('en-US')} sq ft`:null]
      .filter(Boolean).join(' — ');

    const lead=leadFrom({
      market:'Mesa',
      id:permit,
      name:a.type_of_work||a.permit_type||'Mesa commercial permit',
      address:a.property_address||'Mesa, AZ',
      date:mesaRecentDate(a),
      company:a.contractor_name||'Not listed',
      scope,
      permit,
      permitStatus:a.status||'—',
      source:'City of Mesa Data Hub — Building Permits',
      officialValue:Number.isFinite(official)&&official>0?official:null
    });

    out.push(lead);
    if(out.length>=limit)break;
  }
  return out.sort((a,b)=>new Date(b.date)-new Date(a.date));
}



function isMeaningfulCompanyName(v=''){
  const s=String(v||'').replace(/\s+/g,' ').trim();
  if(!s)return false;
  // Single-letter alphabetic values in municipal participant fields are field noise,
  // not durable company identities. Numeric/brand names such as 3M remain valid.
  if(/^[a-z]$/i.test(s))return false;
  return !/^(not listed|unknown|n\/a|none|null|-+|owner|to be bid|tbd|to be determined|not provided|unassigned)$/i.test(s);
}
function cleanCompanyName(v){
  const s=String(v||'').replace(/\s+/g,' ').trim();
  return isMeaningfulCompanyName(s)?s:null;
}
function normalizeProjectName(v){
  return String(v||'')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g,' ')
    .replace(/\b(onsite|offsite|site|project|phase|building|permit)\b/g,' ')
    .replace(/\s+/g,' ')
    .trim();
}
function chandlerParticipantFromAttributes(a={}){
  const priorities=[
    ['contractor','Contractor'],
    ['company','Company'],
    ['builder','Builder'],
    ['developer','Developer'],
    ['applicant','Applicant'],
    ['owner','Owner'],
    ['architect','Architect'],
    ['engineer','Engineer']
  ];
  const entries=Object.entries(a);
  for(const [needle,role] of priorities){
    for(const [key,val] of entries){
      const k=String(key).toLowerCase();
      if(!k.includes(needle))continue;
      if(k.includes('id')||k.includes('date')||k.includes('status')||k.includes('type'))continue;
      const company=cleanCompanyName(val);
      if(company)return {company,role,field:key};
    }
  }
  return null;
}
function chandlerAccelaDate(v){
  if(v===null||v===undefined||v==='')return NaN;
  const n=Number(v);
  if(Number.isFinite(n)&&n>10000000000)return n;
  const parsed=new Date(v).getTime();
  return Number.isFinite(parsed)&&parsed>0?parsed:NaN;
}
function chandlerAccelaParticipant(a={}){
  const contractor=cleanCompanyName(a.PRI_CNTRCT_BUS_NM);
  if(contractor)return {company:contractor,role:'Contractor',field:'PRI_CNTRCT_BUS_NM',matchType:'accela-permit-exact',matchConfidence:1};
  const contactBusiness=cleanCompanyName(a.PRI_CNTCT_BUS_NM);
  if(contactBusiness)return {company:contactBusiness,role:'Primary Contact Business',field:'PRI_CNTCT_BUS_NM',matchType:'accela-permit-exact',matchConfidence:1};
  const owner=cleanCompanyName(a.OWNER_NM);
  if(owner)return {company:owner,role:'Owner',field:'OWNER_NM',matchType:'accela-permit-exact',matchConfidence:1};
  return null;
}
function chandlerAccelaLead(a={}){
  const permit=String(a.PERMIT_NBR||'').trim();
  const project=String(a.PROJECT_NM||'').trim()||String(a.PERMIT_TYPE||a.B1_PER_TYPE||'Chandler permit').trim();
  const address=String(a.FULL_ADDR||a.FULL_ADDRESS||'Chandler, AZ').trim()||'Chandler, AZ';
  const desc=String(a.DETAIL_DESC||'').trim();
  const type=[a.PERMIT_TYPE,a.B1_PER_TYPE,a.B1_PER_SUB_TYPE].filter(Boolean).join(' — ');
  const sqft=Number(String(a.SQ_FOOT||'').replace(/[^0-9.]/g,''));
  const value=Number(String(a.JOB_VALUE||'').replace(/[$,\s]/g,''));
  const participant=chandlerAccelaParticipant(a);
  const date=chandlerAccelaDate(a.CREATE_DT);
  const scope=[type,desc,Number.isFinite(sqft)&&sqft>0?`${Math.round(sqft).toLocaleString('en-US')} sq ft`:null].filter(Boolean).join(' — ');
  return leadFrom({
    market:'Chandler',
    id:permit||a.OBJECTID,
    name:project,
    address,
    date:Number.isFinite(date)?date:null,
    company:participant?.company||'Not listed',
    scope,
    permit:permit||'—',
    permitStatus:a.PERMIT_STATUS||'—',
    source:'City of Chandler Accela permit layer — official ArcGIS',
    officialValue:Number.isFinite(value)&&value>0?value:null
  });
}
async function fetchChandlerAccelaPermits(days=7,limit=500){
  const count=Math.min(Math.max(Number(limit)||500,50),2000);
  const features=await fetchArcGIS(CHANDLER_ACCELA_PERMITS,{
    where:'1=1',
    outFields:'OBJECTID,FULL_ADDRESS,PERMIT_NBR,CREATE_DT,PROJECT_NM,B1_PER_TYPE,B1_PER_SUB_TYPE,PERMIT_STATUS,DETAIL_DESC,PERMIT_TYPE,PARCEL_NBR,JOB_VALUE,SQ_FOOT,FULL_ADDR,ZIP_CODE,PRI_CNTCT_BUS_NM,PRI_CNTRCT_BUS_NM,OWNER_NM',
    orderByFields:'CREATE_DT DESC',
    resultRecordCount:String(count),
    returnGeometry:'false',
    f:'json'
  },'Chandler Accela');
  const cutoff=Date.now()-Math.max(1,Number(days)||7)*86400000;
  const rows=[];
  for(const f of features){
    const a=f.attributes||{};
    const ts=chandlerAccelaDate(a.CREATE_DT);
    if(!Number.isFinite(ts)||ts<cutoff)continue;
    rows.push(chandlerAccelaLead(a));
    if(rows.length>=limit)break;
  }
  return rows;
}
async function fetchChandlerAccelaByPermits(permitNumbers=[]){
  const ids=[...new Set((permitNumbers||[]).map(x=>String(x||'').trim()).filter(Boolean))];
  if(!ids.length)return [];
  const out=[];
  for(let i=0;i<ids.length;i+=75){
    const batch=ids.slice(i,i+75);
    const quoted=batch.map(x=>`'${x.replace(/'/g,"''")}'`).join(',');
    const features=await fetchArcGIS(CHANDLER_ACCELA_PERMITS,{
      where:`PERMIT_NBR IN (${quoted})`,
      outFields:'OBJECTID,FULL_ADDRESS,PERMIT_NBR,CREATE_DT,PROJECT_NM,B1_PER_TYPE,B1_PER_SUB_TYPE,PERMIT_STATUS,DETAIL_DESC,PERMIT_TYPE,PARCEL_NBR,JOB_VALUE,SQ_FOOT,FULL_ADDR,ZIP_CODE,PRI_CNTCT_BUS_NM,PRI_CNTRCT_BUS_NM,OWNER_NM',
      resultRecordCount:'2000',
      returnGeometry:'false',
      f:'json'
    },'Chandler Accela detail');
    for(const f of features)out.push(f.attributes||{});
  }
  return out;
}
function buildChandlerAccelaIndex(rows=[]){
  const byPermit=new Map(),byProject=new Map();
  for(const a of rows){
    const permit=String(a.PERMIT_NBR||'').trim().toLowerCase();
    if(permit&&!byPermit.has(permit))byPermit.set(permit,a);
    const project=normalizeProjectName(a.PROJECT_NM||'');
    if(project&&!byProject.has(project))byProject.set(project,a);
  }
  return {byPermit,byProject};
}
function matchChandlerAccelaRecord(permit,project,index){
  const p=String(permit||'').trim().toLowerCase();
  if(p&&p!=='—'&&index.byPermit.has(p))return {row:index.byPermit.get(p),matchType:'permit-exact',matchConfidence:1};
  const key=normalizeProjectName(project||'');
  if(key&&index.byProject.has(key))return {row:index.byProject.get(key),matchType:'project-exact',matchConfidence:.97};
  return null;
}

async function fetchChandlerConstructionContractors(limit=500){
  const qs=new URLSearchParams({
    where:"GPS_CONTRACTOR_NAME IS NOT NULL AND GPS_CONTRACTOR_NAME <> ''",
    outFields:'*',
    resultRecordCount:String(Math.min(Math.max(limit,50),1000)),
    returnGeometry:'false',
    f:'json'
  });
  const r=await fetch(`${CHANDLER_CONSTRUCTION}/query?${qs}`,{
    headers:{'user-agent':'RevenueTrigger/4.4 Chandler competitor intelligence','accept':'application/json'}
  });
  const text=await r.text();
  if(!r.ok)throw new Error(`Chandler contractor source ${r.status}`);
  let j;
  try{j=JSON.parse(text)}catch{throw new Error('Chandler contractor source invalid JSON');}
  if(j.error)throw new Error(j.error.message||'Chandler contractor source query error');
  return (j.features||[]).map(f=>{
    const a=f.attributes||{};
    return {
      id:a.OBJECTID,
      company:cleanCompanyName(a.GPS_CONTRACTOR_NAME),
      role:'Contractor',
      project:a.PROJECT_NAME||'Chandler construction project',
      description:a.DESCRIPTION||'',
      status:a.PROJECT_STATUS||'',
      phase:a.CONSTRUCTION_PHASE||'',
      ownership:a.PROJECT_OWNERSHIP||'',
      source:'City of Chandler GPS Construction Projects'
    };
  }).filter(x=>x.company);
}
function chandlerProjectTokens(v){
  const stop=new Set(['and','the','of','at','for','to','a','an','new','project','phase','building','site','onsite','offsite','permit','development','improvements','improvement']);
  return normalizeProjectName(v).split(' ').filter(x=>x.length>=3&&!stop.has(x));
}
function buildChandlerContractorIndex(rows=[]){
  const exact=new Map();
  const prepared=[];
  for(const x of rows){
    const key=normalizeProjectName(x.project);
    if(key&&!exact.has(key))exact.set(key,x);
    prepared.push({...x,_key:key,_tokens:chandlerProjectTokens(x.project)});
  }
  return {rows:prepared,exact};
}
function matchChandlerContractor(project,index){
  const key=normalizeProjectName(project);
  if(!key)return null;
  const exact=index.exact.get(key);
  if(exact)return {...exact,matchType:'exact',matchConfidence:1};

  const tokens=chandlerProjectTokens(project);
  if(tokens.length<2)return null;
  const tokenSet=new Set(tokens);
  let best=null,bestScore=0,bestOverlap=0;

  for(const x of index.rows){
    const other=x._key||normalizeProjectName(x.project);
    const otherTokens=x._tokens||chandlerProjectTokens(x.project);
    if(!other||otherTokens.length<2)continue;

    // Strong containment remains useful for projects that add/remove a phase or descriptor.
    if(key.length>=8&&other.length>=8&&(other.includes(key)||key.includes(other))){
      const lengthRatio=Math.min(key.length,other.length)/Math.max(key.length,other.length);
      const score=.86+(.12*lengthRatio);
      if(score>bestScore){best=x;bestScore=score;bestOverlap=Math.min(tokens.length,otherTokens.length);}
      continue;
    }

    const otherSet=new Set(otherTokens);
    let overlap=0;
    for(const t of tokenSet)if(otherSet.has(t))overlap++;
    if(overlap<2)continue;

    const union=new Set([...tokenSet,...otherSet]).size||1;
    const jaccard=overlap/union;
    const coverage=overlap/Math.min(tokenSet.size,otherSet.size);
    const score=(jaccard*.55)+(coverage*.45);
    if(score>bestScore){best=x;bestScore=score;bestOverlap=overlap;}
  }

  // Conservative threshold: require at least two meaningful shared tokens and a strong score.
  if(!best||bestOverlap<2||bestScore<.68)return null;
  const { _key,_tokens,...clean }=best;
  return {...clean,matchType:'fuzzy-project',matchConfidence:Number(bestScore.toFixed(2))};
}

async function chandlerAccelaDebug(days=30){
  const features=await fetchArcGIS(CHANDLER_ACCELA_PERMITS,{
    where:'1=1',
    outFields:'OBJECTID,FULL_ADDRESS,PERMIT_NBR,CREATE_DT,PROJECT_NM,B1_PER_TYPE,B1_PER_SUB_TYPE,PERMIT_STATUS,DETAIL_DESC,PERMIT_TYPE,PARCEL_NBR,JOB_VALUE,SQ_FOOT,FULL_ADDR,ZIP_CODE,PRI_CNTCT_BUS_NM,PRI_CNTRCT_BUS_NM,OWNER_NM',
    orderByFields:'CREATE_DT DESC',
    resultRecordCount:'1000',
    returnGeometry:'false',
    f:'json'
  },'Chandler Accela diagnostics');
  const cutoff=Date.now()-Math.max(1,Number(days)||30)*86400000;
  const recent=[];
  let contractor=0,contactBusiness=0,owner=0,value=0;
  let newest=null,oldest=null;
  for(const f of features){
    const a=f.attributes||{};
    const ts=chandlerAccelaDate(a.CREATE_DT);
    if(Number.isFinite(ts)){
      if(newest===null||ts>newest)newest=ts;
      if(oldest===null||ts<oldest)oldest=ts;
    }
    if(!Number.isFinite(ts)||ts<cutoff)continue;
    recent.push(a);
    if(cleanCompanyName(a.PRI_CNTRCT_BUS_NM))contractor++;
    if(cleanCompanyName(a.PRI_CNTCT_BUS_NM))contactBusiness++;
    if(cleanCompanyName(a.OWNER_NM))owner++;
    const v=Number(String(a.JOB_VALUE||'').replace(/[$,\s]/g,''));
    if(Number.isFinite(v)&&v>0)value++;
  }
  return {
    fetched:features.length,
    days,
    recent:recent.length,
    newest:newest?new Date(newest).toISOString():null,
    oldestFetched:oldest?new Date(oldest).toISOString():null,
    coverage:{
      contractorBusiness:recent.length?Number((contractor/recent.length).toFixed(3)):0,
      contactBusiness:recent.length?Number((contactBusiness/recent.length).toFixed(3)):0,
      owner:recent.length?Number((owner/recent.length).toFixed(3)):0,
      jobValue:recent.length?Number((value/recent.length).toFixed(3)):0
    },
    sample:recent.slice(0,8).map(a=>({
      permit:a.PERMIT_NBR||null,
      created:a.CREATE_DT?new Date(Number(a.CREATE_DT)||a.CREATE_DT).toISOString():null,
      project:a.PROJECT_NM||null,
      type:a.PERMIT_TYPE||a.B1_PER_TYPE||null,
      status:a.PERMIT_STATUS||null,
      address:a.FULL_ADDR||a.FULL_ADDRESS||null,
      contractor:a.PRI_CNTRCT_BUS_NM||null,
      contactBusiness:a.PRI_CNTCT_BUS_NM||null,
      owner:a.OWNER_NM||null,
      jobValue:a.JOB_VALUE||null
    }))
  };
}

async function chandlerLayer(id,stage,limit=250){
  const qs=new URLSearchParams({
    where:'1=1',
    outFields:'*',
    resultRecordCount:String(Math.min(Math.max(limit,50),500)),
    returnGeometry:'false',
    f:'json'
  });
  const r=await fetch(`${CHANDLER_ACTIVE}/${id}/query?${qs}`,{
    headers:{
      'user-agent':'RevenueTrigger/4.2 Chandler ingestion',
      'accept':'application/json'
    }
  });
  const text=await r.text();
  if(!r.ok)throw new Error(`Chandler ${stage} ${r.status}`);
  let j;
  try{j=JSON.parse(text)}catch{throw new Error(`Chandler ${stage} invalid JSON`);}
  if(j.error)throw new Error(j.error.message||`Chandler ${stage} query error`);
  return (j.features||[]).map(f=>({stage,a:f.attributes||{}}));
}

function chandlerLeadFrom(stage,a){
  if(stage==='PRE-TECH'){
    const permit=String(a.PRE_B1_ALT_ID||'').trim();
    const project=a.PRE_PROJ_NM||'Chandler pre-tech project';
    const desc=a.PRE_DTL_DESC||'';
    return leadFrom({
      market:'Chandler',
      id:permit||a.OBJECTID,
      name:project,
      address:'Chandler, AZ',
      date:Date.now(),
      company:'Not listed',
      scope:[project,desc].filter(Boolean).join(' — '),
      permit:permit||'—',
      permitStatus:'Pre-Tech',
      source:'City of Chandler DSActiveProjects — PRE-TECH'
    });
  }

  if(stage==='APPROVED PROJECTS'){
    const permit=String(a.CIV_F_B1_ALT_ID||'').trim();
    const project=a.CIV_F_PROJ_NM||'Chandler approved project';
    const type=a.CIV_F_PERM_TYPE||a.ACCELA_PERMIT_TYPE||'Approved Project';
    const desc=a.CIV_F_DTL_DESC||'';
    const date=a.CIV_F_APPRV_DT||null;

    return leadFrom({
      market:'Chandler',
      id:permit||a.OBJECTID,
      name:project,
      address:'Chandler, AZ',
      date:date||Date.now(),
      company:'Not listed',
      scope:[type,desc].filter(Boolean).join(' — '),
      permit:permit||'—',
      permitStatus:'Approved',
      source:'City of Chandler DSActiveProjects — APPROVED PROJECTS'
    });
  }

  // UNDER CONSTRUCTION
  const permit=String(a.BLD_F_B1_ALT_ID||a.BLD_L_B1_ALT_ID||'').trim();
  const project=a.BLD_L_PROJ_NM||a.BLD_F_PROJ_NM||'Chandler development project';
  const type=a.BLD_F_PERM_TYPE||a.BLD_L_PERM_TYPE||a.ACCELA_PERMIT_TYPE||'Under Construction';
  const address=a.BLD_F_FULL_ADDRESS||a.BLD_L_FULL_ADDRESS||'Chandler, AZ';
  const desc=a.BLD_L_DTL_DESC||a.BLD_F_DTL_DESC||'';
  const val=Number(a.BLD_L_JOB_VALUE||a.BLD_F_JOB_VALUE||0);
  const sqft=Number(a.BLD_L_SQ_FT||a.BLD_F_SQ_FT||0);
  const date=a.BLD_F_ISSUED_DT||a.BLD_L_ISSUED_DT||a.BLD_L_CO_DT||null;
  const scope=[type,desc,Number.isFinite(sqft)&&sqft>0?`${sqft.toLocaleString('en-US')} sq ft`:null]
    .filter(Boolean).join(' — ');

  return leadFrom({
    market:'Chandler',
    id:permit||a.OBJECTID,
    name:project,
    address,
    date:date||Date.now(),
    company:'Not listed',
    scope,
    permit:permit||'—',
    permitStatus:'Under Construction',
    source:'City of Chandler DSActiveProjects — UNDER CONSTRUCTION',
    officialValue:Number.isFinite(val)&&val>0?val:null
  });
}
async function fetchChandler(days=7,limit=500){
  const settled=await Promise.allSettled([
    chandlerLayer(20,'PRE-TECH',150),
    chandlerLayer(19,'APPROVED PROJECTS',250),
    chandlerLayer(18,'UNDER CONSTRUCTION',250)
  ]);

  const merged=[];
  const stageStats={};
  const cutoff=Date.now()-days*86400000;

  settled.forEach((r,i)=>{
    const stage=['PRE-TECH','APPROVED PROJECTS','UNDER CONSTRUCTION'][i];

    if(r.status!=='fulfilled'){
      stageStats[stage]={ok:false,error:String(r.reason?.message||r.reason)};
      return;
    }

    stageStats[stage]={ok:true,raw:r.value.length,included:0,undated:0};

    for(const item of r.value){
      const a=item.a||{};

      // PRE-TECH has no trustworthy activity timestamp, so it remains excluded
      // from the live 7-day feed.
      if(stage==='PRE-TECH'){
        stageStats[stage].undated++;
        continue;
      }

      let rawDate=null;
      if(stage==='APPROVED PROJECTS'){
        rawDate=a.CIV_F_APPRV_DT||null;
      }else{
        rawDate=a.BLD_F_ISSUED_DT||a.BLD_L_ISSUED_DT||a.BLD_L_CO_DT||null;
      }

      const ts=rawDate===null||rawDate===undefined||rawDate==='' ? NaN :
        (Number(rawDate)||new Date(rawDate).getTime());

      if(!Number.isFinite(ts)){
        stageStats[stage].undated++;
        continue;
      }

      if(ts<cutoff)continue;

      merged.push(chandlerLeadFrom(stage,a));
      stageStats[stage].included++;
    }
  });

  const seen=new Map();
  for(const x of merged){
    const key=(x.permit&&x.permit!=='—')
      ? String(x.permit).toLowerCase()
      : `${x.name}|${x.address}`.toLowerCase();

    const prev=seen.get(key);
    if(!prev || x.score>prev.score)seen.set(key,x);
  }

  const out=[...seen.values()]
    .sort((a,b)=>b.score-a.score||new Date(b.date)-new Date(a.date))
    .slice(0,limit);

  Object.defineProperty(out,'_meta',{value:{stageStats},enumerable:false});
  return out;
}
async function fetchFortWorth(days=7,limit=500){
  const safeLimit=Math.max(1,Number(limit)||500);
  const pageSize=1000;
  const maxPages=Math.max(2,Math.min(5,Math.ceil(safeLimit/pageSize)+1));
  const records=await fetchFortWorthPermits({
    sinceDays:Math.max(1,Number(days)||7),
    pageSize,
    maxPages
  });
  return records
    .map(record=>{
      const input=toLeadInput(record);
      return leadFrom({
        ...input,
        source:'City of Fort Worth Development Services — Development Permits Open Data'
      });
    })
    .sort((a,b)=>b.score-a.score||new Date(b.date)-new Date(a.date))
    .slice(0,safeLimit);
}

function dallasSourceLabel(record){
  const observed=[...new Set((record.sourceObservations||[]).map(x=>x.report==='issued'?'Issued':'Submitted'))];
  const lifecycle=observed.length?observed.join(' + '):'Building';
  const url=record.sourceUrl||'';
  return `City of Dallas DallasNow Building — ${lifecycle}${url?` — ${url}`:''}`;
}
async function fetchDallas(days=7,limit=500){
  const safeLimit=Math.max(1,Number(limit)||500);
  const records=await fetchDallasNowBuildingRecords({days:Math.max(1,Number(days)||7)});
  const leads=records.map(record=>{
    const input=toLeadInput(record);
    const lead=leadFrom({...input,source:dallasSourceLabel(record)});
    return {
      ...lead,
      sourceRecordId:record.sourceRecordId,
      sourceUrl:record.sourceUrl||null,
      dallasNowLink:record.dallasNowLink||null,
      temporaryId:Boolean(record.temporaryId),
      secondaryFingerprint:record.secondaryFingerprint||null,
      sourceObservations:record.sourceObservations||[],
      participantRole:record.companyCandidate?'applicant':null,
      parcelNumber:record.parcelNumber||null,
      councilDistrict:record.councilDistrict||null
    };
  }).sort((a,b)=>b.score-a.score||new Date(b.date)-new Date(a.date)).slice(0,safeLimit);
  Object.defineProperty(leads,'_meta',{value:records._meta||null,enumerable:false});
  return leads;
}

async function fetchMarket(market,days=7,limit=500,env=null){
  if(market==='Phoenix')return fetchPhoenix(days,limit);
  if(market==='Tempe')return fetchTempe(days,limit);
  if(market==='Tucson')return fetchTucson(days,limit,env);
  if(market==='Scottsdale')return fetchScottsdale(days,limit);
  if(market==='Mesa')return fetchMesa(days,limit);
  if(market==='Chandler')return fetchChandlerAccelaPermits(days,limit);
  if(market==='Fort Worth')return fetchFortWorth(days,limit);
  if(market==='Dallas')return fetchDallas(days,limit);
  return [];
}
async function persist(env,leads){
  if(!env.DB)return;
  const sql=`INSERT INTO leads (id,name,address,event_date,company,scope,score,categories,value,temperature,permit,permit_status,official_value,source,market,updated_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,datetime('now'))
    ON CONFLICT(id) DO UPDATE SET name=excluded.name,address=excluded.address,event_date=excluded.event_date,company=excluded.company,scope=excluded.scope,score=excluded.score,categories=excluded.categories,value=excluded.value,temperature=excluded.temperature,permit=excluded.permit,permit_status=excluded.permit_status,official_value=excluded.official_value,source=excluded.source,market=excluded.market,updated_at=datetime('now')`;
  const stmts=leads.map(x=>env.DB.prepare(sql).bind(x.id,x.name,x.address,new Date(x.date).toISOString(),x.company,x.scope,x.score,JSON.stringify(x.categories),x.value,x.temperature,x.permit,x.permitStatus||'—',x.officialPermitValue||null,x.source,x.market||'Phoenix'));
  for(let i=0;i<stmts.length;i+=40)await env.DB.batch(stmts.slice(i,i+40));
}
async function refresh(env,days=7){
  const settled=await Promise.allSettled(LIVE_MARKETS.map(m=>fetchMarket(m,days,700,env)));
  const leads=[],markets={};
  let chandlerFresh=null;
  settled.forEach((r,i)=>{
    const market=LIVE_MARKETS[i];
    if(r.status==='fulfilled'){
      markets[market]={ok:true,count:r.value.length};
      if(market==='Tucson'&&r.value?._meta)markets[market].scan=r.value._meta;
      if(market==='Chandler')chandlerFresh=r.value;
      leads.push(...r.value);
    }else markets[market]={ok:false,error:String(r.reason?.message||r.reason)};
  });
  leads.sort((a,b)=>b.score-a.score||new Date(b.date)-new Date(a.date));

  // Chandler previously used DSActiveProjects while the live permit adapter was
  // being validated. Those rows can remain inside the 7-day D1 window and make
  // the public feed look like every live permit is "Not listed" even though the
  // official Accela snapshot is fully participant-enriched. Once a fresh Accela
  // pull succeeds, replace the Chandler live snapshot instead of mixing adapters.
  if(env.DB&&Array.isArray(chandlerFresh)&&chandlerFresh.length){
    await env.DB.prepare(`DELETE FROM leads WHERE market='Chandler'`).run();
  }
  await persist(env,leads);
  return {leads,markets};
}
function hydrateStoredLead(x){
  const text=[x.name,x.scope,x.company].filter(Boolean).join(' ');
  const model=opportunityScore({text,status:x.permit_status||'',date:x.event_date,officialValue:x.official_value,address:x.address,company:x.company});
  const confidence=dataConfidence({company:x.company,officialValue:x.official_value,address:x.address,permit:x.permit,status:x.permit_status,scope:x.scope,source:x.source,market:x.market});
  return {
    ...x,
    date:x.event_date,
    permitStatus:x.permit_status||'—',
    officialPermitValue:x.official_value||null,
    market:x.market||marketFromSource(x.source),
    categories:parseJson(x.categories,[]),
    score:model.score,
    temperature:model.temperature,
    scoreBreakdown:model.breakdown,
    sellerFit:model.sellerFit,
    dataConfidence:confidence,
    lifecycle:lifecycleFrom({text,status:x.permit_status||''}),
    checkedAt:x.updated_at||null
  };
}
async function stored(env,limit=120,days=7){
  if(!env.DB)return null;
  const r=await env.DB.prepare(`SELECT * FROM leads WHERE datetime(event_date) >= datetime('now', ?) ORDER BY score DESC,event_date DESC LIMIT ?`).bind(`-${days} days`,limit).all();
  return clusterLeads((r.results||[]).map(hydrateStoredLead));
}


const FEED_FRESHNESS_MINUTES=180;
const FEED_CACHE_CONTROL='public, max-age=30, s-maxage=120, stale-while-revalidate=300';

function feedJson(body,status=200,env={}){
  const response=json(body,status,env);
  response.headers.set('Cache-Control',status===200?FEED_CACHE_CONTROL:'no-store');
  response.headers.set('Vary','Origin');
  response.headers.set('X-RevenueTrigger-Read-Only','true');
  return response;
}

function feedInt(value,fallback,min,max){
  if(value===null||value===undefined||value==='')return fallback;
  const n=Number(value);
  return Number.isFinite(n)?clamp(Math.trunc(n),min,max):fallback;
}

function feedMarkets(raw){
  if(raw===null)return {ok:true,markets:[...LIVE_MARKETS],invalid:[]};
  const requested=String(raw).split(',').map(x=>x.trim()).filter(Boolean);
  if(!requested.length)return {ok:false,markets:[],invalid:['(empty)']};
  const unique=[...new Set(requested)];
  const invalid=unique.filter(x=>!LIVE_MARKETS.includes(x));
  if(invalid.length)return {ok:false,markets:[],invalid};
  return {ok:true,markets:unique,invalid:[]};
}

function feedOverallState(marketStates=[]){
  if(!marketStates.length)return 'empty';
  const states=marketStates.map(x=>x.state);
  if(states.every(x=>x==='empty'))return 'empty';
  if(states.every(x=>x==='fresh'))return 'fresh';
  if(states.every(x=>x==='stale'))return 'stale';
  return 'partial';
}

// Public output is an allowlist. Never copy a source title, identifier or free text.
function publicOpportunityTeaser(x={}){
  const categories=(Array.isArray(x.categories)?x.categories:[]).filter(c=>INDUSTRIES.includes(c)).slice(0,4);
  const trade=categories.find(c=>c!=='Commercial services');
  const stage=[x.stage,x.lifecycle?.stage,x.permitStatus,x.permit_status]
    .find(s=>['PRE-TECH','PLANNING','APPLICATION','PERMIT ISSUED','CONSTRUCTION','COMPLETE','APPROVED PROJECTS','UNDER CONSTRUCTION'].includes(s))||null;
  const titles={HVAC:'Commercial HVAC activity',Electrical:'Commercial electrical activity',Plumbing:'Commercial plumbing activity',Roofing:'Commercial roofing activity',Landscaping:'Commercial landscaping activity',Security:'Commercial security activity',Signage:'Commercial signage activity'};
  const date=x.date||x.event_date;
  return {
    id:`teaser_${crypto.randomUUID()}`,
    market:LIVE_MARKETS.includes(x.market)?x.market:'',
    name:titles[trade]||'Commercial project activity',
    date:date&&Number.isFinite(Date.parse(date))?new Date(date).toISOString():null,
    score:Number(x.score||0),
    temperature:['HOT','WARM','WATCH','LOW'].includes(x.temperature)?x.temperature:temperatureForScore(Number(x.score||0)),
    value:Number(x.value||0),
    categories,
    stage,
    publicPreview:true
  };
}

// These diagnostics can contain records or source errors with permit identifiers.
// Keep their full behavior for signed-in users and existing internal admin callers.
const PRIVATE_DIAGNOSTICS=new Set([
  '/leads','/score-audit','/temperature-calibration','/backfill-preview',
  '/historical-coverage','/relationship-gap-candidates','/relationship-candidates',
  '/relationship-health','/tempe-enrichment-preview','/attribution-health',
  '/tucson-recheck-preview','/source-health'
]);

async function readStoredFeed(env,{days=7,limit=120,markets=LIVE_MARKETS}={}){
  if(!env.DB)throw new Error('D1 binding unavailable');

  const safeDays=feedInt(days,7,1,30);
  const safeLimit=feedInt(limit,120,1,200);
  const safeMarkets=[...new Set((markets||[]).filter(x=>LIVE_MARKETS.includes(x)))];
  if(!safeMarkets.length)return {
    ok:true,state:'empty',leads:[],markets:[],
    query:{days:safeDays,limit:safeLimit,markets:[]},
    counts:{returned:0,clusteredAvailable:0,rawRowsScanned:0},
    freshness:{thresholdMinutes:FEED_FRESHNESS_MINUTES,markets:[]},
    generatedAt:nowIso()
  };

  // Read more raw rows than the requested opportunity limit so hydration and
  // clustering happen before the final response limit is applied.
  const rawScanLimit=clamp(Math.max(500,safeLimit*12),500,5000);
  const placeholders=safeMarkets.map(()=>'?').join(',');
  const window=`-${safeDays} days`;

  const rowsSql=`
    SELECT *
    FROM leads
    WHERE datetime(event_date)>=datetime('now',?)
      AND market IN (${placeholders})
    ORDER BY score DESC,event_date DESC
    LIMIT ?
  `;
  const statsSql=`
    SELECT
      market,
      COUNT(*) AS stored_count,
      MAX(updated_at) AS last_stored_at,
      MAX(event_date) AS latest_event_at,
      CAST((julianday('now')-julianday(MAX(updated_at)))*1440 AS INTEGER) AS age_minutes
    FROM leads
    WHERE datetime(event_date)>=datetime('now',?)
      AND market IN (${placeholders})
    GROUP BY market
  `;

  const rowResult=await env.DB.prepare(rowsSql).bind(window,...safeMarkets,rawScanLimit).all();
  const statsResult=await env.DB.prepare(statsSql).bind(window,...safeMarkets).all();

  const hydrated=(rowResult.results||[]).map(hydrateStoredLead);
  const clustered=clusterLeads(hydrated);
  const leads=clustered.slice(0,safeLimit);

  const statsMap=new Map((statsResult.results||[]).map(row=>[String(row.market||''),row]));
  const marketStates=safeMarkets.map(market=>{
    const row=statsMap.get(market);
    const storedCount=Number(row?.stored_count||0);
    const ageMinutes=Number.isFinite(Number(row?.age_minutes))?Math.max(0,Number(row.age_minutes)):null;
    let state='empty';
    if(storedCount>0)state=ageMinutes!==null&&ageMinutes<=FEED_FRESHNESS_MINUTES?'fresh':'stale';
    return {
      market,
      state,
      storedCount,
      lastStoredAt:row?.last_stored_at||null,
      latestEventAt:row?.latest_event_at||null,
      ageMinutes
    };
  });

  return {
    ok:true,
    state:feedOverallState(marketStates),
    leads,
    markets:safeMarkets,
    source:'RevenueTrigger stored D1 opportunity feed',
    query:{days:safeDays,limit:safeLimit,markets:safeMarkets},
    counts:{
      returned:leads.length,
      clusteredAvailable:clustered.length,
      rawRowsScanned:hydrated.length,
      rawScanLimit
    },
    freshness:{
      basis:'stored D1 updated_at only; municipal source health is not polled',
      thresholdMinutes:FEED_FRESHNESS_MINUTES,
      markets:marketStates
    },
    generatedAt:nowIso()
  };
}


async function scoringAudit(env,{days=30,limit=300}={}){
  days=clamp(Number(days||30),1,90);
  limit=clamp(Number(limit||300),25,500);

  // Use persisted production leads for established markets, but replace
  // Chandler with its validated first-party live source.
  const storedRows=(await stored(env,Math.min(500,limit*2),days))||[];
  let chandler=[];
  try{chandler=clusterLeads(await fetchChandlerAccelaPermits(Math.min(days,30),500));}catch{}
  const combined=[...storedRows.filter(x=>(x.market||'')!=='Chandler'),...chandler]
    .sort((a,b)=>(Number(b.score||0)-Number(a.score||0))||(new Date(b.date)-new Date(a.date)))
    .slice(0,limit);

  const keys=['projectStage','recency','projectValue','tradeRelevance','projectType','prePermit','companyBehavior'];
  const componentTotals=Object.fromEntries(keys.map(k=>[k,0]));
  const buckets={HOT:0,WARM:0,WATCH:0,LOW:0};
  const quality={missingCompany:0,missingOfficialValue:0,missingAddress:0,missingPermit:0,lowDataConfidence:0};
  const markets={};

  const candidateBuckets={HOT:0,WARM:0,WATCH:0,LOW:0};
  const candidateMarkets={};
  const confidenceBuckets={HIGH:0,MEDIUM:0,LOW:0};
  const movements={scoreUp:0,scoreDown:0,scoreSame:0,temperatureUp:0,temperatureDown:0,temperatureSame:0,missingDateRecords:0,lifecycleCapRecords:0,totalDelta:0};
  const movementRows=[];
  const tempRank={LOW:0,WATCH:1,WARM:2,HOT:3};

  for(const x of combined){
    const market=x.market||marketFromSource(x.source)||'Unknown';
    if(!markets[market])markets[market]={count:0,scoreTotal:0,minScore:101,maxScore:-1,HOT:0,WARM:0,WATCH:0,LOW:0};
    const m=markets[market],score=Number(x.score||0),temp=x.temperature||temperatureForScore(score);
    m.count++;m.scoreTotal+=score;m.minScore=Math.min(m.minScore,score);m.maxScore=Math.max(m.maxScore,score);m[temp]=(m[temp]||0)+1;
    buckets[temp]=(buckets[temp]||0)+1;
    for(const k of keys)componentTotals[k]+=Number(x.scoreBreakdown?.[k]||0);
    if(!cleanCompanyName(x.company))quality.missingCompany++;
    if(!(Number(x.officialPermitValue)>0))quality.missingOfficialValue++;
    if(!String(x.address||'').trim())quality.missingAddress++;
    if(!String(x.permit||'').trim()||String(x.permit)==='—')quality.missingPermit++;
    if(Number(x.dataConfidence?.score||0)<60)quality.lowDataConfidence++;

    const text=[x.name,x.scope,x.company].filter(Boolean).join(' ');
    const cand=opportunityScoreCandidate({text,status:x.permitStatus||x.permit_status||'',date:x.date||x.event_date||null,officialValue:x.officialPermitValue??x.official_value,address:x.address,company:x.company});
    const conf=dataConfidenceCandidate({company:x.company,officialValue:x.officialPermitValue??x.official_value,address:x.address,permit:x.permit,status:x.permitStatus||x.permit_status,scope:x.scope,source:x.source,date:x.date||x.event_date||null});
    candidateBuckets[cand.temperature]=(candidateBuckets[cand.temperature]||0)+1;
    if(!candidateMarkets[market])candidateMarkets[market]={count:0,scoreTotal:0,minScore:101,maxScore:-1,HOT:0,WARM:0,WATCH:0,LOW:0};
    const cm=candidateMarkets[market];
    cm.count++;cm.scoreTotal+=cand.score;cm.minScore=Math.min(cm.minScore,cand.score);cm.maxScore=Math.max(cm.maxScore,cand.score);cm[cand.temperature]=(cm[cand.temperature]||0)+1;
    if(conf.score>=80)confidenceBuckets.HIGH++; else if(conf.score>=60)confidenceBuckets.MEDIUM++; else confidenceBuckets.LOW++;

    const delta=cand.score-score;
    movements.totalDelta+=delta;
    if(delta>0)movements.scoreUp++; else if(delta<0)movements.scoreDown++; else movements.scoreSame++;
    if((tempRank[cand.temperature]||0)>(tempRank[temp]||0))movements.temperatureUp++;
    else if((tempRank[cand.temperature]||0)<(tempRank[temp]||0))movements.temperatureDown++;
    else movements.temperatureSame++;
    if(!cand.diagnostics.hasValidDate)movements.missingDateRecords++;
    if(cand.diagnostics.lifecycleCapApplied>0)movements.lifecycleCapRecords++;
    movementRows.push({market,name:x.name,currentScore:score,currentTemperature:temp,candidateScore:cand.score,candidateTemperature:cand.temperature,delta,candidateBreakdown:cand.breakdown,candidateConfidence:conf.score,diagnostics:cand.diagnostics});
  }

  for(const group of [markets,candidateMarkets])for(const m of Object.values(group)){
    m.avgScore=m.count?Number((m.scoreTotal/m.count).toFixed(1)):0;
    delete m.scoreTotal;
    if(m.minScore===101)m.minScore=0;
    if(m.maxScore===-1)m.maxScore=0;
  }
  const n=combined.length||1;
  const componentAverages=Object.fromEntries(keys.map(k=>[k,Number((componentTotals[k]/n).toFixed(2))]));
  const maxWeights={projectStage:25,recency:20,projectValue:15,tradeRelevance:15,projectType:10,prePermit:10,companyBehavior:2};
  const maxPossible=Object.values(maxWeights).reduce((a,b)=>a+b,0);

  const missingDateProbe=opportunityScore({text:'commercial project',status:'PRE-TECH',date:null,officialValue:null,address:'',company:''});
  const issuedProbe=opportunityScore({text:'commercial project',status:'issued',date:Date.now(),officialValue:null,address:'',company:''});
  const preTechProbe=opportunityScore({text:'commercial project',status:'PRE-TECH',date:Date.now(),officialValue:null,address:'',company:''});
  const candidateMissingDateProbe=opportunityScoreCandidate({text:'commercial project',status:'PRE-TECH',date:null,officialValue:null,address:'',company:''});
  const candidateIssuedProbe=opportunityScoreCandidate({text:'commercial project',status:'issued',date:Date.now(),officialValue:null,address:'',company:''});
  const candidatePreTechProbe=opportunityScoreCandidate({text:'commercial project',status:'PRE-TECH',date:Date.now(),officialValue:null,address:'',company:''});

  const biggestDrops=[...movementRows].sort((a,b)=>a.delta-b.delta).slice(0,8);
  const biggestRaises=[...movementRows].sort((a,b)=>b.delta-a.delta).slice(0,8);
  movements.avgDelta=Number((movements.totalDelta/n).toFixed(2));
  delete movements.totalDelta;

  return {
    sample:{days,requestedLimit:limit,count:combined.length,sourceMode:'D1 production leads for established markets + live City of Chandler Accela records'},
    production:{scoreBuckets:buckets,byMarket:markets,componentAverages,quality},
    scorerChecks:{
      maxWeights,maxPossible,configuredTemperatureThresholds:{HOT:75,WARM:60,WATCH:40},
      missingDateProbe:{score:missingDateProbe.score,recencyPoints:missingDateProbe.breakdown.recency,note:'Production currently awards a null date full recency.'},
      stageOverlapProbe:{preTech:{score:preTechProbe.score,projectStage:preTechProbe.breakdown.projectStage,prePermit:preTechProbe.breakdown.prePermit},issued:{score:issuedProbe.score,projectStage:issuedProbe.breakdown.projectStage,prePermit:issuedProbe.breakdown.prePermit}}
    },
    candidateV110:{
      productionUnchanged:true,
      changes:['Missing/invalid dates receive 0 recency points','PRE-TECH lifecycle + pre-permit contribution capped at 30 total points','Existing project value, trade relevance, project type, company context, and temperature thresholds preserved'],
      maxPossible:92,
      scoreBuckets:candidateBuckets,
      byMarket:candidateMarkets,
      confidenceBuckets,
      movement:movements,
      probes:{
        missingDate:{score:candidateMissingDateProbe.score,recencyPoints:candidateMissingDateProbe.breakdown.recency},
        preTech:{score:candidatePreTechProbe.score,projectStage:candidatePreTechProbe.breakdown.projectStage,prePermit:candidatePreTechProbe.breakdown.prePermit,rawPrePermit:candidatePreTechProbe.diagnostics.prePermitRaw},
        issued:{score:candidateIssuedProbe.score,projectStage:candidateIssuedProbe.breakdown.projectStage,prePermit:candidateIssuedProbe.breakdown.prePermit}
      },
      biggestDrops,
      biggestRaises
    },
    examples:{
      highest:combined.slice(0,8).map(x=>({market:x.market,name:x.name,score:x.score,temperature:x.temperature,breakdown:x.scoreBreakdown,dataConfidence:x.dataConfidence?.score??null})),
      lowest:[...combined].sort((a,b)=>Number(a.score||0)-Number(b.score||0)).slice(0,8).map(x=>({market:x.market,name:x.name,score:x.score,temperature:x.temperature,breakdown:x.scoreBreakdown,dataConfidence:x.dataConfidence?.score??null}))
    },
    generatedAt:nowIso()
  };
}

function bytesToHex(buf){return [...new Uint8Array(buf)].map(b=>b.toString(16).padStart(2,'0')).join('');}
function bytesToB64Url(bytes){let s='';for(const b of bytes)s+=String.fromCharCode(b);return btoa(s).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');}
function randomToken(size=32){const a=new Uint8Array(size);crypto.getRandomValues(a);return bytesToB64Url(a);}
async function sha256Hex(s){return bytesToHex(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(s)));}
async function hmacHex(secret,message){const key=await crypto.subtle.importKey('raw',new TextEncoder().encode(secret),{name:'HMAC',hash:'SHA-256'},false,['sign']);return bytesToHex(await crypto.subtle.sign('HMAC',key,new TextEncoder().encode(message)));}
function secureEqual(a,b){if(!a||!b||a.length!==b.length)return false;let r=0;for(let i=0;i<a.length;i++)r|=a.charCodeAt(i)^b.charCodeAt(i);return r===0;}

async function ensureUser(env,email){
  const clean=normalizeEmail(email); if(!validEmail(clean))throw new Error('valid email required');
  let user=await env.DB.prepare('SELECT * FROM users WHERE email=?').bind(clean).first();
  if(!user){const id=`u_${crypto.randomUUID()}`;await env.DB.prepare(`INSERT INTO users (id,email,plan,subscription_status,created_at,updated_at) VALUES (?,?,'Beta','inactive',datetime('now'),datetime('now'))`).bind(id,clean).run();await env.DB.prepare('INSERT OR IGNORE INTO preferences (user_id) VALUES (?)').bind(id).run();user=await env.DB.prepare('SELECT * FROM users WHERE id=?').bind(id).first();}
  return user;
}
async function authUser(request,env){
  const raw=(request.headers.get('authorization')||'').replace(/^Bearer\s+/i,'').trim();
  if(!raw)return null;
  const hash=await sha256Hex(raw);
  const row=await env.DB.prepare(`SELECT u.* FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.token_hash=? AND datetime(s.expires_at)>datetime('now')`).bind(hash).first();
  if(row)env.DB.prepare(`UPDATE sessions SET last_seen_at=datetime('now') WHERE token_hash=?`).bind(hash).run().catch(()=>{});
  return row||null;
}
async function publicUser(env,user){
  if(!user)return null;
  const p=await env.DB.prepare('SELECT * FROM preferences WHERE user_id=?').bind(user.id).first();
  const saved=await env.DB.prepare('SELECT COUNT(*) AS n FROM saved_leads WHERE user_id=?').bind(user.id).first();
  return {id:user.id,email:user.email,plan:safePlan(user.plan),subscriptionStatus:user.subscription_status||'inactive',savedCount:Number(saved?.n||0),onboardingComplete:Boolean(p?.updated_at),preferences:{industries:parseJson(p?.industries,['Commercial services']),markets:cleanMarkets(parseJson(p?.markets,['Phoenix']),PLANS[safePlan(user.plan)].marketLimit),minScore:Number(p?.min_score||70),alertFrequency:p?.alert_frequency||'none'},entitlements:PLANS[safePlan(user.plan)]};
}

async function sendEmail(env,{to,subject,html}){
  if(!env.RESEND_API_KEY||!env.EMAIL_FROM)return {ok:false,skipped:'email not configured'};
  const r=await fetch('https://api.resend.com/emails',{method:'POST',headers:{Authorization:`Bearer ${env.RESEND_API_KEY}`,'Content-Type':'application/json'},body:JSON.stringify({from:env.EMAIL_FROM,to:[to],subject,html})});
  const data=await r.json().catch(()=>({})); if(!r.ok)throw new Error(data.message||`Email API ${r.status}`); return {ok:true,id:data.id};
}
async function requestMagicLink(request,env){
  const {email}=await request.json();const clean=normalizeEmail(email);if(!validEmail(clean))return json({error:'valid email required'},400,env);
  const recent=await env.DB.prepare(`SELECT COUNT(*) AS n FROM auth_tokens WHERE email=? AND datetime(created_at)>datetime('now','-10 minutes')`).bind(clean).first();
  if(Number(recent?.n||0)>=5)return json({error:'too many sign-in requests; try again shortly'},429,env);
  await ensureUser(env,clean);
  const token=randomToken(32),hash=await sha256Hex(token);
  await env.DB.prepare(`INSERT INTO auth_tokens (token_hash,email,expires_at,created_at) VALUES (?,?,datetime('now','+15 minutes'),datetime('now'))`).bind(hash,clean).run();
  const link=`${String(env.FRONTEND_URL||env.ALLOWED_ORIGIN||'').replace(/\/$/,'')}/#magic=${encodeURIComponent(token)}`;
  const mail=await sendEmail(env,{to:clean,subject:'Your RevenueTrigger sign-in link',html:`<div style="font-family:Arial,sans-serif;max-width:560px;margin:auto"><h2>Sign in to RevenueTrigger</h2><p>Your secure sign-in link is valid for 15 minutes.</p><p><a href="${htmlEsc(link)}" style="display:inline-block;background:#b6ff62;color:#07110d;text-decoration:none;padding:12px 18px;border-radius:10px;font-weight:700">Open RevenueTrigger</a></p><p style="color:#667">If you did not request this, ignore this email.</p></div>`}).catch(e=>({ok:false,error:e.message}));
  if(mail.ok)return json({ok:true,message:'Check your email for the sign-in link.'},200,env);
  if(String(env.DEV_AUTH_BYPASS).toLowerCase()==='true')return json({ok:true,dev:true,magicLink:link,message:'DEV_AUTH_BYPASS is enabled.'},200,env);
  return json({error:'email delivery is not configured yet',detail:mail.error||mail.skipped||'Configure RESEND_API_KEY and EMAIL_FROM.'},503,env);
}
async function verifyMagicLink(request,env){
  const {token}=await request.json();if(!token)return json({error:'token required'},400,env);
  const hash=await sha256Hex(token);
  const row=await env.DB.prepare(`SELECT * FROM auth_tokens WHERE token_hash=? AND used_at IS NULL AND datetime(expires_at)>datetime('now')`).bind(hash).first();
  if(!row)return json({error:'link expired or already used'},401,env);
  const user=await ensureUser(env,row.email);
  await env.DB.prepare(`UPDATE auth_tokens SET used_at=datetime('now') WHERE token_hash=?`).bind(hash).run();
  const session=randomToken(32),sessionHash=await sha256Hex(session);
  await env.DB.prepare(`INSERT INTO sessions (token_hash,user_id,expires_at,created_at,last_seen_at) VALUES (?,?,datetime('now','+30 days'),datetime('now'),datetime('now'))`).bind(sessionHash,user.id).run();
  return json({ok:true,session,user:await publicUser(env,user)},200,env);
}

function stripePrice(env,plan){return plan==='Scout'?env.STRIPE_PRICE_SCOUT:plan==='Hunter'?env.STRIPE_PRICE_HUNTER:plan==='Territory'?env.STRIPE_PRICE_TERRITORY:null;}
function stripePlanFromPrice(env,priceId){
  if(!priceId)return null;
  if(priceId===env.STRIPE_PRICE_SCOUT)return 'Scout';
  if(priceId===env.STRIPE_PRICE_HUNTER)return 'Hunter';
  if(priceId===env.STRIPE_PRICE_TERRITORY)return 'Territory';
  return null;
}
function stripePlanFromSubscription(env,sub){
  const items=sub?.items?.data||[];
  for(const item of items){
    const priceId=item?.price?.id||item?.price;
    const plan=stripePlanFromPrice(env,priceId);
    if(plan)return plan;
  }
  const metaPlan=sub?.metadata?.plan;
  return ['Scout','Hunter','Territory'].includes(metaPlan)?metaPlan:null;
}
async function stripeGet(env,path){
  if(!env.STRIPE_SECRET_KEY)throw new Error('Stripe is not configured');
  const r=await fetch(`https://api.stripe.com/v1/${path}`,{
    headers:{Authorization:`Bearer ${env.STRIPE_SECRET_KEY}`}
  });
  const data=await r.json().catch(()=>({}));
  if(!r.ok)throw new Error(data?.error?.message||`Stripe ${r.status}`);
  return data;
}
async function syncUserBillingFromStripe(env,user){
  if(!user?.stripe_subscription_id)return user;
  const sub=await stripeGet(env,`subscriptions/${encodeURIComponent(user.stripe_subscription_id)}`);
  const plan=stripePlanFromSubscription(env,sub)||safePlan(user.plan);
  await env.DB.prepare(`
    UPDATE users
    SET plan=?,
        stripe_customer_id=COALESCE(?,stripe_customer_id),
        stripe_subscription_id=?,
        subscription_status=?,
        updated_at=datetime('now')
    WHERE id=?
  `).bind(plan,sub.customer||null,sub.id,sub.status||'active',user.id).run();
  return await env.DB.prepare('SELECT * FROM users WHERE id=?').bind(user.id).first();
}

async function stripePost(env,path,params){
  if(!env.STRIPE_SECRET_KEY)throw new Error('Stripe is not configured');
  const body=new URLSearchParams();Object.entries(params).forEach(([k,v])=>{if(v!==undefined&&v!==null&&v!=='')body.append(k,String(v));});
  const r=await fetch(`https://api.stripe.com/v1/${path}`,{method:'POST',headers:{Authorization:`Bearer ${env.STRIPE_SECRET_KEY}`,'Content-Type':'application/x-www-form-urlencoded'},body});
  const data=await r.json().catch(()=>({}));if(!r.ok)throw new Error(data?.error?.message||`Stripe ${r.status}`);return data;
}
async function createCheckout(request,env,user){
  if(env.BILLING_CHECKOUT_DISABLED==='true')return json({error:'checkout_disabled'},403,env);
  const {plan}=await request.json();if(!['Scout','Hunter','Territory'].includes(plan))return json({error:'invalid plan'},400,env);
  const price=stripePrice(env,plan);if(!price||String(price).includes('REPLACE_'))return json({error:`Stripe price for ${plan} is not configured`},503,env);
  const frontend=String(env.FRONTEND_URL||env.ALLOWED_ORIGIN||'').replace(/\/$/,'');
  const params={mode:'subscription','line_items[0][price]':price,'line_items[0][quantity]':1,success_url:`${frontend}/?billing=success`,cancel_url:`${frontend}/?billing=cancel`,client_reference_id:user.id,'metadata[user_id]':user.id,'metadata[plan]':plan,'subscription_data[metadata][user_id]':user.id,'subscription_data[metadata][plan]':plan,allow_promotion_codes:'true'};
  if(user.stripe_customer_id)params.customer=user.stripe_customer_id;else params.customer_email=user.email;
  const s=await stripePost(env,'checkout/sessions',params);return json({ok:true,url:s.url},200,env);
}
async function createPortal(env,user){
  if(!user.stripe_customer_id)return json({error:'no Stripe customer yet'},400,env);
  const frontend=String(env.FRONTEND_URL||env.ALLOWED_ORIGIN||'').replace(/\/$/,'');
  const p=await stripePost(env,'billing_portal/sessions',{customer:user.stripe_customer_id,return_url:frontend});return json({ok:true,url:p.url},200,env);
}
async function verifyStripeSignature(raw,header,secret){
  if(!header||!secret)return false;
  const parts=header.split(',');let t='';const sigs=[];for(const p of parts){const [k,v]=p.split('=');if(k==='t')t=v;if(k==='v1')sigs.push(v);}if(!t||!sigs.length)return false;
  if(Math.abs(Math.floor(Date.now()/1000)-Number(t))>300)return false;
  const expected=await hmacHex(secret,`${t}.${raw}`);return sigs.some(s=>secureEqual(s,expected));
}
async function handleStripeWebhook(request,env){
  const raw=await request.text();const ok=await verifyStripeSignature(raw,request.headers.get('stripe-signature'),env.STRIPE_WEBHOOK_SECRET);if(!ok)return new Response('invalid signature',{status:400});
  const evt=JSON.parse(raw);const seen=await env.DB.prepare('SELECT event_id FROM billing_events WHERE event_id=?').bind(evt.id).first();if(seen)return new Response('ok');
  const o=evt.data?.object||{};
  if(evt.type==='checkout.session.completed'){
    const uid=o.metadata?.user_id||o.client_reference_id,plan=safePlan(o.metadata?.plan);if(uid){await env.DB.prepare(`UPDATE users SET plan=?,stripe_customer_id=COALESCE(?,stripe_customer_id),stripe_subscription_id=COALESCE(?,stripe_subscription_id),subscription_status='active',updated_at=datetime('now') WHERE id=?`).bind(plan,o.customer||null,o.subscription||null,uid).run();}
  }
  if(evt.type==='customer.subscription.updated'){
    const uid=o.metadata?.user_id;
    const plan=stripePlanFromSubscription(env,o)||(['Scout','Hunter','Territory'].includes(o.metadata?.plan)?o.metadata.plan:null);
    if(uid){
      await env.DB.prepare(`UPDATE users SET plan=COALESCE(?,plan),stripe_customer_id=COALESCE(?,stripe_customer_id),stripe_subscription_id=?,subscription_status=?,updated_at=datetime('now') WHERE id=?`).bind(plan,o.customer||null,o.id,o.status||'active',uid).run();
    }else{
      await env.DB.prepare(`UPDATE users SET plan=COALESCE(?,plan),subscription_status=?,updated_at=datetime('now') WHERE stripe_subscription_id=?`).bind(plan,o.status||'active',o.id).run();
    }
  }
  if(evt.type==='customer.subscription.deleted'){
    await env.DB.prepare(`UPDATE users SET plan='Beta',subscription_status='canceled',updated_at=datetime('now') WHERE stripe_subscription_id=? OR stripe_customer_id=?`).bind(o.id,o.customer||'').run();
  }
  if(evt.type==='invoice.payment_failed'&&o.customer){await env.DB.prepare(`UPDATE users SET subscription_status='past_due',updated_at=datetime('now') WHERE stripe_customer_id=?`).bind(o.customer).run();}
  await env.DB.prepare(`INSERT INTO billing_events (event_id,type,processed_at) VALUES (?,?,datetime('now'))`).bind(evt.id,evt.type).run();return new Response('ok');
}

function marketFromSource(source=''){const s=String(source);if(s.includes('Tempe'))return 'Tempe';if(s.includes('Tucson'))return 'Tucson';if(s.includes('Scottsdale'))return 'Scottsdale';if(s.includes('Mesa'))return 'Mesa';if(s.includes('Chandler'))return 'Chandler';if(s.includes('Fort Worth')||s.includes('fort_worth'))return 'Fort Worth';if(s.includes('Dallas')||s.includes('dallas_dallasnow'))return 'Dallas';return 'Phoenix';}
function cleanMarkets(items,limit){const out=[];for(const x of Array.isArray(items)?items:[]){if(MARKETS.includes(x)&&!out.includes(x))out.push(x);if(out.length>=limit)break;}return out.length?out:['Phoenix'];}
function userPlanActive(user){return ['active','trialing'].includes(user.subscription_status||'')&&PLANS[user.plan] ? user.plan : 'Beta';}
function cleanIndustries(items,limit){const out=[];for(const x of Array.isArray(items)?items:[]){if(INDUSTRIES.includes(x)&&!out.includes(x))out.push(x);if(out.length>=limit)break;}return out.length?out:['Commercial services'];}
async function listLeadsForUser(env,user,{limit,days}={}){
  const effective=userPlanActive(user),ent=PLANS[effective],p=await env.DB.prepare('SELECT * FROM preferences WHERE user_id=?').bind(user.id).first();
  const history=clamp(Number(days||ent.historyDays),1,ent.historyDays),max=clamp(Number(limit||120),1,effective==='Territory'?500:effective==='Hunter'?250:80);
  const min=Number(p?.min_score||70),industries=cleanIndustries(parseJson(p?.industries,['Commercial services']),ent.industryLimit),markets=cleanMarkets(parseJson(p?.markets,['Phoenix']),ent.marketLimit);
  const all=await stored(env,max*5,history)||[];const filtered=all.filter(x=>x.score>=min&&markets.includes(x.market||marketFromSource(x.source))&&x.categories?.some(c=>industries.includes(c))).slice(0,max);
  const savedRows=await env.DB.prepare('SELECT lead_id FROM saved_leads WHERE user_id=?').bind(user.id).all();const saved=new Set((savedRows.results||[]).map(x=>String(x.lead_id)));
  return {leads:filtered.map(x=>({...x,saved:saved.has(String(x.id))})),plan:effective,entitlements:ent,preferences:{industries,minScore:min,markets,alertFrequency:p?.alert_frequency||ent.alert}};
}
async function exportCsv(env,user){
  const effective=userPlanActive(user);if(!PLANS[effective].export)return json({error:'CSV export requires Hunter or Territory'},403,env);
  const {leads}=await listLeadsForUser(env,user,{limit:500});const q=v=>`"${String(v??'').replace(/"/g,'""')}"`;const lines=[['score','date','event','address','company','permit','categories','estimated_opportunity','source'].join(',')];
  for(const x of leads)lines.push([x.score,new Date(x.date).toISOString(),x.name,x.address,x.company,x.permit,(x.categories||[]).join('|'),x.value,x.source].map(q).join(','));
  return new Response(lines.join('\n'),{status:200,headers:{'content-type':'text/csv;charset=utf-8','content-disposition':'attachment; filename="revenuetrigger-leads.csv"',...cors(env)}});
}

function alertRuleForPlan(plan,scheduledDate=new Date()){
  const hour=scheduledDate.getUTCHours();
  const day=scheduledDate.getUTCDay();

  if(plan==='Territory')return {eligible:true,windowHours:2,label:'instant alert'};
  if(plan==='Hunter')return {eligible:hour===15,windowHours:26,label:'daily digest'};
  if(plan==='Scout')return {eligible:hour===15&&day===1,windowHours:24*8,label:'weekly digest'};
  return {eligible:false,windowHours:0,label:'none'};
}

async function alertCandidates(env,user,{scheduledDate=new Date(),forcePlan=null,ignoreSchedule=false,limit=20}={}){
  const effective=forcePlan&&PLANS[forcePlan]?forcePlan:userPlanActive(user);
  const ent=PLANS[effective]||PLANS.Beta;
  const p=await env.DB.prepare('SELECT * FROM preferences WHERE user_id=?').bind(user.id).first();
  const prefs={
    industries:cleanIndustries(parseJson(p?.industries,['Commercial services']),ent.industryLimit),
    markets:cleanMarkets(parseJson(p?.markets,['Phoenix']),ent.marketLimit),
    minScore:Number(p?.min_score||70)
  };

  const rule=alertRuleForPlan(effective,scheduledDate);
  if(!ignoreSchedule&&!rule.eligible)return {effective,prefs,rule,leads:[],skipped:'outside delivery window'};

  const windowHours=rule.windowHours || (effective==='Scout'?24*8:effective==='Hunter'?26:2);
  const label=rule.label || (effective==='Scout'?'weekly digest':effective==='Hunter'?'daily digest':'instant alert');

  // Pull a wider candidate pool before applying user market/industry filters.
  // This prevents a user from receiving zero alerts just because the global top 20
  // records happened to be outside their selected markets or industries.
  const r=await env.DB.prepare(`
    SELECT l.*
    FROM leads l
    LEFT JOIN alert_log a
      ON a.user_id=?
     AND a.lead_id=l.id
     AND a.channel=?
    WHERE a.lead_id IS NULL
      AND datetime(l.event_date)>=datetime('now',?)
      AND l.score>=?
    ORDER BY l.score DESC,l.event_date DESC
    LIMIT 200
  `).bind(user.id,label,`-${windowHours} hours`,prefs.minScore).all();

  const leads=(r.results||[])
    .map(hydrateStoredLead)
    .filter(x=>
      prefs.markets.includes(x.market||marketFromSource(x.source)) &&
      (x.categories||[]).some(c=>prefs.industries.includes(c))
    )
    .slice(0,limit);

  return {effective,prefs,rule:{...rule,windowHours,label},leads};
}

async function sendAlertBatch(env,user,prefs,leads,label,{toOverride=null,markSent=true}={}){
  if(!leads.length)return {sent:0};

  const rows=leads.slice(0,8).map(x=>`
    <tr>
      <td style="padding:14px 10px;border-bottom:1px solid #173222">
        <div style="font-weight:800;color:#f4faf6">${htmlEsc(x.name)}</div>
        <div style="color:#91a59a;font-size:12px;margin-top:4px">${htmlEsc(x.address)} • Score ${x.score} • ${htmlEsc(x.temperature||'')}</div>
      </td>
      <td style="padding:14px 10px;border-bottom:1px solid #173222;color:#b7c8bf;font-size:12px">${htmlEsc((x.categories||[]).join(', '))}</td>
      <td style="padding:14px 10px;border-bottom:1px solid #173222;color:#d9b45f;font-weight:800;text-align:right">$${Number(x.value||0).toLocaleString('en-US')}</td>
    </tr>`).join('');

  const destination=toOverride||user.email;
  const dashboard=`${env.FRONTEND_URL||env.ALLOWED_ORIGIN||''}#signals`;

  const mail=await sendEmail(env,{
    to:destination,
    subject:`RevenueTrigger ${label}: ${leads.length} opportunity${leads.length===1?'':'ies'}`,
    html:`<div style="font-family:Arial,sans-serif;background:#021008;padding:28px;color:#eef7f1">
      <div style="max-width:760px;margin:auto;background:#06160e;border:1px solid #214831;border-radius:18px;overflow:hidden">
        <div style="padding:24px 26px;border-bottom:1px solid #173222">
          <div style="color:#2aee61;font-size:12px;font-weight:800;letter-spacing:.16em;text-transform:uppercase">RevenueTrigger</div>
          <h2 style="margin:8px 0 4px;color:#fff">${htmlEsc(label)}</h2>
          <p style="margin:0;color:#91a59a">New money events matching ${htmlEsc((prefs.industries||[]).join(', '))} in ${htmlEsc((prefs.markets||[]).join(', '))}.</p>
        </div>
        <div style="padding:4px 18px 10px">
          <table style="width:100%;border-collapse:collapse">${rows}</table>
        </div>
        <div style="padding:22px 26px">
          <a href="${htmlEsc(dashboard)}" style="display:inline-block;background:#2aee61;color:#031008;text-decoration:none;padding:12px 18px;border-radius:10px;font-weight:900">Open RevenueTrigger</a>
          <p style="color:#71857a;font-size:11px;line-height:1.5;margin:18px 0 0">Opportunity values are directional RevenueTrigger estimates, not official permit valuations or guaranteed spend.</p>
        </div>
      </div>
    </div>`
  });

  if(!mail?.ok)return {sent:0,email:mail};

  if(markSent){
    const stmts=leads.map(x=>env.DB.prepare(`
      INSERT OR IGNORE INTO alert_log (user_id,lead_id,channel,sent_at)
      VALUES (?,?,?,datetime('now'))
    `).bind(user.id,String(x.id),label));
    for(let i=0;i<stmts.length;i+=40)await env.DB.batch(stmts.slice(i,i+40));
  }

  return {sent:leads.length,email:mail};
}

async function runAlerts(env,scheduledDate=new Date()){
  if(!env.RESEND_API_KEY||!env.EMAIL_FROM)return {sent:0,skipped:'email not configured'};

  const users=(await env.DB.prepare(`
    SELECT * FROM users
    WHERE subscription_status IN ('active','trialing')
      AND plan IN ('Scout','Hunter','Territory')
  `).all()).results||[];

  let sent=0,emails=0;
  const detail=[];

  for(const user of users){
    const pack=await alertCandidates(env,user,{scheduledDate,limit:20});
    if(pack.skipped){
      detail.push({email:user.email,plan:pack.effective,skipped:pack.skipped});
      continue;
    }
    if(!pack.leads.length){
      detail.push({email:user.email,plan:pack.effective,label:pack.rule.label,matches:0});
      continue;
    }

    const result=await sendAlertBatch(env,user,pack.prefs,pack.leads,pack.rule.label);
    sent+=result.sent||0;
    if(result.sent)emails++;
    detail.push({email:user.email,plan:pack.effective,label:pack.rule.label,matches:pack.leads.length,sent:result.sent||0});
  }

  return {sent,emails,users:users.length,detail};
}


function canonicalCompanyName(v=''){
  let s=String(v||'').toUpperCase().replace(/[.,]/g,' ').replace(/\s+/g,' ').trim();
  s=s.replace(/\bL L C\b/g,'LLC').replace(/\bINCORPORATED\b/g,'INC').replace(/\bCORPORATION\b/g,'CORP');
  s=s.replace(/\s+(LLC|INC|CORP|CO|LTD)\s*$/,' $1').trim();
  return s;
}
function rocTradeTags(licenses=[]){
  const text=licenses.map(x=>`${x.class_code||''} ${x.class_detail||''} ${x.class_type||''}`).join(' ').toLowerCase();
  const tags=[];
  const rules=[
    ['HVAC',/\bhvac\b|air conditioning|refrigeration|warm air heating/],
    ['Electrical',/\belectrical\b|electric wiring/],
    ['Plumbing',/\bplumbing\b/],
    ['Roofing',/\broofing\b/],
    ['Landscaping',/\blandscap/],
    ['Fire protection',/fire protection|fire sprinkler/],
    ['Signs',/\bsign\b/],
    ['General contractor',/general commercial|general dual|general residential|building contractor/],
    ['Concrete',/\bconcrete\b/],
    ['Excavation',/excavat|grading|earthwork/],
    ['Pools',/\bpool\b|spa/],
    ['Solar',/\bsolar\b/]
  ];
  for(const [label,re] of rules)if(re.test(text))tags.push(label);
  return tags;
}

async function rocRosterMeta(env){
  try{
    return await env.DB.prepare(`SELECT active_batch,source_as_of,record_count,source_file,imported_at FROM roc_import_meta WHERE id=1`).first();
  }catch(e){return null}
}

async function rocMatchesForCompany(env,company,limit=8){
  const canonical=canonicalCompanyName(company);
  if(!canonical)return {verified:false,matchConfidence:null,licenses:[],trades:[],meta:null};
  try{
    const meta=await rocRosterMeta(env);
    if(!meta?.active_batch)return {verified:false,matchConfidence:null,licenses:[],trades:[],meta};
    const rows=(await env.DB.prepare(`
      SELECT license_no,business_name,dba,class_code,class_detail,class_type,address,city,state,zip,
             qualifying_party,issued_date,expiration_date,status,source_as_of,canonical_name,canonical_dba
      FROM roc_licenses
      WHERE import_batch=?
        AND (canonical_name=? OR canonical_dba=?)
      ORDER BY CASE WHEN LOWER(status)='active' THEN 0 ELSE 1 END,
               expiration_date DESC,
               license_no ASC
      LIMIT ?
    `).bind(meta.active_batch,canonical,canonical,limit).all()).results||[];

    let confidence=null;
    if(rows.some(x=>x.canonical_name===canonical))confidence=99;
    else if(rows.some(x=>x.canonical_dba===canonical))confidence=96;

    return {
      verified:rows.length>0,
      matchConfidence:confidence,
      licenseCount:rows.length,
      licenses:rows.map(({canonical_name,canonical_dba,...x})=>x),
      trades:rocTradeTags(rows),
      meta
    };
  }catch(e){
    return {verified:false,matchConfidence:null,licenses:[],trades:[],meta:null,error:'ROC roster unavailable'};
  }
}

async function rocSearch(env,{q='',city='',classCode='',status='',limit=50}={}){
  const meta=await rocRosterMeta(env);
  if(!meta?.active_batch)return {meta,results:[]};
  const where=['import_batch=?'],binds=[meta.active_batch];
  q=String(q||'').trim();city=String(city||'').trim();classCode=String(classCode||'').trim();status=String(status||'').trim();
  if(q){
    const cq=canonicalCompanyName(q);
    where.push(`(canonical_name LIKE ? OR canonical_dba LIKE ? OR license_no LIKE ?)`);
    binds.push(`%${cq}%`,`%${cq}%`,`%${q.replace(/\D/g,'')}%`);
  }
  if(city){where.push(`LOWER(city)=LOWER(?)`);binds.push(city)}
  if(classCode){where.push(`UPPER(class_code)=UPPER(?)`);binds.push(classCode)}
  if(status){where.push(`LOWER(status)=LOWER(?)`);binds.push(status)}
  const rows=(await env.DB.prepare(`
    SELECT license_no,business_name,dba,class_code,class_detail,class_type,address,city,state,zip,
           qualifying_party,issued_date,expiration_date,status,source_as_of
    FROM roc_licenses
    WHERE ${where.join(' AND ')}
    ORDER BY CASE WHEN LOWER(status)='active' THEN 0 ELSE 1 END,business_name
    LIMIT ?
  `).bind(...binds,Math.max(1,Math.min(100,Number(limit)||50))).all()).results||[];
  return {meta,results:rows};
}

function classifyProjectType(text=''){
  const t=String(text||'').toLowerCase();
  if(/\brestaurant|food service|kitchen\b/.test(t))return 'Restaurant';
  if(/\bretail|store|shop\b/.test(t))return 'Retail';
  if(/\bmedical|clinic|hospital|dental\b/.test(t))return 'Medical';
  if(/\bmultifamily|apartment|condo\b/.test(t))return 'Multifamily';
  if(/\bindustrial|warehouse|manufactur/.test(t))return 'Industrial';
  if(/\boffice\b/.test(t))return 'Office';
  if(/\btenant improvement|\bti\b|remodel|renovation|build.?out\b/.test(t))return 'Commercial Remodel';
  return 'Other';
}
function pctChange(current,prior){
  current=Number(current||0);prior=Number(prior||0);
  if(prior<=0)return current>0?100:0;
  return Math.round(((current-prior)/prior)*100);
}

function companyLikePattern(company=''){
  const canonical=canonicalCompanyName(company)
    .replace(/\s+(LLC|INC|CORP|CO|LTD)$/,'')
    .trim()
    .toLowerCase();
  return `%${canonical||String(company).toLowerCase().trim()}%`;
}

async function competitorMeaningfulEvents(env,company){
  const pattern=companyLikePattern(company);
  const current=await env.DB.prepare(`
    SELECT COUNT(*) AS n,
           AVG(CASE WHEN official_value>0 THEN official_value END) AS avg_value,
           MAX(CASE WHEN official_value>0 THEN official_value END) AS max_value
    FROM leads
    WHERE LOWER(company) LIKE ?
      AND datetime(event_date)>=datetime('now','-30 days')
  `).bind(pattern).first()||{};
  const prior=await env.DB.prepare(`
    SELECT COUNT(*) AS n,
           AVG(CASE WHEN official_value>0 THEN official_value END) AS avg_value
    FROM leads
    WHERE LOWER(company) LIKE ?
      AND datetime(event_date)<datetime('now','-30 days')
      AND datetime(event_date)>=datetime('now','-60 days')
  `).bind(pattern).first()||{};

  const events=[];
  const c=Number(current.n||0),p=Number(prior.n||0);
  const volumeChange=pctChange(c,p);
  if(c>=2 && volumeChange>=25){
    events.push({type:'activity_surge',severity:'high',signature:`activity_surge:${c}:${p}`,title:`${company} activity increased ${volumeChange}% over the previous 30 days.`,detail:`${c} recent permit-linked records versus ${p} in the prior period.`});
  }else if(p>=3 && volumeChange<=-30){
    events.push({type:'activity_decline',severity:'medium',signature:`activity_decline:${c}:${p}`,title:`${company} activity decreased ${Math.abs(volumeChange)}% over the previous 30 days.`,detail:`${c} recent permit-linked records versus ${p} in the prior period.`});
  }

  const avc=Number(current.avg_value||0),avp=Number(prior.avg_value||0);
  const valueChange=pctChange(avc,avp);
  if(c>=2 && avc>0 && avp>0 && valueChange>=40){
    events.push({type:'value_surge',severity:'high',signature:`value_surge:${Math.round(avc)}:${Math.round(avp)}`,title:`${company} average reported project value increased ${valueChange}%.`,detail:`Current 30-day average reported value is about $${Math.round(avc).toLocaleString('en-US')}.`});
  }

  const major=await env.DB.prepare(`
    SELECT id,name,market,official_value,event_date
    FROM leads
    WHERE LOWER(company) LIKE ?
      AND official_value>=1000000
      AND datetime(event_date)>=datetime('now','-1 day')
    ORDER BY official_value DESC
    LIMIT 1
  `).bind(pattern).first();
  if(major){
    events.push({type:'major_project',severity:'high',signature:`major_project:${major.id}`,title:`${company} appears on a major project.`,detail:`${major.name||'Project'} · ${major.market||''} · reported value $${Number(major.official_value||0).toLocaleString('en-US')}.`});
  }

  const currentMarkets=(await env.DB.prepare(`
    SELECT market,COUNT(*) AS n
    FROM leads
    WHERE LOWER(company) LIKE ?
      AND datetime(event_date)>=datetime('now','-30 days')
    GROUP BY market
  `).bind(pattern).all()).results||[];
  const historicMarkets=(await env.DB.prepare(`
    SELECT DISTINCT market
    FROM leads
    WHERE LOWER(company) LIKE ?
      AND datetime(event_date)<datetime('now','-30 days')
      AND datetime(event_date)>=datetime('now','-365 days')
  `).bind(pattern).all()).results||[];
  const historic=new Set(historicMarkets.map(x=>x.market));
  for(const m of currentMarkets){
    if(m.market && !historic.has(m.market)){
      events.push({type:'new_territory',severity:'high',signature:`new_territory:${m.market}`,title:`${company} has new recent activity in ${m.market}.`,detail:`RevenueTrigger found ${Number(m.n||0)} recent permit-linked record${Number(m.n||0)===1?'':'s'} there and no activity in that market during the preceding available history.`});
    }
  }
  return events;
}

async function listWatchlist(env,user){
  try{
    const rows=(await env.DB.prepare(`SELECT company,created_at FROM competitor_watchlist WHERE user_id=? ORDER BY created_at DESC`).bind(user.id).all()).results||[];
    const items=[];
    for(const row of rows){
      const events=await competitorMeaningfulEvents(env,row.company);
      items.push({company:row.company,createdAt:row.created_at,events});
    }
    return items;
  }catch(e){
    return [];
  }
}

async function runCompetitorWatchAlerts(env,scheduledDate=new Date()){
  const hour=scheduledDate.getUTCHours();
  if(hour!==15 || !env.RESEND_API_KEY || !env.EMAIL_FROM)return {sent:0};

  let users=[];
  try{
    users=(await env.DB.prepare(`
      SELECT * FROM users
      WHERE subscription_status IN ('active','trialing')
        AND plan='Territory'
    `).all()).results||[];
  }catch(e){return {sent:0,error:String(e?.message||e)}}

  let sent=0;
  for(const user of users){
    const watched=await listWatchlist(env,user);
    const fresh=[];
    for(const item of watched){
      for(const event of item.events||[]){
        const already=await env.DB.prepare(`
          SELECT 1 FROM competitor_watch_alert_log
          WHERE user_id=? AND company=? AND signature=?
        `).bind(user.id,item.company,event.signature).first();
        if(!already)fresh.push({company:item.company,...event});
      }
    }
    if(!fresh.length)continue;

    const rows=fresh.slice(0,10).map(e=>`<div style="padding:13px 0;border-bottom:1px solid #173222"><div style="font-weight:800;color:#f4faf6">${htmlEsc(e.title)}</div><div style="color:#91a59a;font-size:12px;margin-top:4px">${htmlEsc(e.detail||'')}</div></div>`).join('');
    const link=`${String(env.FRONTEND_URL||env.ALLOWED_ORIGIN||'').replace(/\/$/,'')}/competitors.html`;
    const mail=await sendEmail(env,{
      to:user.email,
      subject:`RevenueTrigger competitor watch: ${fresh.length} meaningful change${fresh.length===1?'':'s'}`,
      html:`<div style="font-family:Arial,sans-serif;background:#021008;padding:28px;color:#eef7f1"><div style="max-width:720px;margin:auto;background:#06160e;border:1px solid #214831;border-radius:18px;padding:24px"><div style="color:#2aee61;font-size:12px;font-weight:800;letter-spacing:.16em;text-transform:uppercase">Competitor Intelligence</div><h2 style="color:#fff;margin:8px 0 4px">Meaningful changes detected</h2><p style="color:#91a59a">RevenueTrigger suppressed ordinary permit noise and surfaced changes in watched competitor behavior.</p>${rows}<p style="margin-top:20px"><a href="${htmlEsc(link)}" style="display:inline-block;background:#2aee61;color:#031008;text-decoration:none;padding:12px 18px;border-radius:10px;font-weight:900">Open Competitor Intelligence</a></p></div></div>`
    }).catch(()=>({ok:false}));
    if(!mail?.ok)continue;

    for(const e of fresh){
      await env.DB.prepare(`INSERT OR IGNORE INTO competitor_watch_alert_log (user_id,company,signature,sent_at) VALUES (?,?,?,datetime('now'))`).bind(user.id,e.company,e.signature).run();
    }
    sent++;
  }
  return {sent};
}




function isListedCompanyName(v=''){
  return isMeaningfulCompanyName(v);
}
function safeEventMs(v){
  const ms=Date.parse(v||'');
  return Number.isFinite(ms)?ms:null;
}
function sumOfficialValue(rows=[]){
  return rows.reduce((n,x)=>n+(Number.isFinite(Number(x.official_value))?Number(x.official_value):0),0);
}
function avgNumeric(rows=[],key){
  const vals=rows.map(x=>Number(x?.[key])).filter(Number.isFinite);
  return vals.length?vals.reduce((a,b)=>a+b,0)/vals.length:0;
}
async function buildRelationshipIntelligence(env,rawCompany,{days=365,rowLimit=5000}={}){
  const company=canonicalCompanyName(rawCompany||'');
  if(!company)return {ok:false,error:'company required'};
  days=Math.max(90,Math.min(730,Number(days)||365));
  rowLimit=Math.max(500,Math.min(10000,Number(rowLimit)||5000));

  const rows=(await env.DB.prepare(`
    SELECT id,name,address,event_date,market,permit,permit_status,official_value,score,temperature,scope,source,company,updated_at
    FROM leads
    WHERE company IS NOT NULL
      AND TRIM(company)<>''
      AND LOWER(TRIM(company)) NOT IN ('not listed','unknown','n/a','none','null','owner','to be bid','tbd','to be determined','not provided','unassigned')
      AND datetime(event_date)>=datetime('now',?)
    ORDER BY datetime(event_date) DESC
    LIMIT ?
  `).bind(`-${days} days`,rowLimit).all()).results||[];

  const prepared=rows.map(x=>{
    const canonical=canonicalCompanyName(x.company||'');
    const addr=usableClusterAddress({address:x.address,market:x.market});
    return {...x,_canonical:canonical,_projectKey:addr?`${x.market||''}|${addr}`:'',_type:classifyProjectType(`${x.name||''} ${x.scope||''}`),_ms:safeEventMs(x.event_date)};
  }).filter(x=>isListedCompanyName(x._canonical));

  const target=prepared.filter(x=>x._canonical===company);
  if(!target.length)return {ok:true,company,days,historyFound:false,projectCount:0,note:'No stored permit-linked history found for this company in the selected window.'};

  const aliases=[...new Set(target.map(x=>String(x.company||'').trim()).filter(Boolean))];
  const targetKeys=new Set(target.map(x=>x._projectKey).filter(Boolean));
  const projectMap=new Map();
  for(const x of prepared){
    if(!x._projectKey)continue;
    if(!projectMap.has(x._projectKey))projectMap.set(x._projectKey,[]);
    projectMap.get(x._projectKey).push(x);
  }

  const co=new Map();
  for(const key of targetKeys){
    const group=projectMap.get(key)||[];
    const targetAtProject=group.filter(x=>x._canonical===company);
    if(!targetAtProject.length)continue;
    const otherCompanies=new Map();
    for(const x of group){
      if(!x._canonical||x._canonical===company)continue;
      if(!otherCompanies.has(x._canonical))otherCompanies.set(x._canonical,[]);
      otherCompanies.get(x._canonical).push(x);
    }
    for(const [other,items] of otherCompanies){
      let r=co.get(other);
      if(!r){r={company:other,projects:new Set(),markets:new Set(),types:new Map(),latestActivity:null,examples:[]};co.set(other,r)}
      r.projects.add(key);
      for(const x of items){
        if(x.market)r.markets.add(x.market);
        const t=x._type||'Other';r.types.set(t,(r.types.get(t)||0)+1);
        if(!r.latestActivity||String(x.event_date||'')>String(r.latestActivity))r.latestActivity=x.event_date;
      }
      const exemplar=(items[0]||targetAtProject[0]);
      if(exemplar && r.examples.length<3)r.examples.push({market:exemplar.market,address:exemplar.address,project:exemplar.name,permit:exemplar.permit,date:exemplar.event_date});
    }
  }

  const historicalAssociations=[...co.values()].map(r=>({
    company:r.company,
    sharedProjectCount:r.projects.size,
    evidenceStrength:r.projects.size>=3?'repeated':r.projects.size===2?'emerging':'single_observation',
    markets:[...r.markets],
    projectTypes:[...r.types.entries()].sort((a,b)=>b[1]-a[1]).slice(0,5).map(([name,count])=>({name,count})),
    latestActivity:r.latestActivity,
    evidence:'Documented co-occurrence at the same normalized project address. This does not establish a contractual relationship.',
    examples:r.examples
  })).sort((a,b)=>b.sharedProjectCount-a.sharedProjectCount||String(b.latestActivity||'').localeCompare(String(a.latestActivity||''))).slice(0,20);
  const frequentlyAppearsWith=historicalAssociations.filter(x=>x.sharedProjectCount>=2);

  // V122 — Relationship Gaps
  // A gap is only surfaced when a counterparty has repeated documented co-occurrence
  // with the target company on 2+ distinct normalized project addresses AND the target
  // later appears on a newer dated project address where that counterparty is not present
  // in the stored public permit-linked records. This is pattern evidence only.
  const targetProjectsByKey=new Map();
  for(const x of target){
    if(!x._projectKey)continue;
    const prior=targetProjectsByKey.get(x._projectKey);
    if(!prior || Number(x._ms||0)>Number(prior._ms||0))targetProjectsByKey.set(x._projectKey,x);
  }
  const relationshipGaps=[];
  for(const assoc of frequentlyAppearsWith){
    const raw=co.get(assoc.company);
    const sharedKeys=raw?.projects||new Set();
    let latestShared=null;
    for(const key of sharedKeys){
      const p=targetProjectsByKey.get(key);
      if(p && p._ms && (!latestShared || p._ms>latestShared._ms))latestShared=p;
    }
    if(!latestShared?._ms)continue;
    const newer=[...targetProjectsByKey.entries()]
      .filter(([key,p])=>!sharedKeys.has(key) && p?._ms && p._ms>latestShared._ms)
      .map(([,p])=>p)
      .sort((a,b)=>Number(b._ms||0)-Number(a._ms||0));
    if(!newer.length)continue;
    const p=newer[0];
    relationshipGaps.push({
      counterparty:assoc.company,
      status:'historical_pattern_gap',
      evidenceStrength:assoc.evidenceStrength,
      historicalSharedProjectCount:Number(assoc.sharedProjectCount||0),
      latestSharedActivity:latestShared.event_date||null,
      newerProject:{
        market:p.market||null,
        address:p.address||null,
        project:p.name||null,
        permit:p.permit||null,
        date:p.event_date||null,
        projectType:p._type||'Other'
      },
      interpretation:`${assoc.company} appears with ${company} on ${Number(assoc.sharedProjectCount||0)} prior distinct project addresses, but is not present in stored public permit-linked records for a newer project. This is a historical-pattern gap only; it does not show that work is unawarded, available, or expected to involve that counterparty.`
    });
  }
  relationshipGaps.sort((a,b)=>String(b.newerProject?.date||'').localeCompare(String(a.newerProject?.date||''))||Number(b.historicalSharedProjectCount||0)-Number(a.historicalSharedProjectCount||0));

  const now=Date.now(),d30=30*86400000,d90=90*86400000;
  const recent30=target.filter(x=>x._ms&&now-x._ms<=d30);
  const prior30=target.filter(x=>x._ms&&now-x._ms>d30&&now-x._ms<=2*d30);
  const recent90=target.filter(x=>x._ms&&now-x._ms<=d90);
  const priorHistory=target.filter(x=>x._ms&&now-x._ms>d90);

  const recentMarkets=new Set(recent90.map(x=>x.market).filter(Boolean));
  const priorMarkets=new Set(priorHistory.map(x=>x.market).filter(Boolean));
  const recentTypes=new Set(recent90.map(x=>x._type).filter(Boolean));
  const priorTypes=new Set(priorHistory.map(x=>x._type).filter(Boolean));
  const hasExpansionBaseline=priorHistory.length>0;
  const newMarkets=hasExpansionBaseline?[...recentMarkets].filter(x=>!priorMarkets.has(x)):[];
  const newProjectTypes=hasExpansionBaseline?[...recentTypes].filter(x=>!priorTypes.has(x)):[];
  const firstObservedMarkets=!hasExpansionBaseline?[...recentMarkets]:[];
  const firstObservedProjectTypes=!hasExpansionBaseline?[...recentTypes]:[];

  const typeCounts={};for(const x of target)typeCounts[x._type]=(typeCounts[x._type]||0)+1;
  const marketCounts={};for(const x of target)marketCounts[x.market]=(marketCounts[x.market]||0)+1;

  const currentValue=sumOfficialValue(recent30),priorValue=sumOfficialValue(prior30);
  const currentCount=recent30.length,priorCount=prior30.length;
  const currentProjects=new Set(recent30.map(x=>x._projectKey||`id:${x.id}`)).size;
  const priorProjects=new Set(prior30.map(x=>x._projectKey||`id:${x.id}`)).size;
  const currentAvg=avgNumeric(recent30,'score'),priorAvg=avgNumeric(prior30,'score');
  const hasMomentumBaseline=priorCount>0;
  const countChange=hasMomentumBaseline?pctChange(currentCount,priorCount):null;
  const projectChange=priorProjects>0?pctChange(currentProjects,priorProjects):null;
  const valueChange=priorValue>0?pctChange(currentValue,priorValue):null;

  return {
    ok:true,company,aliases,days,historyFound:true,
    projectCount:new Set(target.map(x=>x._projectKey||`id:${x.id}`)).size,
    permitLinkedRecordCount:target.length,
    latestActivity:target[0]?.event_date||null,
    companyMomentum:{
      status:hasMomentumBaseline?'comparable':'newly_observed',
      interpretation:hasMomentumBaseline?'Current 30 days compared with the previous 30 days.':'Activity is present in the current 30-day window, but there is no previous-30-day baseline. Percentage growth is intentionally not calculated.',
      current30Days:{records:currentCount,projects:currentProjects,reportedValue:currentValue,avgOpportunityScore:Math.round(currentAvg*10)/10},
      previous30Days:{records:priorCount,projects:priorProjects,reportedValue:priorValue,avgOpportunityScore:Math.round(priorAvg*10)/10},
      change:{recordCountPct:countChange,projectCountPct:projectChange,reportedValuePct:valueChange,avgScoreDelta:hasMomentumBaseline?Math.round((currentAvg-priorAvg)*10)/10:null}
    },
    territoryHistory:Object.entries(marketCounts).sort((a,b)=>b[1]-a[1]).map(([market,count])=>({market,count})),
    projectTypeHistory:Object.entries(typeCounts).sort((a,b)=>b[1]-a[1]).map(([projectType,count])=>({projectType,count})),
    expansionSignals:{
      status:hasExpansionBaseline?'comparable':'insufficient_history',
      comparison:'Last 90 days versus earlier history in the selected window',
      priorHistoryRecords:priorHistory.length,
      newMarkets,
      newProjectTypes,
      firstObservedMarkets,
      firstObservedProjectTypes,
      interpretation:hasExpansionBaseline?'New means observed in the last 90 days and absent from earlier records in the selected history window.':'There is no earlier history in the selected window, so current markets/project types are labeled first observed rather than expansion.'
    },
    historicalAssociations,
    frequentlyAppearsWith,
    relationshipGaps:relationshipGaps.slice(0,10),
    relationshipSummary:{
      associationCount:historicalAssociations.length,
      repeatedAssociationCount:frequentlyAppearsWith.length,
      relationshipGapCount:relationshipGaps.length,
      strongestEvidence:historicalAssociations.some(x=>x.evidenceStrength==='repeated')?'repeated':historicalAssociations.some(x=>x.evidenceStrength==='emerging')?'emerging':historicalAssociations.length?'single_observation':'none'
    },
    methodology:{
      association:'Same normalized project address in stored public permit-linked records.',
      frequentThreshold:'Frequently Appears With requires at least 2 distinct shared project addresses. Single-project co-occurrence is retained separately as a historical association.',
      caution:'Co-occurrence is historical association evidence only and does not prove a prime/subcontractor, award, payment, or contractual relationship.',
      relationshipGap:'A historical-pattern gap requires a counterparty with at least 2 prior shared project addresses and a newer dated target-company project where that counterparty is absent from stored public permit-linked records. It does not mean work is unawarded, available, or expected to involve that counterparty.',
      expansion:'A market or project type is considered expansion only when earlier history exists in the selected window. Otherwise it is labeled first observed.'
    }
  };
}


const PHOENIX_BACKFILL_V1={
  cursorMarket:'PhoenixBackfillV1',
  startDate:'2026-04-03',
  endDate:'2026-09-29',
  batchSize:1000,
  expectedSourcePermits:4984
};

async function phoenixBackfillState(env){
  const cfg=PHOENIX_BACKFILL_V1;
  const row=env.DB?await env.DB.prepare(`SELECT market,cursor_key,cursor_value,updated_at FROM market_cursors WHERE market=?`).bind(cfg.cursorMarket).first():null;
  const offset=Math.max(0,Number(row?.cursor_value)||0);
  const done=row?.cursor_key==='done';
  let storedPhoenixRows=null,storedPhoenixPermits=null,earliestStoredActivity=null,latestStoredActivity=null;
  if(env.DB){
    const stats=await env.DB.prepare(`
      SELECT COUNT(*) AS rows,
             COUNT(DISTINCT permit) AS permits,
             MIN(event_date) AS earliest,
             MAX(event_date) AS latest
      FROM leads
      WHERE market='Phoenix'
        AND datetime(event_date)>=datetime(?)
        AND datetime(event_date)<datetime(?,'+1 day')
    `).bind(cfg.startDate,cfg.endDate).first();
    storedPhoenixRows=Number(stats?.rows||0);
    storedPhoenixPermits=Number(stats?.permits||0);
    earliestStoredActivity=stats?.earliest||null;
    latestStoredActivity=stats?.latest||null;
  }
  return {
    market:'Phoenix',
    version:'V1',
    status:done?'complete':offset>0?'running':'queued',
    sourceWindow:{startDate:cfg.startDate,endDate:cfg.endDate},
    sourceCursorOffset:offset,
    batchSize:cfg.batchSize,
    expectedSourcePermits:cfg.expectedSourcePermits,
    approximateSourceProgressPct:done?100:Math.min(99,Math.round((offset/cfg.expectedSourcePermits)*1000)/10),
    storedPhoenixRows,
    storedPhoenixPermits,
    earliestStoredActivity,
    latestStoredActivity,
    updatedAt:row?.updated_at||null,
    note:'Historical rows are stored in the existing leads table but normal opportunity and alert views continue to filter by event_date. Backfill progress is source-page based; stored counts include already-present live Phoenix permits.'
  };
}

async function setPhoenixBackfillCursor(env,status,offset){
  if(!env.DB)return;
  await env.DB.prepare(`
    INSERT INTO market_cursors (market,cursor_key,cursor_value,updated_at)
    VALUES (?,?,?,datetime('now'))
    ON CONFLICT(market) DO UPDATE SET
      cursor_key=excluded.cursor_key,
      cursor_value=excluded.cursor_value,
      updated_at=datetime('now')
  `).bind(PHOENIX_BACKFILL_V1.cursorMarket,status,String(Math.max(0,Number(offset)||0))).run();
}

async function runPhoenixHistoricalBackfillBatch(env){
  if(!env.DB)return {ok:false,skipped:'D1 unavailable'};
  const cfg=PHOENIX_BACKFILL_V1;
  const state=await phoenixBackfillState(env);
  if(state.status==='complete')return {ok:true,skipped:'already complete',state};

  const offset=state.sourceCursorOffset||0;
  const features=await fetchArcGIS(PHX_PERMITS,{
    where:`PER_ISSUE_DATE >= DATE '${cfg.startDate}' AND PER_ISSUE_DATE <= DATE '${cfg.endDate}'`,
    outFields:'OBJECTID,PER_TYPE,PER_NUM,PROJECT,PERMIT_NAME,PERMIT_STAT,PER_ENT_DATE,PER_ISSUE_DATE,STREET_FULL_NAME,PROFESS_NAME,PER_TYPE_DESC,MOD_DESC,SCOPE_CODE,SCOPE_DESC',
    orderByFields:'PER_ISSUE_DATE ASC,OBJECTID ASC',
    resultOffset:String(offset),
    resultRecordCount:String(cfg.batchSize),
    returnGeometry:'false',
    f:'json'
  },'Phoenix historical backfill');

  const seen=new Set();
  const leads=[];
  for(const f of features){
    const lead=normalizePhoenix(f);
    const permit=String(lead.permit||'').trim();
    const dateMs=new Date(lead.date).getTime();
    if(!permit||!Number.isFinite(dateMs))continue;
    const key=permit.toLowerCase();
    if(seen.has(key))continue;
    seen.add(key);
    leads.push(lead);
  }

  if(leads.length)await persist(env,leads);

  const nextOffset=offset+features.length;
  const done=features.length<cfg.batchSize || nextOffset>=cfg.expectedSourcePermits;
  await setPhoenixBackfillCursor(env,done?'done':'running',nextOffset);

  const after=await phoenixBackfillState(env);
  return {
    ok:true,
    fetchedFeatures:features.length,
    persistedNormalizedLeads:leads.length,
    previousOffset:offset,
    nextOffset,
    complete:done,
    state:after
  };
}


async function previewPhoenixHistoricalBackfill(env,{days=180,limit=5000}={}){
  days=Math.max(30,Math.min(730,Number(days)||180));
  limit=Math.max(100,Math.min(8000,Number(limit)||5000));
  const startDate=new Date(Date.now()-days*86400000).toISOString().slice(0,10);
  const pageSize=1000;
  const raw=[];
  const seen=new Set();

  for(let offset=0;offset<limit;offset+=pageSize){
    const take=Math.min(pageSize,limit-offset);
    const features=await fetchArcGIS(PHX_PERMITS,{
      where:`PER_ISSUE_DATE >= DATE '${startDate}'`,
      outFields:'OBJECTID,PER_TYPE,PER_NUM,PROJECT,PERMIT_NAME,PERMIT_STAT,PER_ENT_DATE,PER_ISSUE_DATE,STREET_FULL_NAME,PROFESS_NAME,PER_TYPE_DESC,MOD_DESC,SCOPE_CODE,SCOPE_DESC',
      orderByFields:'PER_ISSUE_DATE DESC,OBJECTID DESC',
      resultOffset:String(offset),
      resultRecordCount:String(take),
      returnGeometry:'false',
      f:'json'
    },'Phoenix historical preview');

    if(!features.length)break;
    for(const f of features){
      const a=f.attributes||{};
      const key=String(a.PER_NUM||a.OBJECTID||'').trim();
      if(!key||seen.has(key))continue;
      seen.add(key);
      raw.push(f);
      if(raw.length>=limit)break;
    }
    if(features.length<take||raw.length>=limit)break;
  }

  const leads=raw.map(normalizePhoenix).filter(x=>Number.isFinite(new Date(x.date).getTime()));
  const listed=leads.filter(x=>isListedCompanyName(canonicalCompanyName(x.company||'')));
  const companies=new Map();
  for(const x of listed){
    const c=canonicalCompanyName(x.company||'');
    companies.set(c,(companies.get(c)||0)+1);
  }
  const projectKeys=new Set();
  for(const x of leads){
    const addr=usableClusterAddress({address:x.address,market:'Phoenix'});
    if(addr)projectKeys.add(`Phoenix|${addr}`);
  }

  const dates=leads.map(x=>new Date(x.date).getTime()).filter(Number.isFinite);
  const earliest=dates.length?Math.min(...dates):null;
  const latest=dates.length?Math.max(...dates):null;

  let existingPermits=new Set();
  if(env.DB){
    const r=(await env.DB.prepare(`
      SELECT permit FROM leads
      WHERE market='Phoenix'
        AND datetime(event_date)>=datetime('now',?)
        AND permit IS NOT NULL
        AND TRIM(permit)<>''
    `).bind(`-${days} days`).all()).results||[];
    existingPermits=new Set(r.map(x=>String(x.permit||'').trim()).filter(Boolean));
  }
  const previewPermitSet=new Set(leads.map(x=>String(x.permit||'').trim()).filter(Boolean));
  const estimatedNewPermits=[...previewPermitSet].filter(x=>!existingPermits.has(x)).length;

  const topCompanies=[...companies.entries()]
    .sort((a,b)=>b[1]-a[1]||a[0].localeCompare(b[0]))
    .slice(0,15)
    .map(([company,count])=>({company,count}));

  return {
    ok:true,
    market:'Phoenix',
    mode:'preview_only',
    requested:{days,limit,startDate},
    fetched:{
      rawFeatures:raw.length,
      normalizedLeads:leads.length,
      listedCompanyRecords:listed.length,
      listedShare:leads.length?Math.round((listed.length/leads.length)*1000)/1000:0,
      distinctCompanies:companies.size,
      distinctProjectAddresses:projectKeys.size,
      distinctPermits:previewPermitSet.size,
      earliestActivity:earliest?new Date(earliest).toISOString():null,
      latestActivity:latest?new Date(latest).toISOString():null,
      actualSpanDays:earliest&&latest?Math.round((latest-earliest)/86400000):0,
      hitPreviewLimit:raw.length>=limit
    },
    existingStoredPermitsInWindow:existingPermits.size,
    estimatedNewPermits,
    topCompanies,
    recommendation:estimatedNewPermits>0
      ?'Historical source coverage is available. If the counts and company attribution look reasonable, the next step is a controlled Phoenix backfill into D1 with deduplication by market + permit.'
      :'No additional Phoenix permit IDs were found beyond the current stored snapshot in this preview window.',
    caution:'Preview does not write to D1 or alter production scores. Phoenix PROFess_NAME is source-published participant/professional attribution and should not be interpreted as proof of award or contractor role.'
  };
}


async function historicalCoverageReadiness(env,{days=730,rowLimit=12000}={}){
  days=Math.max(90,Math.min(730,Number(days)||730));
  rowLimit=Math.max(1000,Math.min(12000,Number(rowLimit)||12000));

  const rows=(await env.DB.prepare(`
    SELECT id,name,address,event_date,market,permit,scope,company
    FROM leads
    WHERE datetime(event_date)>=datetime('now',?)
    ORDER BY datetime(event_date) DESC
    LIMIT ?
  `).bind(`-${days} days`,rowLimit).all()).results||[];

  const prepared=rows.map(x=>{
    const canonical=canonicalCompanyName(x.company||'');
    const addr=usableClusterAddress({address:x.address,market:x.market});
    return {
      ...x,
      _canonical:canonical,
      _listed:isListedCompanyName(canonical),
      _projectKey:addr?`${x.market||''}|${addr}`:'',
      _ms:safeEventMs(x.event_date)
    };
  }).filter(x=>x._ms);

  const DAY=86400000;
  const now=Date.now();

  function analyze(records,label){
    const dated=records.filter(x=>x._ms);
    const msValues=dated.map(x=>Number(x._ms||0)).filter(Boolean);
    const earliestMs=msValues.length?Math.min(...msValues):0;
    const latestMs=msValues.length?Math.max(...msValues):0;
    const projectKeys=new Set(dated.map(x=>x._projectKey).filter(Boolean));
    const listed=dated.filter(x=>x._listed);
    const companies=new Map();

    for(const x of listed){
      if(!companies.has(x._canonical))companies.set(x._canonical,[]);
      companies.get(x._canonical).push(x);
    }

    let companiesSpan30=0,companiesSpan60=0,companiesSpan90=0;
    let momentumComparableCompanies=0,expansionBaselineCompanies=0;
    for(const recs of companies.values()){
      const times=recs.map(x=>Number(x._ms||0)).filter(Boolean);
      if(!times.length)continue;
      const span=(Math.max(...times)-Math.min(...times))/DAY;
      if(span>=30)companiesSpan30++;
      if(span>=60)companiesSpan60++;
      if(span>=90)companiesSpan90++;

      const current30=recs.some(x=>now-x._ms<=30*DAY);
      const previous30=recs.some(x=>now-x._ms>30*DAY&&now-x._ms<=60*DAY);
      if(current30&&previous30)momentumComparableCompanies++;

      const recent90=recs.some(x=>now-x._ms<=90*DAY);
      const prior90=recs.some(x=>now-x._ms>90*DAY);
      if(recent90&&prior90)expansionBaselineCompanies++;
    }

    const projectCompanies=new Map();
    const companyProjects=new Map();
    for(const x of listed){
      if(!x._projectKey)continue;
      if(!projectCompanies.has(x._projectKey))projectCompanies.set(x._projectKey,new Set());
      projectCompanies.get(x._projectKey).add(x._canonical);
      if(!companyProjects.has(x._canonical))companyProjects.set(x._canonical,new Map());
      const pm=companyProjects.get(x._canonical);
      const prior=pm.get(x._projectKey);
      if(!prior||Number(x._ms||0)>Number(prior._ms||0))pm.set(x._projectKey,x);
    }

    const pairProjects=new Map();
    for(const [projectKey,set] of projectCompanies){
      const arr=[...set].sort();
      for(let i=0;i<arr.length;i++)for(let j=i+1;j<arr.length;j++){
        const key=`${arr[i]}|||${arr[j]}`;
        if(!pairProjects.has(key))pairProjects.set(key,new Set());
        pairProjects.get(key).add(projectKey);
      }
    }

    const repeatedPairs=[...pairProjects.entries()].filter(([,set])=>set.size>=2);
    let gapCandidateCount=0;
    const gapCompanies=new Set();
    for(const [pairKey,sharedKeys] of repeatedPairs){
      const [a,b]=pairKey.split('|||');
      for(const company of [a,b]){
        const projects=companyProjects.get(company);
        if(!projects?.size)continue;
        let latestSharedMs=0;
        for(const key of sharedKeys){
          const p=projects.get(key);
          if(p&&Number(p._ms||0)>latestSharedMs)latestSharedMs=Number(p._ms||0);
        }
        if(!latestSharedMs)continue;
        const hasNewer=[...projects.entries()].some(([key,p])=>!sharedKeys.has(key)&&Number(p._ms||0)>latestSharedMs);
        if(hasNewer){gapCandidateCount++;gapCompanies.add(company)}
      }
    }

    const storedSpanDays=earliestMs&&latestMs?Math.round((latestMs-earliestMs)/DAY):0;
    const momentumStatus=momentumComparableCompanies>0?'ready':'limited';
    const expansionStatus=expansionBaselineCompanies>0?'ready':'limited';
    const gapStatus=gapCandidateCount>0?'ready':repeatedPairs.length>0?'building_history':'insufficient_history';

    return {
      market:label,
      recordCount:dated.length,
      listedRecordCount:listed.length,
      earliestStoredActivity:earliestMs?new Date(earliestMs).toISOString():null,
      latestStoredActivity:latestMs?new Date(latestMs).toISOString():null,
      storedSpanDays,
      distinctProjects:projectKeys.size,
      distinctCompanies:companies.size,
      companyHistoryDepth:{
        span30Days:companiesSpan30,
        span60Days:companiesSpan60,
        span90Days:companiesSpan90,
        comparable30DayMomentum:momentumComparableCompanies,
        expansionBaseline90Days:expansionBaselineCompanies
      },
      relationshipHistory:{
        repeatedCompanyPairs:repeatedPairs.length,
        positiveGapPatterns:gapCandidateCount,
        companiesWithPositiveGapPattern:gapCompanies.size
      },
      readiness:{
        companyMomentum:momentumStatus,
        territoryAndVerticalExpansion:expansionStatus,
        relationshipGaps:gapStatus
      }
    };
  }

  const markets=[...new Set(prepared.map(x=>x.market).filter(Boolean))].sort();
  const byMarket=markets.map(m=>analyze(prepared.filter(x=>x.market===m),m));
  const overall=analyze(prepared,'All markets');

  const backfillPriority=byMarket
    .map(x=>{
      let score=0;
      if(x.readiness.companyMomentum!=='ready')score+=1;
      if(x.readiness.territoryAndVerticalExpansion!=='ready')score+=2;
      if(x.readiness.relationshipGaps!=='ready')score+=2;
      if(x.storedSpanDays<90)score+=2;
      return {market:x.market,priorityScore:score,storedSpanDays:x.storedSpanDays,readiness:x.readiness};
    })
    .sort((a,b)=>b.priorityScore-a.priorityScore||a.market.localeCompare(b.market));

  return {
    ok:true,
    requestedWindowDays:days,
    rowsExamined:prepared.length,
    overall,
    markets:byMarket,
    backfillPriority,
    interpretation:{
      companyMomentum:'Ready means at least one company has activity in both the current 30-day and previous 30-day windows.',
      territoryAndVerticalExpansion:'Ready means at least one company has activity in the last 90 days plus earlier activity in the selected history window.',
      relationshipGaps:'Ready means the stored records already contain at least one supported historical-pattern gap. Building history means repeated company pairs exist but no later gap sequence is yet established.',
      caution:'These readiness labels measure historical-data depth for RevenueTrigger analytics. They are not commercial rankings or predictions.'
    },
    generatedAt:new Date().toISOString()
  };
}


async function discoverRelationshipGapCandidates(env,{days=365,rowLimit=7500,limit=12}={}){
  days=Math.max(90,Math.min(730,Number(days)||365));
  rowLimit=Math.max(1000,Math.min(12000,Number(rowLimit)||7500));
  limit=Math.max(1,Math.min(25,Number(limit)||12));

  const rows=(await env.DB.prepare(`
    SELECT id,name,address,event_date,market,permit,official_value,score,scope,company
    FROM leads
    WHERE company IS NOT NULL
      AND TRIM(company)<>''
      AND LOWER(TRIM(company)) NOT IN ('not listed','unknown','n/a','none','null','owner','to be bid','tbd','to be determined','not provided','unassigned')
      AND datetime(event_date)>=datetime('now',?)
    ORDER BY datetime(event_date) DESC
    LIMIT ?
  `).bind(`-${days} days`,rowLimit).all()).results||[];

  const prepared=rows.map(x=>{
    const canonical=canonicalCompanyName(x.company||'');
    const addr=usableClusterAddress({address:x.address,market:x.market});
    return {...x,_canonical:canonical,_projectKey:addr?`${x.market||''}|${addr}`:'',_type:classifyProjectType(`${x.name||''} ${x.scope||''}`),_ms:safeEventMs(x.event_date)};
  }).filter(x=>isListedCompanyName(x._canonical)&&x._projectKey&&x._ms);

  const projectCompanies=new Map();
  const companyProjects=new Map();
  for(const x of prepared){
    if(!projectCompanies.has(x._projectKey))projectCompanies.set(x._projectKey,new Set());
    projectCompanies.get(x._projectKey).add(x._canonical);

    if(!companyProjects.has(x._canonical))companyProjects.set(x._canonical,new Map());
    const pm=companyProjects.get(x._canonical);
    const prior=pm.get(x._projectKey);
    if(!prior || Number(x._ms||0)>Number(prior._ms||0))pm.set(x._projectKey,x);
  }

  const pairProjects=new Map();
  for(const [projectKey,companies] of projectCompanies){
    const arr=[...companies].sort();
    if(arr.length<2)continue;
    for(let i=0;i<arr.length;i++)for(let j=i+1;j<arr.length;j++){
      const key=`${arr[i]}|||${arr[j]}`;
      if(!pairProjects.has(key))pairProjects.set(key,new Set());
      pairProjects.get(key).add(projectKey);
    }
  }

  const gapRows=[];
  for(const [pairKey,sharedKeys] of pairProjects){
    if(sharedKeys.size<2)continue;
    const [a,b]=pairKey.split('|||');
    for(const [company,counterparty] of [[a,b],[b,a]]){
      const projects=companyProjects.get(company);
      if(!projects?.size)continue;

      let latestSharedMs=0,latestSharedRecord=null;
      for(const key of sharedKeys){
        const p=projects.get(key);
        if(p && Number(p._ms||0)>latestSharedMs){latestSharedMs=Number(p._ms||0);latestSharedRecord=p}
      }
      if(!latestSharedMs)continue;

      const newer=[...projects.entries()]
        .filter(([key,p])=>!sharedKeys.has(key)&&Number(p._ms||0)>latestSharedMs)
        .map(([,p])=>p)
        .sort((x,y)=>Number(y._ms||0)-Number(x._ms||0));
      if(!newer.length)continue;

      const newest=newer[0];
      gapRows.push({
        company,
        counterparty,
        historicalSharedProjectCount:sharedKeys.size,
        evidenceStrength:sharedKeys.size>=3?'repeated':'emerging',
        latestSharedActivity:latestSharedRecord?.event_date||null,
        newerProject:{
          market:newest.market||null,
          address:newest.address||null,
          project:newest.name||null,
          permit:newest.permit||null,
          date:newest.event_date||null,
          projectType:newest._type||'Other'
        },
        newerProjectCount:newer.length,
        status:'historical_pattern_gap',
        interpretation:`${counterparty} appears with ${company} on ${sharedKeys.size} prior distinct project addresses, but is not present in stored public permit-linked records for a newer project. This is a historical-pattern gap only; it does not show that work is unawarded, available, or expected to involve that counterparty.`
      });
    }
  }

  const grouped=new Map();
  for(const gap of gapRows){
    let g=grouped.get(gap.company);
    if(!g){
      const projects=companyProjects.get(gap.company)||new Map();
      const markets=new Set([...projects.values()].map(x=>x.market).filter(Boolean));
      const latest=[...projects.values()].sort((a,b)=>Number(b._ms||0)-Number(a._ms||0))[0];
      g={company:gap.company,projectCount:projects.size,marketCount:markets.size,markets:[...markets],latestActivity:latest?.event_date||null,gaps:[]};
      grouped.set(gap.company,g);
    }
    g.gaps.push(gap);
  }

  const candidates=[...grouped.values()].map(g=>{
    g.gaps.sort((a,b)=>Number(b.historicalSharedProjectCount||0)-Number(a.historicalSharedProjectCount||0)||String(b.newerProject?.date||'').localeCompare(String(a.newerProject?.date||'')));
    return {
      company:g.company,
      projectCount:g.projectCount,
      marketCount:g.marketCount,
      markets:g.markets,
      latestActivity:g.latestActivity,
      relationshipGapCount:g.gaps.length,
      strongestHistoricalSharedProjectCount:Math.max(...g.gaps.map(x=>Number(x.historicalSharedProjectCount||0))),
      gaps:g.gaps.slice(0,5)
    };
  }).sort((a,b)=>b.relationshipGapCount-a.relationshipGapCount||b.strongestHistoricalSharedProjectCount-a.strongestHistoricalSharedProjectCount||String(b.latestActivity||'').localeCompare(String(a.latestActivity||''))).slice(0,limit);

  return {
    ok:true,
    days,
    rowsExamined:prepared.length,
    candidateCount:candidates.length,
    recommended:candidates[0]||null,
    candidates,
    methodology:{
      purpose:'Find positive QA examples for the Relationship Gaps model using stored public permit-linked history.',
      threshold:'A counterparty must share at least 2 distinct prior normalized project addresses with the company, followed by a newer dated company project where that counterparty is absent from stored public permit-linked records.',
      caution:'A historical-pattern gap is not evidence that work is unawarded, available, open for bid, or expected to involve the historical counterparty.'
    }
  };
}


async function discoverRelationshipCandidates(env,{days=365,rowLimit=7500,limit=12}={}){
  days=Math.max(90,Math.min(730,Number(days)||365));
  rowLimit=Math.max(1000,Math.min(12000,Number(rowLimit)||7500));
  limit=Math.max(3,Math.min(25,Number(limit)||12));
  const rows=(await env.DB.prepare(`
    SELECT id,name,address,event_date,market,permit,official_value,score,scope,company
    FROM leads
    WHERE company IS NOT NULL
      AND TRIM(company)<>''
      AND LOWER(TRIM(company)) NOT IN ('not listed','unknown','n/a','none','null','owner','to be bid','tbd','to be determined','not provided','unassigned')
      AND datetime(event_date)>=datetime('now',?)
    ORDER BY datetime(event_date) DESC
    LIMIT ?
  `).bind(`-${days} days`,rowLimit).all()).results||[];

  const prepared=rows.map(x=>{
    const canonical=canonicalCompanyName(x.company||'');
    const addr=usableClusterAddress({address:x.address,market:x.market});
    return {...x,_canonical:canonical,_projectKey:addr?`${x.market||''}|${addr}`:'',_type:classifyProjectType(`${x.name||''} ${x.scope||''}`),_ms:safeEventMs(x.event_date)};
  }).filter(x=>isListedCompanyName(x._canonical));

  const now=Date.now(),d30=30*86400000;
  const companyStats=new Map();
  const projectCompanies=new Map();
  for(const x of prepared){
    let st=companyStats.get(x._canonical);
    if(!st){st={company:x._canonical,records:0,projects:new Set(),markets:new Set(),types:new Set(),latestActivity:null,current30:0,previous30:0};companyStats.set(x._canonical,st)}
    st.records++;
    if(x._projectKey)st.projects.add(x._projectKey);
    if(x.market)st.markets.add(x.market);
    if(x._type)st.types.add(x._type);
    if(!st.latestActivity||String(x.event_date||'')>String(st.latestActivity))st.latestActivity=x.event_date;
    if(x._ms){
      const age=now-x._ms;
      if(age<=d30)st.current30++;
      else if(age<=2*d30)st.previous30++;
    }
    if(x._projectKey){
      if(!projectCompanies.has(x._projectKey))projectCompanies.set(x._projectKey,new Set());
      projectCompanies.get(x._projectKey).add(x._canonical);
    }
  }

  const pairCounts=new Map();
  for(const companies of projectCompanies.values()){
    const arr=[...companies].sort();
    if(arr.length<2)continue;
    for(let i=0;i<arr.length;i++)for(let j=i+1;j<arr.length;j++){
      const key=`${arr[i]}|||${arr[j]}`;
      pairCounts.set(key,(pairCounts.get(key)||0)+1);
    }
  }

  const associationStats=new Map();
  for(const [key,count] of pairCounts){
    const [a,b]=key.split('|||');
    for(const [company,other] of [[a,b],[b,a]]){
      let st=associationStats.get(company);
      if(!st){st={associationCount:0,repeatedAssociationCount:0,strongestSharedProjectCount:0,topCounterparties:[]};associationStats.set(company,st)}
      st.associationCount++;
      if(count>=2)st.repeatedAssociationCount++;
      st.strongestSharedProjectCount=Math.max(st.strongestSharedProjectCount,count);
      st.topCounterparties.push({company:other,sharedProjectCount:count});
    }
  }

  const candidates=[...companyStats.values()].map(st=>{
    const assoc=associationStats.get(st.company)||{associationCount:0,repeatedAssociationCount:0,strongestSharedProjectCount:0,topCounterparties:[]};
    const comparable=st.previous30>0;
    const qaDepth=(st.projects.size>=3?1:0)+(assoc.repeatedAssociationCount>0?2:0)+(comparable?1:0)+(st.markets.size>=2?1:0);
    return {
      company:st.company,
      projectCount:st.projects.size,
      permitLinkedRecordCount:st.records,
      marketCount:st.markets.size,
      markets:[...st.markets],
      projectTypeCount:st.types.size,
      latestActivity:st.latestActivity,
      current30Records:st.current30,
      previous30Records:st.previous30,
      hasMomentumBaseline:comparable,
      associationCount:assoc.associationCount,
      repeatedAssociationCount:assoc.repeatedAssociationCount,
      strongestSharedProjectCount:assoc.strongestSharedProjectCount,
      topCounterparties:assoc.topCounterparties.sort((a,b)=>b.sharedProjectCount-a.sharedProjectCount||a.company.localeCompare(b.company)).slice(0,3),
      qaDepth
    };
  }).filter(x=>x.projectCount>=2)
    .sort((a,b)=>b.qaDepth-a.qaDepth||b.repeatedAssociationCount-a.repeatedAssociationCount||b.projectCount-a.projectCount||b.permitLinkedRecordCount-a.permitLinkedRecordCount)
    .slice(0,limit);

  const relationshipCandidate=candidates.find(x=>x.repeatedAssociationCount>0)||candidates[0]||null;
  const crossMarketCandidate=candidates.find(x=>x.marketCount>=2)||null;
  const momentumCandidate=candidates.find(x=>x.hasMomentumBaseline)||null;
  return {
    ok:true,days,rowsExamined:prepared.length,candidateCount:candidates.length,
    recommended:relationshipCandidate,
    recommendedUseCases:{
      repeatedRelationships:relationshipCandidate,
      crossMarketIdentity:crossMarketCandidate,
      momentumBaseline:momentumCandidate
    },
    historyCoverage:{
      candidatesWithPrevious30DayBaseline:candidates.filter(x=>x.hasMomentumBaseline).length,
      note:momentumCandidate?'At least one candidate has a comparable previous-30-day baseline.':'The stored lead window currently has no candidate with previous-30-day activity, so Company Momentum trend validation should remain provisional until more historical snapshots accumulate.'
    },
    candidates,
    methodology:{
      purpose:'Find companies with enough stored history to QA Company Momentum, cross-market identity, and repeated historical associations before building the UI.',
      candidateMinimum:'At least 2 distinct normalized project addresses in the selected window.',
      repeatedAssociation:'At least 2 distinct shared project addresses with the same counterparty.',
      companyHygiene:'Generic placeholders such as OWNER, TO BE BID, TBD, NOT PROVIDED, UNASSIGNED, and single-letter municipal field noise are excluded from company identity and relationship analysis.',
      caution:'Candidate ordering is for QA depth only; it is not a commercial ranking or prediction.'
    }
  };
}

export default {
  async fetch(request,env){
    if(request.method==='OPTIONS')return new Response(null,{headers:cors(env)});
    const url=new URL(request.url),path=url.pathname.replace(/^\/api/,'');
    try{
      if(PRIVATE_DIAGNOSTICS.has(path)){
        const bearer=(request.headers.get('authorization')||'').replace(/^Bearer\s+/i,'').trim();
        const admin=Boolean(env.ADMIN_TOKEN&&bearer===env.ADMIN_TOKEN);
        if(!admin&&!await authUser(request,env))return json({error:'sign in required'},401,env);
      }
      if(path==='/stripe/webhook'&&request.method==='POST')return await handleStripeWebhook(request,env);
      if(path==='/health'){const rocMeta=await rocRosterMeta(env);return json({ok:true,service:'RevenueTrigger V57',time:nowIso(),features:{auth:true,savedLeads:true,billing:!!env.STRIPE_SECRET_KEY,email:!!env.RESEND_API_KEY,multiMarket:true,azRoc:!!rocMeta?.active_batch},roc:rocMeta?{sourceAsOf:rocMeta.source_as_of,recordCount:Number(rocMeta.record_count||0),importedAt:rocMeta.imported_at}:null,markets:SOURCE_STATUS},200,env);}
      if(path==='/roc/meta'&&request.method==='GET'){
        const session=await authUser(request,env);
        if(!session)return json({error:'sign in required'},401,env);
        const meta=await rocRosterMeta(env);
        return json({ok:true,meta:meta||{active_batch:null,record_count:0}},200,env);
      }
      if(path==='/roc/search'&&request.method==='GET'){
        const session=await authUser(request,env);
        if(!session)return json({error:'sign in required'},401,env);
        const q=(url.searchParams.get('q')||'').trim();
        const city=(url.searchParams.get('city')||'').trim();
        const classCode=(url.searchParams.get('class')||'').trim();
        const status=(url.searchParams.get('status')||'').trim();
        const limit=Number(url.searchParams.get('limit')||50);
        if(!q && !city && !classCode)return json({error:'Provide q, city, or class.'},400,env);
        const data=await rocSearch(env,{q,city,classCode,status,limit});
        return json({ok:true,count:data.results.length,meta:data.meta,results:data.results},200,env);
      }

      if(path==='/backfill-status'&&request.method==='GET'){
        const market=(url.searchParams.get('market')||'Phoenix').trim();
        if(market!=='Phoenix')return json({error:'Backfill status currently supports Phoenix.',supportedMarkets:['Phoenix']},400,env);
        const state=await phoenixBackfillState(env);
        return json({ok:true,...state},200,env);
      }
      if(path==='/backfill-preview'&&request.method==='GET'){
        const market=(url.searchParams.get('market')||'Phoenix').trim();
        const days=Math.max(30,Math.min(730,Number(url.searchParams.get('days')||180)));
        const limit=Math.max(100,Math.min(8000,Number(url.searchParams.get('limit')||5000)));
        if(market!=='Phoenix')return json({error:'Historical preview currently supports Phoenix first.',supportedMarkets:['Phoenix']},400,env);
        const data=await previewPhoenixHistoricalBackfill(env,{days,limit});
        return json(data,200,env);
      }
      if(path==='/historical-coverage'&&request.method==='GET'){
        const days=Math.max(90,Math.min(730,Number(url.searchParams.get('days')||730)));
        const data=await historicalCoverageReadiness(env,{days,rowLimit:12000});
        return json(data,200,env);
      }
      if(path==='/relationship-gap-candidates'&&request.method==='GET'){
        const days=Math.max(90,Math.min(730,Number(url.searchParams.get('days')||365)));
        const limit=Math.max(1,Math.min(25,Number(url.searchParams.get('limit')||12)));
        const data=await discoverRelationshipGapCandidates(env,{days,rowLimit:7500,limit});
        return json(data,200,env);
      }
      if(path==='/relationship-candidates'&&request.method==='GET'){
        const days=Math.max(90,Math.min(730,Number(url.searchParams.get('days')||365)));
        const limit=Math.max(3,Math.min(25,Number(url.searchParams.get('limit')||12)));
        const data=await discoverRelationshipCandidates(env,{days,rowLimit:7500,limit});
        return json(data,200,env);
      }
      if(path==='/relationship-health'&&request.method==='GET'){
        const company=(url.searchParams.get('company')||'').trim();
        const days=Math.max(90,Math.min(730,Number(url.searchParams.get('days')||365)));
        if(!company)return json({error:'company required'},400,env);
        const data=await buildRelationshipIntelligence(env,company,{days,rowLimit:5000});
        if(!data.ok)return json(data,400,env);
        return json({
          ok:true,
          company:data.company,
          days:data.days,
          historyFound:data.historyFound,
          projectCount:data.projectCount||0,
          permitLinkedRecordCount:data.permitLinkedRecordCount||0,
          latestActivity:data.latestActivity||null,
          companyMomentum:data.companyMomentum||null,
          expansionSignals:data.expansionSignals||null,
          relationshipSummary:data.relationshipSummary||null,
          historicalAssociations:(data.historicalAssociations||[]).slice(0,10),
          frequentlyAppearsWith:(data.frequentlyAppearsWith||[]).slice(0,10),
          relationshipGaps:(data.relationshipGaps||[]).slice(0,10),
          methodology:data.methodology||null
        },200,env);
      }
      if(path==='/relationships'&&request.method==='GET'){
        const session=await authUser(request,env);
        if(!session)return json({error:'sign in required'},401,env);
        const company=(url.searchParams.get('company')||'').trim();
        const days=Math.max(90,Math.min(730,Number(url.searchParams.get('days')||365)));
        if(!company)return json({error:'company required'},400,env);
        const data=await buildRelationshipIntelligence(env,company,{days,rowLimit:7500});
        return json(data,data.ok?200:400,env);
      }

      if(path==='/competitors'&&request.method==='GET'){
        const session=await authUser(request,env);
        if(!session)return json({error:'sign in required'},401,env);

        const days=Math.max(7,Math.min(365,Number(url.searchParams.get('days')||90)));
        const market=(url.searchParams.get('market')||'all').trim();
        const q=(url.searchParams.get('q')||'').trim().toLowerCase();
        const limit=Math.max(5,Math.min(100,Number(url.searchParams.get('limit')||30)));

        const where=["company IS NOT NULL","TRIM(company)<>''","LOWER(TRIM(company)) NOT IN ('not listed','unknown','n/a','none','null','owner','to be bid','tbd','to be determined','not provided','unassigned')","datetime(event_date)>=datetime('now',?)"];
        const binds=[`-${days} days`];
        if(market && market!=='all'){where.push("market=?");binds.push(market)}
        if(q){where.push("LOWER(company) LIKE ?");binds.push(`%${q}%`)}

        // Count the full matching company universe separately from the displayed page.
        // We canonicalize names before counting so obvious aliases do not inflate the hero metric.
        const distinctSql=`
          SELECT DISTINCT TRIM(company) AS company
          FROM leads
          WHERE ${where.join(' AND ')}
          LIMIT 2000`;
        const distinctRows=(await env.DB.prepare(distinctSql).bind(...binds).all()).results||[];
        const totalCanonical=new Set(
          distinctRows
            .map(x=>canonicalCompanyName(x.company))
            .filter(Boolean)
        );

        const sql=`
          SELECT
            TRIM(company) AS company,
            COUNT(*) AS permit_count,
            COUNT(DISTINCT market) AS market_count,
            GROUP_CONCAT(DISTINCT market) AS markets,
            SUM(CASE WHEN official_value IS NOT NULL THEN official_value ELSE 0 END) AS reported_value,
            SUM(CASE WHEN official_value IS NOT NULL THEN 1 ELSE 0 END) AS valued_permits,
            ROUND(AVG(score),1) AS avg_score,
            MAX(event_date) AS latest_activity
          FROM leads
          WHERE ${where.join(' AND ')}
          GROUP BY LOWER(TRIM(company))
          ORDER BY permit_count DESC, reported_value DESC, latest_activity DESC
          LIMIT ?`;

        let rows=(await env.DB.prepare(sql).bind(...binds,limit*3).all()).results||[];

        // Merge common aliases into a canonical company row.
        const merged=new Map();
        for(const r of rows){
          const canonical=canonicalCompanyName(r.company);
          const key=canonical.toLowerCase();
          let x=merged.get(key);
          if(!x){
            x={...r,company:canonical,aliases:new Set(),_rawNames:[]};
            x.permit_count=0;x.market_count=0;x.reported_value=0;x.valued_permits=0;x.avg_score_sum=0;x.avg_score_n=0;
            merged.set(key,x);
          }
          x.aliases.add(String(r.company));
          x._rawNames.push(String(r.company));
          x.permit_count+=Number(r.permit_count||0);
          x.reported_value+=Number(r.reported_value||0);
          x.valued_permits+=Number(r.valued_permits||0);
          const n=Number(r.permit_count||0);x.avg_score_sum+=Number(r.avg_score||0)*n;x.avg_score_n+=n;
          const mk=new Set(String(x.markets||'').split(',').filter(Boolean));String(r.markets||'').split(',').filter(Boolean).forEach(v=>mk.add(v));x.markets=[...mk].join(',');x.market_count=mk.size;
          if(String(r.latest_activity||'')>String(x.latest_activity||''))x.latest_activity=r.latest_activity;
        }
        rows=[...merged.values()].map(x=>({...x,avg_score:x.avg_score_n?x.avg_score_sum/x.avg_score_n:0,aliases:[...x.aliases]}));

        // Chandler Early Pipeline is not persisted into live leads.
        if(market==='all'||market==='Chandler'){
          try{
            const chRows=await fetchChandlerConstructionContractors(600);
            for(const x of chRows){
              if(q && !String(x.company).toLowerCase().includes(q))continue;
              const canonical=canonicalCompanyName(x.company);
              if(canonical)totalCanonical.add(canonical);
            }
            const grouped=new Map();
            for(const x of chRows){
              if(q && !String(x.company).toLowerCase().includes(q))continue;
              const canonical=canonicalCompanyName(x.company),key=canonical.toLowerCase();
              let g=grouped.get(key);
              if(!g){g={company:canonical,permit_count:0,market_count:1,markets:'Chandler',reported_value:0,valued_permits:0,avg_score:0,latest_activity:null,aliases:new Set(),_rawNames:[],_chandlerProjects:[]};grouped.set(key,g)}
              g.permit_count++;g.aliases.add(x.company);g._rawNames.push(x.company);g._chandlerProjects.push(x);
            }
            for(const g of grouped.values()){
              g.aliases=[...g.aliases];
              const existing=rows.find(r=>canonicalCompanyName(r.company)===g.company);
              if(existing){
                existing.permit_count=Number(existing.permit_count||0)+g.permit_count;
                const mk=new Set(String(existing.markets||'').split(',').filter(Boolean));mk.add('Chandler');existing.markets=[...mk].join(',');existing.market_count=mk.size;
                existing.aliases=[...new Set([...(existing.aliases||[]),...g.aliases])];
                existing._chandlerProjects=g._chandlerProjects;
              }else rows.push(g);
            }
          }catch(e){}
        }

        rows.sort((a,b)=>(Number(b.permit_count||0)-Number(a.permit_count||0))||(Number(b.reported_value||0)-Number(a.reported_value||0)));
        rows=rows.slice(0,limit);

        const companies=[];
        for(const row of rows){
          const rawNames=row._rawNames?.length?row._rawNames:[row.company];
          const ph=rawNames.map(()=>'?').join(',');
          const companyWhere=`LOWER(TRIM(company)) IN (${ph})`;
          const lowerNames=rawNames.map(v=>String(v).toLowerCase().trim());

          const history=(await env.DB.prepare(`
            SELECT id,name,address,event_date,market,permit,permit_status,official_value,score,temperature,scope,source,updated_at,company
            FROM leads
            WHERE ${companyWhere}
              AND datetime(event_date)>=datetime('now',?)
            ORDER BY datetime(event_date) DESC
            LIMIT 200
          `).bind(...lowerNames,`-${days} days`).all()).results||[];

          const prior=(await env.DB.prepare(`
            SELECT COUNT(*) AS n,
                   SUM(CASE WHEN official_value IS NOT NULL THEN official_value ELSE 0 END) AS value
            FROM leads
            WHERE ${companyWhere}
              AND datetime(event_date)<datetime('now',?)
              AND datetime(event_date)>=datetime('now',?)
          `).bind(...lowerNames,`-${days} days`,`-${days*2} days`).first())||{};

          const territories={};
          const projectMix={};
          const clusterKeys=new Set();
          let confTotal=0,confN=0;

          for(const x of history){
            territories[x.market]=(territories[x.market]||0)+1;
            const type=classifyProjectType(`${x.name||''} ${x.scope||''}`);
            projectMix[type]=(projectMix[type]||0)+1;
            const addr=normalizeAddressKey(x.address);
            clusterKeys.add(addr?`${x.market}|${addr}`:`id:${x.id}`);
            const dc=dataConfidence({company:x.company,officialValue:x.official_value,address:x.address,permit:x.permit,status:x.permit_status,scope:x.scope,source:x.source,market:x.market});
            confTotal+=dc.score;confN++;
          }

          const chandlerProjects=(row._chandlerProjects||[]).slice(0,20).map(x=>({
            id:`chandler-contractor:${x.id}`,name:x.project,address:'Chandler, AZ',date:null,market:'Chandler',permit:'—',
            permitStatus:x.status||x.phase||'Active project',officialValue:null,score:0,temperature:'',scope:[x.description,x.phase].filter(Boolean).join(' — '),
            source:x.source,updated_at:null,company:row.company
          }));
          if(chandlerProjects.length){
            territories.Chandler=(territories.Chandler||0)+chandlerProjects.length;
            for(const x of chandlerProjects){const type=classifyProjectType(`${x.name} ${x.scope}`);projectMix[type]=(projectMix[type]||0)+1;clusterKeys.add(`Chandler|${normalizeProjectName(x.name)}`)}
          }

          // V120: do not manufacture +100% growth when the prior comparison period has no records.
          // A zero baseline is "newly observed", not measurable percentage growth.
          const priorPermitCount=Number(prior.n||0);
          const priorReportedValue=Number(prior.value||0);
          const currentPermitCount=Number(row.permit_count||0);
          const currentReportedValue=Number(row.reported_value||0);
          const hasPermitTrendBaseline=priorPermitCount>0;
          const hasValueTrendBaseline=priorReportedValue>0;
          const permitTrend=hasPermitTrendBaseline?pctChange(currentPermitCount,priorPermitCount):null;
          const valueTrend=hasValueTrendBaseline?pctChange(currentReportedValue,priorReportedValue):null;
          const trendStatus=hasPermitTrendBaseline?'comparable':(currentPermitCount>0?'newly_observed':'no_activity');
          const sortedTerritories=Object.entries(territories).sort((a,b)=>b[1]-a[1]);
          const sortedMix=Object.entries(projectMix).sort((a,b)=>b[1]-a[1]);
          let competitiveSignal='Activity is stable in the selected period.';
          if(trendStatus==='newly_observed')competitiveSignal=`Newly observed activity in the selected ${days}-day period; no prior-period baseline is available yet.`;
          else if(permitTrend>=25)competitiveSignal=`Activity increased ${permitTrend}% versus the previous ${days}-day period.`;
          else if(permitTrend<=-25)competitiveSignal=`Activity decreased ${Math.abs(permitTrend)}% versus the previous ${days}-day period.`;
          if(hasPermitTrendBaseline && sortedTerritories.length>1 && sortedTerritories[0][1]===1)competitiveSignal=`New or limited activity detected across ${sortedTerritories.length} markets.`;

          const combinedRecent=[...history.slice(0,5),...chandlerProjects.slice(0,5)].slice(0,5);
          const roc=await rocMatchesForCompany(env,row.company,8);
          const mergedAliases=[...new Set([...(row.aliases||[row.company]),...(roc.licenses||[]).flatMap(x=>[x.business_name,x.dba]).filter(Boolean)])];
          companies.push({
            company:row.company,
            aliases:mergedAliases,
            entityMatchConfidence:roc.verified?(roc.matchConfidence||98):((row.aliases||[]).length>1?92:98),
            roc:{verified:roc.verified,matchConfidence:roc.matchConfidence,licenseCount:roc.licenseCount||0,licenses:roc.licenses||[],trades:roc.trades||[],sourceAsOf:roc.meta?.source_as_of||null},
            permitCount:Number(row.permit_count||0),
            activeProjects:clusterKeys.size,
            marketCount:Object.keys(territories).length||Number(row.market_count||0),
            markets:Object.keys(territories).length?Object.keys(territories):String(row.markets||'').split(',').filter(Boolean),
            territories:sortedTerritories.map(([name,count])=>({name,count,share:Math.round(count/Math.max(1,(history.length+chandlerProjects.length))*100)})),
            projectMix:sortedMix.map(([name,count])=>({name,count,share:Math.round(count/Math.max(1,(history.length+chandlerProjects.length))*100)})),
            reportedValue:Number(row.reported_value||0),
            valuedPermits:Number(row.valued_permits||0),
            avgScore:Number(row.avg_score||0),
            avgConfidence:confN?Math.round(confTotal/confN):null,
            latestActivity:row.latest_activity,
            permitTrend,
            valueTrend,
            trendStatus,
            priorPeriodPermitCount:priorPermitCount,
            priorPeriodReportedValue:priorReportedValue,
            competitiveSignal,
            recentProjects:combinedRecent.map(x=>{
              const confidence=dataConfidence({company:x.company||row.company,officialValue:x.official_value??x.officialValue,address:x.address,permit:x.permit,status:x.permit_status||x.permitStatus,scope:x.scope,source:x.source,market:x.market});
              return {
                id:x.id,name:x.name,address:x.address,date:x.event_date||x.date,market:x.market,permit:x.permit,
                permitStatus:x.permit_status||x.permitStatus,officialValue:(x.official_value??x.officialValue)==null?null:Number(x.official_value??x.officialValue),
                score:Number(x.score||0),temperature:x.temperature,scope:x.scope,source:x.source,
                confidence:confidence.score,lifecycle:lifecycleFrom({text:`${x.name||''} ${x.scope||''}`,status:x.permit_status||x.permitStatus}),
                checkedAt:x.updated_at||null
              };
            })
          });
        }

        return json({
          ok:true,
          days,
          market,
          query:q,
          count:companies.length,
          totalCount:totalCanonical.size,
          maxDisplay:100,
          hasMore:companies.length<Math.min(totalCanonical.size,100),
          note:'Company attribution reflects the entity published by the source jurisdiction. It does not necessarily indicate a bid winner.',
          companies
        },200,env);
      }

      if(path==='/admin/alerts-preview'&&request.method==='GET'){
        const token=(request.headers.get('authorization')||'').replace(/^Bearer\s+/i,'');
        if(!env.ADMIN_TOKEN||token!==env.ADMIN_TOKEN)return json({error:'unauthorized'},401,env);

        const email=normalizeEmail(url.searchParams.get('email')||'');
        const plan=(url.searchParams.get('plan')||'').trim();
        if(!validEmail(email))return json({error:'valid email required'},400,env);

        const user=await env.DB.prepare('SELECT * FROM users WHERE email=?').bind(email).first();
        if(!user)return json({error:'user not found'},404,env);

        const forcePlan=PLANS[plan]?plan:null;
        const pack=await alertCandidates(env,user,{
          forcePlan,
          ignoreSchedule:true,
          scheduledDate:new Date(),
          limit:20
        });

        return json({
          ok:true,
          mode:'preview only — no email sent and no alert_log rows written',
          email:user.email,
          plan:pack.effective,
          rule:pack.rule,
          preferences:pack.prefs,
          count:pack.leads.length,
          leads:pack.leads.map(x=>({
            id:x.id,
            market:x.market,
            score:x.score,
            temperature:x.temperature,
            name:x.name,
            address:x.address,
            categories:x.categories,
            value:x.value,
            date:x.date
          }))
        },200,env);
      }

      if(path==='/admin/alerts-test'&&request.method==='POST'){
        const token=(request.headers.get('authorization')||'').replace(/^Bearer\s+/i,'');
        if(!env.ADMIN_TOKEN||token!==env.ADMIN_TOKEN)return json({error:'unauthorized'},401,env);

        const body=await request.json();
        const accountEmail=normalizeEmail(body.accountEmail||body.email||'');
        const to=normalizeEmail(body.to||accountEmail);
        const plan=String(body.plan||'').trim();

        if(!validEmail(accountEmail))return json({error:'valid accountEmail required'},400,env);
        if(!validEmail(to))return json({error:'valid to email required'},400,env);

        const user=await env.DB.prepare('SELECT * FROM users WHERE email=?').bind(accountEmail).first();
        if(!user)return json({error:'account user not found'},404,env);

        const forcePlan=PLANS[plan]?plan:null;
        const pack=await alertCandidates(env,user,{
          forcePlan,
          ignoreSchedule:true,
          scheduledDate:new Date(),
          limit:20
        });

        if(!pack.leads.length)return json({
          ok:true,
          sent:0,
          message:'No matching leads for this account/preferences in the alert window.',
          plan:pack.effective,
          rule:pack.rule,
          preferences:pack.prefs
        },200,env);

        const result=await sendAlertBatch(env,user,pack.prefs,pack.leads,`TEST ${pack.rule.label}`,{
          toOverride:to,
          markSent:false
        });

        return json({
          ok:true,
          test:true,
          to,
          accountEmail:user.email,
          plan:pack.effective,
          matched:pack.leads.length,
          sent:result.sent||0,
          note:'Test mode does not write alert_log, so production deduplication is unaffected.'
        },200,env);
      }

      if(path==='/admin/tucson-debug'&&request.method==='GET'){
        const token=(request.headers.get('authorization')||'').replace(/^Bearer\s+/i,'');
        if(!env.ADMIN_TOKEN||token!==env.ADMIN_TOKEN)return json({error:'unauthorized'},401,env);
        const data=await tucsonDebug(env);
        return json({ok:true,now:nowIso(),...data},200,env);
      }
      if(path==='/changes-teaser'&&request.method==='GET'){
        const r=await env.DB.prepare(`
          SELECT * FROM leads
          WHERE (
            (market='Phoenix' AND datetime(event_date) >= datetime(date('now','-7 hours','-1 day'),'+7 hours'))
            OR
            (market<>'Phoenix' AND date(event_date) >= date('now','-7 hours','-1 day'))
          )
            AND score>=40
          ORDER BY event_date DESC
          LIMIT 1500
        `).all();
        const clustered=clusterLeads((r.results||[]).map(hydrateStoredLead));
        const byMarket={};
        for(const x of clustered){
          const market=x.market||marketFromSource(x.source)||'Unknown';
          byMarket[market]=(byMarket[market]||0)+1;
        }
        return json({
          ok:true,
          window:'since_yesterday_arizona',
          minimumScore:40,
          opportunities:clustered.length,
          hot:clustered.filter(x=>Number(x.score)>=75).length,
          markets:byMarket,
          message:'Aggregate public teaser only. Sign-in is required for personalized change details.',
          generatedAt:nowIso()
        },200,env);
      }
      if(path==='/temperature-calibration'&&request.method==='GET'){
        const days=clamp(Number(url.searchParams.get('days')||7),1,30);
        const limit=clamp(Number(url.searchParams.get('limit')||300),25,500);
        const candidateHot=clamp(Number(url.searchParams.get('candidateHot')||75),65,79);
        const rows=(await stored(env,limit,days))||[];
        const production={HOT:0,WARM:0,WATCH:0,LOW:0};
        const candidate={HOT:0,WARM:0,WATCH:0,LOW:0};
        const promoted=[];
        let promotedTotal=0;
        const byMarket={};
        for(const x of rows){
          const score=Number(x.score||0);
          const p=score>=75?'HOT':score>=60?'WARM':score>=40?'WATCH':'LOW';
          const c=score>=candidateHot?'HOT':score>=60?'WARM':score>=40?'WATCH':'LOW';
          production[p]++;
          candidate[c]++;
          const market=x.market||marketFromSource(x.source)||'Unknown';
          byMarket[market] ||= {count:0,productionHot:0,candidateHot:0,promoted:0};
          byMarket[market].count++;
          if(p==='HOT')byMarket[market].productionHot++;
          if(c==='HOT')byMarket[market].candidateHot++;
          if(p!=='HOT'&&c==='HOT'){
            promotedTotal++;
            byMarket[market].promoted++;
            if(promoted.length<20)promoted.push({
              id:x.id,
              market,
              score,
              name:x.name,
              company:cleanCompanyName(x.company),
              confidence:Number(x.dataConfidence?.score||0),
              status:x.permitStatus||x.permit_status||null
            });
          }
        }
        return json({
          ok:true,
          mode:'shadow_only',
          productionUnchanged:true,
          days,
          sampleCount:rows.length,
          productionThresholds:{HOT:75,WARM:60,WATCH:40},
          candidateThresholds:{HOT:candidateHot,WARM:60,WATCH:40},
          production,
          candidate,
          productionHotShare:rows.length?Number((production.HOT/rows.length).toFixed(3)):0,
          candidateHotShare:rows.length?Number((candidate.HOT/rows.length).toFixed(3)):0,
          promotedCount:promotedTotal,
          byMarket,
          promotedExamples:promoted,
          caution:'This endpoint compares labels only. It does not alter scores, rankings, production temperatures, alerts, or user feeds.',
          generatedAt:nowIso()
        },200,env);
      }

      if(path==='/score-audit'&&request.method==='GET'){
        const days=clamp(Number(url.searchParams.get('days')||30),1,90);
        const limit=clamp(Number(url.searchParams.get('limit')||300),25,500);
        const audit=await scoringAudit(env,{days,limit});
        return json({ok:true,...audit},200,env);
      }

      if(path==='/tempe-enrichment-preview'&&request.method==='GET'){
        const permit=(url.searchParams.get('permit')||'').trim().toUpperCase();
        if(!permit)return json({error:'permit is required',example:'BP261214'},400,env);
        try{
          const rows=await fetchTempe(30,700);
          const sourceRow=rows.find(x=>String(x.permit||'').trim().toUpperCase()===permit)||null;

          const api=await fetchTempeAccelaApiRecord(permit);
          let detail=null;
          let sourcePath='accela_v4_api';

          if(api.ok){
            detail={
              contractor:api.contractor,
              contractorLicense:api.contractorLicense,
              officialValuation:api.officialValuation,
              status:api.status,
              projectDescription:api.description,
              detailUrl:null
            };
          }else{
            sourcePath='citizen_access_fallback';
            try{
              detail=await fetchTempeCitizenDetailByPermit(permit);
            }catch(citizenError){
              return json({
                ok:false,
                mode:'preview_only',
                market:'Tempe',
                permit,
                sourcePath:'no_server_side_path_yet',
                accelaApiAttempts:api.attempts,
                citizenAccessError:String(citizenError?.message||citizenError),
                openData:{
                  found:Boolean(sourceRow),
                  company:sourceRow?.company||'Not listed',
                  estimatedOpportunity:sourceRow?.value||null,
                  status:sourceRow?.permitStatus||null,
                  name:sourceRow?.name||null
                },
                finding:'The City permit is visible in the public browser UI, but neither the official Accela API attempt nor the server-side Citizen Access postback returned the record from the Worker.',
                caution:'Preview only. No D1 rows, scores, temperatures, or opportunity values were changed.',
                generatedAt:nowIso()
              },200,env);
            }
          }

          return json({
            ok:true,
            mode:'preview_only',
            market:'Tempe',
            permit,
            sourcePath,
            openData:{
              found:Boolean(sourceRow),
              company:sourceRow?.company||'Not listed',
              estimatedOpportunity:sourceRow?.value||null,
              status:sourceRow?.permitStatus||null,
              name:sourceRow?.name||null
            },
            enrichedSource:{
              contractor:detail?.contractor||null,
              contractorLicense:detail?.contractorLicense||null,
              officialValuation:detail?.officialValuation||null,
              status:detail?.status||null,
              projectDescription:detail?.projectDescription||null,
              detailUrl:detail?.detailUrl||null
            },
            enrichmentDecision:{
              canPromoteCompany:Boolean(detail?.contractor&&isMeaningfulCompanyName(detail.contractor)),
              canUseOfficialValuation:Number.isFinite(Number(detail?.officialValuation))&&Number(detail?.officialValuation)>0,
              proposedCompany:detail?.contractor&&isMeaningfulCompanyName(detail.contractor)?detail.contractor:null,
              proposedOfficialValuation:Number.isFinite(Number(detail?.officialValuation))&&Number(detail?.officialValuation)>0?Number(detail.officialValuation):null
            },
            accelaApiAttempts:api.attempts,
            caution:'Preview only. No D1 rows, scores, temperatures, or opportunity values are changed by this endpoint.',
            generatedAt:nowIso()
          },200,env);
        }catch(e){
          return json({ok:false,mode:'preview_only',market:'Tempe',permit,error:String(e?.message||e),generatedAt:nowIso()},200,env);
        }
      }

      if(path==='/attribution-health'&&request.method==='GET'){
        const market=(url.searchParams.get('market')||'').trim();
        const days=clamp(Number(url.searchParams.get('days')||7),1,30);
        if(!['Tempe','Tucson'].includes(market))return json({error:'attribution health market not supported',supported:['Tempe','Tucson']},400,env);

        if(market==='Tempe'){
          try{
            const rows=await fetchTempe(days,700);
            const listed=rows.filter(x=>isMeaningfulCompanyName(x.company));
            return json({
              ok:true,
              market:'Tempe',
              days,
              source:'City of Tempe Building Safety — building permits / Accela open-data extract',
              records:rows.length,
              listed:listed.length,
              notListed:Math.max(0,rows.length-listed.length),
              listedShare:rows.length?Number((listed.length/rows.length).toFixed(3)):0,
              attributionField:'ContractorCompanyName',
              policy:'RevenueTrigger only marks a Tempe permit Listed when the city-published ContractorCompanyName field contains a meaningful company identity. ProjectName is kept as the project title and is not promoted to contractor/company attribution.',
              generatedAt:nowIso()
            },200,env);
          }catch(e){
            return json({ok:false,market:'Tempe',error:String(e?.message||e),generatedAt:nowIso()},200,env);
          }
        }

        const r=env.DB?await env.DB.prepare(`
          SELECT permit,name,address,event_date,company
          FROM leads
          WHERE market='Tucson' AND datetime(event_date)>=datetime('now',?)
          ORDER BY datetime(event_date) DESC
          LIMIT 30
        `).bind(`-${days} days`).all():{results:[]};
        const storedRows=r.results||[];
        const permits=[...new Set(storedRows.map(x=>String(x.permit||'').trim()).filter(Boolean))].slice(0,20);
        const detailRows=[];
        const detailErrors=[];
        for(let i=0;i<permits.length;i+=5){
          const batch=await Promise.all(permits.slice(i,i+5).map(async permit=>{
            try{return await fetchTucsonPermitDetail(permit)}
            catch(e){detailErrors.push({permit,error:String(e?.message||e)});return null}
          }));
          detailRows.push(...batch.filter(Boolean));
          if(i+5<permits.length)await sleep(150);
        }
        const businessApplicants=detailRows.filter(x=>x.businessApplicant).map(x=>({permit:x.permit,company:x.businessApplicant}));
        const personOrUnclassified=detailRows.filter(x=>x.applicant&&!x.businessApplicant).length;
        return json({
          ok:true,
          market:'Tucson',
          days,
          source:'City of Tucson Property Research Online (PRO) permit details',
          storedRecords:storedRows.length,
          permitDetailsChecked:detailRows.length,
          businessApplicants,
          businessApplicantCount:businessApplicants.length,
          personOrUnclassifiedApplicantCount:personOrUnclassified,
          missingApplicantCount:detailRows.filter(x=>!x.applicant).length,
          detailErrors:detailErrors.slice(0,5),
          policy:'RevenueTrigger promotes the source-published Applicant to Company on permit only when the Applicant text itself clearly identifies an organization. Individual applicant names are deliberately not converted into companies.',
          generatedAt:nowIso()
        },200,env);
      }
      if(path==='/tucson-recheck-preview'&&request.method==='GET'){
        const days=clamp(Number(url.searchParams.get('days')||30),7,90);
        const limit=clamp(Number(url.searchParams.get('limit')||20),1,40);
        const result=env.DB?await env.DB.prepare(`
          SELECT permit,name,address,event_date,company,permit_status,score,updated_at
          FROM leads
          WHERE market='Tucson'
            AND datetime(event_date)>=datetime('now',?)
          ORDER BY datetime(event_date) DESC
          LIMIT ?
        `).bind(`-${days} days`,limit).all():{results:[]};

        const storedRows=(result.results||[]).filter(row=>!isMeaningfulCompanyName(row.company));
        const checked=[];
        const errors=[];

        for(let i=0;i<storedRows.length;i+=5){
          const batch=await Promise.all(storedRows.slice(i,i+5).map(async row=>{
            const permit=String(row.permit||'').trim();
            try{
              const [activity,detail]=await Promise.all([
                fetchTucsonPermit(permit),
                fetchTucsonPermitDetail(permit)
              ]);
              const currentStatus=String(activity?.status||detail?.status||'').trim()||null;
              const storedStatus=String(row.permit_status||'').trim()||null;
              const businessApplicant=detail?.businessApplicant||null;
              const statusChanged=Boolean(currentStatus&&storedStatus&&currentStatus.toLowerCase()!==storedStatus.toLowerCase());
              const laterStage=Boolean(currentStatus&&!/submitted|application received/i.test(currentStatus));
              return {
                permit,
                storedStatus,
                currentStatus,
                statusChanged,
                laterStage,
                applicant:detail?.applicant||null,
                businessApplicant,
                canPromoteCompany:Boolean(businessApplicant),
                storedScore:Number(row.score||0),
                eventDate:row.event_date,
                lastStoredRefresh:row.updated_at
              };
            }catch(e){
              errors.push({permit,error:String(e?.message||e)});
              return null;
            }
          }));
          checked.push(...batch.filter(Boolean));
          if(i+5<storedRows.length)await sleep(150);
        }

        const promotable=checked.filter(x=>x.canPromoteCompany);
        const advanced=checked.filter(x=>x.statusChanged||x.laterStage);
        return json({
          ok:true,
          mode:'preview_only',
          market:'Tucson',
          days,
          storedNotListedExamined:storedRows.length,
          permitDetailsChecked:checked.length,
          statusChangedCount:checked.filter(x=>x.statusChanged).length,
          laterStageCount:checked.filter(x=>x.laterStage).length,
          businessApplicantCount:promotable.length,
          promotableCompanies:promotable.map(x=>({permit:x.permit,company:x.businessApplicant,currentStatus:x.currentStatus})),
          advancedCandidates:advanced.slice(0,20),
          checked,
          errors:errors.slice(0,10),
          policy:'A Tucson record becomes Listed only when the City of Tucson public permit detail explicitly publishes an organization in the Applicant field. Individual names remain Not Listed. This endpoint does not write to D1.',
          generatedAt:nowIso()
        },200,env);
      }

      if(path==='/source-health'&&request.method==='GET'){
        const market=(url.searchParams.get('market')||'').trim();
        const days=clamp(Number(url.searchParams.get('days')||7),1,90);
        if(market==='Chandler'){
          try{
            const d=await chandlerAccelaDebug(days);
            const permitSignals=await fetchChandlerAccelaPermits(days,500);
            const clustered=clusterLeads(permitSignals);
            const genericAddressSignals=permitSignals.filter(x=>!usableClusterAddress(x)).length;
            const listedSignals=permitSignals.filter(x=>cleanCompanyName(x.company)).length;
            const listedOpportunities=clustered.filter(x=>cleanCompanyName(x.company)).length;
            return json({
              ok:true,market:'Chandler',status:'live',days,
              source:'City of Chandler Accela permit layer — official ArcGIS',
              fetched:d.fetched,recent:d.recent,newest:d.newest,oldestFetched:d.oldestFetched,coverage:d.coverage,
              opportunityView:{
                permitSignals:permitSignals.length,
                genericAddressSignals,
                clusteredOpportunities:clustered.length,
                listedSignals,
                listedOpportunities,
                notListedOpportunities:Math.max(0,clustered.length-listedOpportunities)
              },
              generatedAt:nowIso()
            },200,env);
          }catch(e){
            const storedStats=env.DB?await env.DB.prepare(`
              SELECT COUNT(*) AS rows,COUNT(DISTINCT permit) AS permits,MAX(updated_at) AS last_refresh,MAX(event_date) AS newest_activity
              FROM leads
              WHERE market='Chandler' AND datetime(event_date)>=datetime('now',?)
            `).bind(`-${days} days`).first():null;
            return json({
              ok:false,
              market:'Chandler',
              status:'degraded',
              days,
              source:'City of Chandler Accela permit layer — official ArcGIS',
              error:String(e?.message||e),
              storedFallback:{
                rows:Number(storedStats?.rows||0),
                permits:Number(storedStats?.permits||0),
                lastRefresh:storedStats?.last_refresh||null,
                newestActivity:storedStats?.newest_activity||null
              },
              message:'The City of Chandler ArcGIS query service is temporarily unavailable. RevenueTrigger is preserving the last successfully stored permit snapshot rather than inventing fresh source data.',
              generatedAt:nowIso()
            },200,env);
          }
        }
        if(market==='Scottsdale'){
          const d=await scottsdaleDebug(days);
          const permitSignals=await fetchScottsdale(days,500);
          const clustered=clusterLeads(permitSignals);
          return json({
            ok:true,market:'Scottsdale',status:SOURCE_STATUS.Scottsdale.status,days,
            source:'City of Scottsdale Building Permit Reports — official CSV',
            requested:d.requested,http:d.http,parsed:d.parsed,issueDates:d.issueDates,
            opportunityView:{permitSignals:permitSignals.length,clusteredOpportunities:clustered.length},
            generatedAt:nowIso()
          },200,env);
        }
        return json({error:'source health market not supported',supported:['Chandler','Scottsdale']},400,env);
      }
      if(path==='/admin/scottsdale-debug'&&request.method==='GET'){
        const token=(request.headers.get('authorization')||'').replace(/^Bearer\s+/i,'');
        if(!env.ADMIN_TOKEN||token!==env.ADMIN_TOKEN)return json({error:'unauthorized'},401,env);
        const days=clamp(Number(url.searchParams.get('days')||7),1,30);
        const data=await scottsdaleDebug(days);
        return json({ok:true,now:nowIso(),...data},200,env);
      }
      if(path==='/admin/chandler-permits-debug'&&request.method==='GET'){
        const token=(request.headers.get('authorization')||'').replace(/^Bearer\s+/i,'');
        if(!env.ADMIN_TOKEN||token!==env.ADMIN_TOKEN)return json({error:'unauthorized'},401,env);
        const days=clamp(Number(url.searchParams.get('days')||30),1,90);
        const data=await chandlerAccelaDebug(days);
        return json({ok:true,now:nowIso(),source:'City of Chandler Accela permit layer',...data},200,env);
      }
      if(path==='/sources'&&request.method==='GET')return json({markets:SOURCE_STATUS,liveMarkets:LIVE_MARKETS,plannedMarkets:MARKETS.filter(m=>!LIVE_MARKETS.includes(m)),generatedAt:nowIso()},200,env);
      if(path==='/pipeline'&&request.method==='GET'){
        const pipelineUser=await authUser(request,env);
        const market=(url.searchParams.get('market')||'Chandler').trim();
        if(market!=='Chandler')return json({error:'pipeline market not supported'},400,env);

        const [settled,contractorResult]=await Promise.all([
          Promise.allSettled([
            chandlerLayer(20,'PRE-TECH',200),
            chandlerLayer(19,'APPROVED PROJECTS',300)
          ]),
          fetchChandlerConstructionContractors(600).then(v=>({ok:true,rows:v})).catch(e=>({ok:false,rows:[],error:String(e?.message||e)}))
        ]);

        const permitNumbers=[];
        for(const r of settled){
          if(r.status!=='fulfilled')continue;
          for(const item of r.value||[]){
            const a=item.a||{};
            const permit=String(a.PRE_B1_ALT_ID||a.CIV_F_B1_ALT_ID||'').trim();
            if(permit)permitNumbers.push(permit);
          }
        }
        const accelaResult=await fetchChandlerAccelaByPermits(permitNumbers)
          .then(v=>({ok:true,rows:v}))
          .catch(e=>({ok:false,rows:[],error:String(e?.message||e)}));

        const contractorIndex=buildChandlerContractorIndex(contractorResult.rows||[]);
        const accelaIndex=buildChandlerAccelaIndex(accelaResult.rows||[]);
        const pipeline=[],stages={};

        settled.forEach((r,i)=>{
          const stage=['PRE-TECH','APPROVED PROJECTS'][i];
          if(r.status!=='fulfilled'){
            stages[stage]={ok:false,error:String(r.reason?.message||r.reason)};
            return;
          }

          stages[stage]={ok:true,count:r.value.length};

          for(const item of r.value){
            const a=item.a||{};
            let permit,project,desc,type,date,status;

            if(stage==='PRE-TECH'){
              permit=String(a.PRE_B1_ALT_ID||'').trim();
              project=a.PRE_PROJ_NM||'Chandler pre-tech project';
              desc=a.PRE_DTL_DESC||'';
              type=a.ACCELA_PERMIT_TYPE||'PRE-TECH';
              date=null;
              status='Pre-Tech';
            }else{
              permit=String(a.CIV_F_B1_ALT_ID||'').trim();
              project=a.CIV_F_PROJ_NM||'Chandler approved project';
              desc=a.CIV_F_DTL_DESC||'';
              type=a.CIV_F_PERM_TYPE||a.ACCELA_PERMIT_TYPE||'Approved Project';
              date=a.CIV_F_APPRV_DT||null;
              status='Approved';
            }

            const text=[project,type,desc].filter(Boolean).join(' — ');
            const accelaMatch=matchChandlerAccelaRecord(permit,project,accelaIndex);
            const accelaParticipant=accelaMatch?chandlerAccelaParticipant(accelaMatch.row):null;
            if(accelaParticipant&&accelaMatch){
              accelaParticipant.matchType=`accela-${accelaMatch.matchType}`;
              accelaParticipant.matchConfidence=accelaMatch.matchConfidence;
            }
            const directParticipant=chandlerParticipantFromAttributes(a);
            const matchedContractor=matchChandlerContractor(project,contractorIndex);
            const participant=accelaParticipant || directParticipant || (matchedContractor?{
              company:matchedContractor.company,
              role:matchedContractor.role,
              field:'GPS_CONTRACTOR_NAME',
              matchType:matchedContractor.matchType||'project',
              matchConfidence:matchedContractor.matchConfidence||null
            }:null);
            const model=opportunityScorePipelineV2({
              text,
              status,
              date:date||null,
              officialValue:null,
              address:'Chandler, AZ',
              company:participant?.company||'',
              sourceFresh:true
            });

            pipeline.push({
              id:`pipeline:chandler:${stage}:${permit||a.OBJECTID}`,
              market:'Chandler',
              stage,
              permit:permit||'—',
              name:project,
              address:'Chandler, AZ',
              date:date||null,
              permitStatus:status,
              scope:text,
              company:participant?.company||null,
              companyRole:participant?.role||null,
              companySourceField:participant?.field||null,
              companyMatchType:participant?.matchType||(directParticipant?'direct-source-field':null),
              companyMatchConfidence:participant?.matchConfidence||(directParticipant?1:null),
              companyProvenance:accelaParticipant?'City of Chandler Accela permit record':(directParticipant?'City of Chandler DSActiveProjects':(matchedContractor?'City of Chandler GPS Construction Projects':null)),
              score:model.score,
              scoreBreakdown:model.breakdown,
              sellerFit:model.sellerFit,
              categories:classify(text),
              temperature:model.temperature,
              scoreVersion:'pipeline-v2',
              timingBasis:model.diagnostics?.recencyBasis||'event-date',
              source:`City of Chandler DSActiveProjects — ${stage}`
            });
          }
        });

        const availableStageCount=Object.values(stages).filter(x=>x?.ok).length;
        const pipelineSourceStatus=availableStageCount===0?'unavailable':availableStageCount<2?'degraded':'live';
        const pipelineSourceMessage=pipelineSourceStatus==='unavailable'
          ?'City of Chandler Early Pipeline is temporarily unavailable because the city\'s ArcGIS query service is failing. RevenueTrigger will not substitute live permit records for pre-construction pipeline signals.'
          :pipelineSourceStatus==='degraded'
            ?'One City of Chandler Early Pipeline stage is temporarily unavailable; available stage data is shown below.'
            :null;

        if(pipelineSourceStatus==='unavailable'){
          if(!pipelineUser)return json({ok:false,market:'Chandler',sourceStatus:pipelineSourceStatus,count:0,publicPreview:true,publicAvailable:0,message:pipelineSourceMessage,pipeline:[],generatedAt:nowIso()},200,env);
          return json({
            ok:false,
            market:'Chandler',
            sourceStatus:pipelineSourceStatus,
            count:0,
            stages,
            contractorSource:{
              ok:contractorResult.ok,
              count:(contractorResult.rows||[]).length,
              error:contractorResult.error||null
            },
            accelaPermitSource:{
              ok:accelaResult.ok,
              requestedStageReferences:permitNumbers.length,
              uniqueRequestedPermits:new Set(permitNumbers.map(x=>String(x||'').trim()).filter(Boolean)).size,
              matchedRecords:(accelaResult.rows||[]).length,
              error:accelaResult.error||null
            },
            message:pipelineSourceMessage,
            pipeline:[],
            generatedAt:nowIso()
          },200,env);
        }

        const seen=new Map();
        for(const x of pipeline){
          const key=(x.permit&&x.permit!=='—')
            ? String(x.permit).toLowerCase()
            : `${x.stage}|${x.name}`.toLowerCase();
          const prev=seen.get(key);
          if(!prev || x.score>prev.score)seen.set(key,x);
        }

        const rows=[...seen.values()]
          .sort((a,b)=>(b.score-a.score)||String(b.date||'').localeCompare(String(a.date||'')))
          .slice(0,300);

        const uniqueRequestedPermits=new Set(permitNumbers.map(x=>String(x||'').trim()).filter(Boolean)).size;
        const participantStats={listed:0,notListed:0,accela:0,direct:0,projectFallback:0};
        for(const x of rows){
          if(x.company){
            participantStats.listed++;
            if(String(x.companyProvenance||'').includes('Accela permit record'))participantStats.accela++;
            else if(String(x.companyProvenance||'').includes('DSActiveProjects'))participantStats.direct++;
            else if(String(x.companyProvenance||'').includes('GPS Construction Projects'))participantStats.projectFallback++;
          }else participantStats.notListed++;
        }
        participantStats.listedShare=rows.length?Number((participantStats.listed/rows.length).toFixed(3)):0;

        if(!pipelineUser){
          return json({
            ok:true,
            market:'Chandler',
            sourceStatus:pipelineSourceStatus,
            count:rows.length,
            publicPreview:true,
            publicAvailable:rows.length,
            pipeline:rows.slice(0,3).map(publicOpportunityTeaser),
            generatedAt:nowIso()
          },200,env);
        }

        // V111 diagnostic-only shadow scoring for Early Pipeline. Production scores
        // remain unchanged. This specifically measures the two V110 safeguards in
        // the place where they matter most: PRE-TECH rows with no reliable date.
        const bucket=score=>temperatureForScore(Number(score||0));
        const productionBuckets={HOT:0,WARM:0,WATCH:0,LOW:0};
        const candidateBuckets={HOT:0,WARM:0,WATCH:0,LOW:0};
        const movement={scoreUp:0,scoreDown:0,scoreSame:0,temperatureUp:0,temperatureDown:0,temperatureSame:0,missingDateRecords:0,lifecycleCapRecords:0};
        const rank={LOW:0,WATCH:1,WARM:2,HOT:3};
        const byStage={};
        const comparisons=[];
        for(const x of rows){
          const prodScore=Number(x.score||0);
          const prodTemp=bucket(prodScore);
          const cand=opportunityScoreCandidate({
            text:x.scope||x.name||'',
            status:x.permitStatus||x.stage||'',
            date:x.date||null,
            officialValue:null,
            address:x.address||'',
            company:x.company||''
          });
          const candScore=Number(cand.score||0);
          const candTemp=bucket(candScore);
          productionBuckets[prodTemp]=(productionBuckets[prodTemp]||0)+1;
          candidateBuckets[candTemp]=(candidateBuckets[candTemp]||0)+1;
          if(candScore>prodScore)movement.scoreUp++; else if(candScore<prodScore)movement.scoreDown++; else movement.scoreSame++;
          if(rank[candTemp]>rank[prodTemp])movement.temperatureUp++; else if(rank[candTemp]<rank[prodTemp])movement.temperatureDown++; else movement.temperatureSame++;
          if(!cand.diagnostics?.hasValidDate)movement.missingDateRecords++;
          if(Number(cand.diagnostics?.lifecycleCapApplied||0)>0)movement.lifecycleCapRecords++;
          const stage=x.stage||'UNKNOWN';
          byStage[stage] ||= {count:0,productionAvg:0,candidateAvg:0,productionBuckets:{HOT:0,WARM:0,WATCH:0,LOW:0},candidateBuckets:{HOT:0,WARM:0,WATCH:0,LOW:0},_prod:0,_cand:0};
          const st=byStage[stage];
          st.count++; st._prod+=prodScore; st._cand+=candScore; st.productionBuckets[prodTemp]++; st.candidateBuckets[candTemp]++;
          comparisons.push({
            permit:x.permit,name:x.name,stage,hasDate:!!x.date,
            productionScore:prodScore,productionTemperature:prodTemp,
            candidateScore:candScore,candidateTemperature:candTemp,
            delta:candScore-prodScore,
            candidateBreakdown:cand.breakdown,
            diagnostics:cand.diagnostics
          });
        }
        for(const st of Object.values(byStage)){
          st.productionAvg=st.count?Number((st._prod/st.count).toFixed(1)):0;
          st.candidateAvg=st.count?Number((st._cand/st.count).toFixed(1)):0;
          delete st._prod; delete st._cand;
        }
        movement.avgDelta=rows.length?Number((comparisons.reduce((n,x)=>n+x.delta,0)/rows.length).toFixed(2)):0;
        const biggestDrops=[...comparisons].sort((a,b)=>a.delta-b.delta).slice(0,12);

        // V112 balanced shadow: missing event dates use modest fresh-source credit (10)
        // and lifecycle/pre-permit is capped at 32. Still diagnostic only.
        const v112Buckets={HOT:0,WARM:0,WATCH:0,LOW:0};
        const v112Movement={scoreUp:0,scoreDown:0,scoreSame:0,temperatureUp:0,temperatureDown:0,temperatureSame:0,missingDateRecords:0,sourceFreshnessFallbackRecords:0,lifecycleCapRecords:0,totalDelta:0};
        const v112Comparisons=[];
        const v112ByStage={};
        for(const x of rows){
          const prodScore=Number(x.score||0);
          const prodTemp=bucket(prodScore);
          const cand=opportunityScorePipelineCandidateV112({
            text:x.scope||x.name||'',
            status:x.permitStatus||x.stage||'',
            date:x.date||null,
            officialValue:null,
            address:x.address||'',
            company:x.company||'',
            sourceFresh:true
          });
          const candScore=Number(cand.score||0);
          const candTemp=bucket(candScore);
          v112Buckets[candTemp]=(v112Buckets[candTemp]||0)+1;
          if(candScore>prodScore)v112Movement.scoreUp++; else if(candScore<prodScore)v112Movement.scoreDown++; else v112Movement.scoreSame++;
          if(rank[candTemp]>rank[prodTemp])v112Movement.temperatureUp++; else if(rank[candTemp]<rank[prodTemp])v112Movement.temperatureDown++; else v112Movement.temperatureSame++;
          if(!cand.diagnostics?.hasValidDate)v112Movement.missingDateRecords++;
          if(cand.diagnostics?.recencyBasis==='fresh-source-snapshot')v112Movement.sourceFreshnessFallbackRecords++;
          if(Number(cand.diagnostics?.lifecycleCapApplied||0)>0)v112Movement.lifecycleCapRecords++;
          v112Movement.totalDelta+=candScore-prodScore;
          const stage=x.stage||'UNKNOWN';
          v112ByStage[stage] ||= {count:0,productionAvg:0,candidateAvg:0,productionBuckets:{HOT:0,WARM:0,WATCH:0,LOW:0},candidateBuckets:{HOT:0,WARM:0,WATCH:0,LOW:0},_prod:0,_cand:0};
          const st=v112ByStage[stage];
          st.count++; st._prod+=prodScore; st._cand+=candScore; st.productionBuckets[prodTemp]++; st.candidateBuckets[candTemp]++;
          v112Comparisons.push({permit:x.permit,name:x.name,stage,hasDate:!!x.date,productionScore:prodScore,productionTemperature:prodTemp,candidateScore:candScore,candidateTemperature:candTemp,delta:candScore-prodScore,candidateBreakdown:cand.breakdown,diagnostics:cand.diagnostics});
        }
        for(const st of Object.values(v112ByStage)){
          st.productionAvg=st.count?Number((st._prod/st.count).toFixed(1)):0;
          st.candidateAvg=st.count?Number((st._cand/st.count).toFixed(1)):0;
          delete st._prod; delete st._cand;
        }
        v112Movement.avgDelta=rows.length?Number((v112Movement.totalDelta/rows.length).toFixed(2)):0;
        delete v112Movement.totalDelta;
        const v112BiggestDrops=[...v112Comparisons].sort((a,b)=>a.delta-b.delta).slice(0,12);


        // V113 refined shadow: preserve distinct lifecycle + first-mover weighting,
        // but use 15 points for a record seen in the current authoritative snapshot
        // when the exact event date is unavailable. Diagnostic only.
        const v113Buckets={HOT:0,WARM:0,WATCH:0,LOW:0};
        const v113Movement={scoreUp:0,scoreDown:0,scoreSame:0,temperatureUp:0,temperatureDown:0,temperatureSame:0,missingDateRecords:0,sourceFreshnessFallbackRecords:0,totalDelta:0};
        const v113Comparisons=[];
        const v113ByStage={};
        for(const x of rows){
          const prodScore=Number(x.score||0);
          const prodTemp=bucket(prodScore);
          const cand=opportunityScorePipelineCandidateV113({
            text:x.scope||x.name||'',
            status:x.permitStatus||x.stage||'',
            date:x.date||null,
            officialValue:null,
            address:x.address||'',
            company:x.company||'',
            sourceFresh:true
          });
          const candScore=Number(cand.score||0);
          const candTemp=bucket(candScore);
          v113Buckets[candTemp]=(v113Buckets[candTemp]||0)+1;
          if(candScore>prodScore)v113Movement.scoreUp++; else if(candScore<prodScore)v113Movement.scoreDown++; else v113Movement.scoreSame++;
          if(rank[candTemp]>rank[prodTemp])v113Movement.temperatureUp++; else if(rank[candTemp]<rank[prodTemp])v113Movement.temperatureDown++; else v113Movement.temperatureSame++;
          if(!cand.diagnostics?.hasValidDate)v113Movement.missingDateRecords++;
          if(cand.diagnostics?.recencyBasis==='active-source-snapshot')v113Movement.sourceFreshnessFallbackRecords++;
          v113Movement.totalDelta+=candScore-prodScore;
          const stage=x.stage||'UNKNOWN';
          v113ByStage[stage] ||= {count:0,productionAvg:0,candidateAvg:0,productionBuckets:{HOT:0,WARM:0,WATCH:0,LOW:0},candidateBuckets:{HOT:0,WARM:0,WATCH:0,LOW:0},_prod:0,_cand:0};
          const st=v113ByStage[stage];
          st.count++; st._prod+=prodScore; st._cand+=candScore; st.productionBuckets[prodTemp]++; st.candidateBuckets[candTemp]++;
          v113Comparisons.push({permit:x.permit,name:x.name,stage,hasDate:!!x.date,productionScore:prodScore,productionTemperature:prodTemp,candidateScore:candScore,candidateTemperature:candTemp,delta:candScore-prodScore,candidateBreakdown:cand.breakdown,diagnostics:cand.diagnostics});
        }
        for(const st of Object.values(v113ByStage)){
          st.productionAvg=st.count?Number((st._prod/st.count).toFixed(1)):0;
          st.candidateAvg=st.count?Number((st._cand/st.count).toFixed(1)):0;
          delete st._prod; delete st._cand;
        }
        v113Movement.avgDelta=rows.length?Number((v113Movement.totalDelta/rows.length).toFixed(2)):0;
        delete v113Movement.totalDelta;
        const v113BiggestDrops=[...v113Comparisons].sort((a,b)=>a.delta-b.delta).slice(0,12);

        return json({
          ok:true,
          market:'Chandler',
          sourceStatus:pipelineSourceStatus,
          sourceMessage:pipelineSourceMessage,
          count:rows.length,
          stages,
          accelaPermitSource:{
            ok:accelaResult.ok,
            requestedStageReferences:permitNumbers.length,
            uniqueRequestedPermits,
            matchedRecords:(accelaResult.rows||[]).length,
            error:accelaResult.error||null
          },
          participantCoverage:participantStats,
          scoringModel:{
            version:'pipeline-v2',
            production:true,
            rules:[
              'Known event dates use the existing recency curve.',
              'Missing event dates observed in the current authoritative Early Pipeline snapshot receive 15 timing/source-freshness points instead of 20.',
              'Project-stage and pre-permit/first-mover weights remain separate.',
              'Live permit scoring is unchanged.'
            ]
          },
          scoringShadowV111:{
            productionUnchanged:true,
            candidateRules:[
              'Missing or invalid dates receive 0 recency points instead of full recency credit.',
              'Combined lifecycle stage + pre-permit contribution is capped at 30 points.'
            ],
            productionBuckets,
            candidateBuckets,
            movement,
            byStage,
            biggestDrops
          },
          scoringShadowV112:{
            productionUnchanged:true,
            rationale:'Treat missing event date as a confidence problem without pretending a currently active source record is stale.',
            candidateRules:[
              'Known event dates use the existing recency curve.',
              'Missing event dates in the freshly fetched Early Pipeline source receive 10 source-freshness points, not 20 and not 0.',
              'Combined lifecycle stage + pre-permit contribution is capped at 32 points.',
              'Missing event date remains a Data Confidence penalty rather than being hidden inside Opportunity Score.'
            ],
            productionBuckets,
            candidateBuckets:v112Buckets,
            movement:v112Movement,
            byStage:v112ByStage,
            biggestDrops:v112BiggestDrops
          },
          scoringShadowV113:{
            productionUnchanged:true,
            rationale:'Preserve early-stage/first-mover signal strength while correcting the specific missing-date bug. Missing event date lowers timing credit and Data Confidence, but a project observed in the current authoritative active-project source is still a current commercial signal.',
            candidateRules:[
              'Known event dates use the existing recency curve.',
              'Missing event dates observed in the current authoritative Early Pipeline snapshot receive 15 timing/source-freshness points instead of production\'s implicit 20.',
              'Project-stage and pre-permit/first-mover weights remain separate and unchanged for this candidate.',
              'Missing event date should be surfaced separately through Data Confidence.'
            ],
            productionBuckets,
            candidateBuckets:v113Buckets,
            movement:v113Movement,
            byStage:v113ByStage,
            biggestDrops:v113BiggestDrops
          },
          contractorSource:{
            ok:contractorResult.ok,
            count:(contractorResult.rows||[]).length,
            error:contractorResult.error||null
          },
          pipeline:rows
        },200,env);
      }
      if(path==='/feed'&&request.method==='GET'){
        const days=feedInt(url.searchParams.get('days'),7,1,30);
        const requestedLimit=feedInt(url.searchParams.get('limit'),8,1,200);
        const publicLimit=Math.min(requestedLimit,8);
        const parsedMarkets=feedMarkets(url.searchParams.has('markets')?url.searchParams.get('markets'):null);
        if(!parsedMarkets.ok){
          return feedJson({
            ok:false,
            error:'invalid_market',
            invalidMarkets:parsedMarkets.invalid,
            allowedMarkets:LIVE_MARKETS,
            generatedAt:nowIso()
          },400,env);
        }
        try{
          // /feed is the public proof layer. Read a wider stored pool so we can tell
          // visitors how much activity exists, but only return a small redacted sample.
          // Signed-in customers receive their full personalized feed from /dashboard.
          const data=await readStoredFeed(env,{days,limit:Math.max(120,publicLimit),markets:parsedMarkets.markets});
          const available=Number(data?.counts?.clusteredAvailable||data?.leads?.length||0);
          const leads=(data.leads||[]).slice(0,publicLimit).map(publicOpportunityTeaser);
          return feedJson({
            ...data,
            leads,
            publicPreview:true,
            query:{days,limit:publicLimit,markets:parsedMarkets.markets},
            counts:{
              ...(data.counts||{}),
              returned:leads.length,
              publicReturned:leads.length,
              publicLimit,
              available
            }
          },200,env);
        }catch(e){
          return feedJson({
            ok:false,
            state:'unavailable',
            leads:[],
            markets:parsedMarkets.markets,
            query:{days,limit:publicLimit,markets:parsedMarkets.markets},
            error:'stored_feed_unavailable',
            message:'Stored opportunity data is temporarily unavailable.',
            generatedAt:nowIso()
          },503,env);
        }
      }
      if(path==='/leads'&&request.method==='GET'){
        const days=clamp(Number(url.searchParams.get('days')||7),1,30);
        const limit=clamp(Number(url.searchParams.get('limit')||120),1,500);
        const requested=(url.searchParams.get('markets')||'').split(',').map(x=>x.trim()).filter(Boolean);
        const markets=requested.length?requested.filter(x=>MARKETS.includes(x)):LIVE_MARKETS;

        // Dallas direct diagnostics intentionally exercise the live DallasNow
        // Submitted + Issued report client. Stored/public feed validation remains
        // separate through /feed and the scheduled refresh/persist path.
        if(requested.length===1&&requested[0]==='Dallas'){
          try{
            const fresh=clusterLeads(await fetchDallas(days,Math.max(limit*4,500)));
            return json({
              leads:fresh.slice(0,limit),
              markets:['Dallas'],
              source:'City of Dallas DallasNow Building — Submitted + Issued',
              liveDirect:true,
              generatedAt:nowIso()
            },200,env);
          }catch(e){
            // Fall through to stored Dallas rows only when the live report source is unavailable.
          }
        }

        // During Chandler's live-source cutover, a single-market request should be
        // authoritative to the official Accela layer rather than an older D1 snapshot.
        // The scheduled refresh below also replaces Chandler's stored snapshot, so this
        // direct path is both immediately correct and self-healing after the next cron.
        if(requested.length===1&&requested[0]==='Chandler'){
          try{
            const fresh=clusterLeads(await fetchChandlerAccelaPermits(days,Math.max(limit*4,500)));
            return json({
              leads:fresh.slice(0,limit),
              markets:['Chandler'],
              source:'City of Chandler Accela permit layer — official ArcGIS',
              liveDirect:true,
              generatedAt:nowIso()
            },200,env);
          }catch(e){
            // Fall through to the stored snapshot only if the official source is unavailable.
          }
        }

        let leads=await stored(env,limit*4,days);
        if(!leads||!leads.length){const fresh=await refresh(env,days);leads=clusterLeads(fresh.leads);}
        let filtered=leads.filter(x=>markets.includes(x.market||marketFromSource(x.source)));
        // A newly activated or temporarily empty market should not look dead merely because
        // D1 has not reached the next scheduled refresh yet. For a single requested live market,
        // fetch the official source directly when no stored rows are available.
        if(requested.length===1&&LIVE_MARKETS.includes(requested[0])&&!filtered.length){
          try{filtered=clusterLeads(await fetchMarket(requested[0],days,limit,env));}catch{}
        }
        return json({leads:filtered.slice(0,limit),markets,source:'Municipal public permit data',generatedAt:nowIso()},200,env);
      }
      if(path==='/refresh'&&request.method==='POST'){
        const token=(request.headers.get('authorization')||'').replace(/^Bearer\s+/i,'');if(!env.ADMIN_TOKEN||token!==env.ADMIN_TOKEN)return json({error:'unauthorized'},401,env);const result=await refresh(env,7);return json({ok:true,count:result.leads.length,markets:result.markets},200,env);
      }
      if(path==='/subscribe'&&request.method==='POST'){
        const {email,plan='Beta'}=await request.json();const clean=normalizeEmail(email);if(!validEmail(clean))return json({error:'valid email required'},400,env);await env.DB.prepare(`INSERT INTO subscribers (email,plan,created_at) VALUES (?,?,datetime('now')) ON CONFLICT(email) DO UPDATE SET plan=excluded.plan`).bind(clean,String(plan).slice(0,40)).run();await ensureUser(env,clean);return json({ok:true},200,env);
      }
      if(path==='/auth/request'&&request.method==='POST')return await requestMagicLink(request,env);
      if(path==='/auth/verify'&&request.method==='POST')return await verifyMagicLink(request,env);

      const user=await authUser(request,env);
      if(path==='/me'&&request.method==='GET'){if(!user)return json({error:'unauthorized'},401,env);return json({user:await publicUser(env,user)},200,env);}
      if(path==='/logout'&&request.method==='POST'){
        const raw=(request.headers.get('authorization')||'').replace(/^Bearer\s+/i,'').trim();if(raw)await env.DB.prepare('DELETE FROM sessions WHERE token_hash=?').bind(await sha256Hex(raw)).run();return json({ok:true},200,env);
      }
      if(path==='/dashboard'&&request.method==='GET'){if(!user)return json({error:'unauthorized'},401,env);const d=await listLeadsForUser(env,user,{limit:url.searchParams.get('limit'),days:url.searchParams.get('days')});return json({...d,generatedAt:nowIso()},200,env);}
      if(path==='/preferences'&&request.method==='POST'){
        if(!user)return json({error:'unauthorized'},401,env);const body=await request.json(),effective=userPlanActive(user),ent=PLANS[effective],industries=cleanIndustries(body.industries,ent.industryLimit),minScore=clamp(Number(body.minScore||70),45,99),markets=cleanMarkets(body.markets,ent.marketLimit);let alert=ent.alert;if(effective==='Beta')alert='none';
        await env.DB.prepare(`INSERT INTO preferences (user_id,industries,markets,min_score,alert_frequency,updated_at) VALUES (?,?,?,?,?,datetime('now')) ON CONFLICT(user_id) DO UPDATE SET industries=excluded.industries,markets=excluded.markets,min_score=excluded.min_score,alert_frequency=excluded.alert_frequency,updated_at=datetime('now')`).bind(user.id,JSON.stringify(industries),JSON.stringify(markets),minScore,alert).run();return json({ok:true,user:await publicUser(env,user)},200,env);
      }
      if(path==='/saved'&&request.method==='GET'){
        if(!user)return json({error:'unauthorized'},401,env);const r=await env.DB.prepare(`SELECT l.* FROM saved_leads s JOIN leads l ON l.id=s.lead_id WHERE s.user_id=? ORDER BY s.created_at DESC`).bind(user.id).all();return json({leads:(r.results||[]).map(x=>({...hydrateStoredLead(x),saved:true}))},200,env);
      }
      if(path==='/saved'&&request.method==='POST'){
        if(!user)return json({error:'unauthorized'},401,env);const {leadId,saved=true}=await request.json();if(!leadId)return json({error:'leadId required'},400,env);if(saved)await env.DB.prepare(`INSERT OR IGNORE INTO saved_leads (user_id,lead_id,created_at) VALUES (?,?,datetime('now'))`).bind(user.id,String(leadId)).run();else await env.DB.prepare('DELETE FROM saved_leads WHERE user_id=? AND lead_id=?').bind(user.id,String(leadId)).run();return json({ok:true},200,env);
      }
      if(path==='/feedback'&&request.method==='GET'){
        if(!user)return json({error:'unauthorized'},401,env);
        const leadId=(url.searchParams.get('leadId')||'').trim();
        if(!leadId)return json({error:'leadId required'},400,env);
        const row=await env.DB.prepare(`SELECT relevance,outcome,updated_at FROM lead_feedback WHERE user_id=? AND lead_id=?`).bind(user.id,leadId).first();
        return json({ok:true,feedback:row||{relevance:null,outcome:null,updated_at:null}},200,env);
      }
      if(path==='/feedback'&&request.method==='POST'){
        if(!user)return json({error:'unauthorized'},401,env);
        const body=await request.json();
        const leadId=String(body.leadId||'').trim();
        const action=String(body.action||'').trim().toLowerCase();
        if(!leadId)return json({error:'leadId required'},400,env);
        const valid=['useful','not_useful','contacted','won','lost'];
        if(!valid.includes(action))return json({error:'invalid feedback action'},400,env);

        const exists=await env.DB.prepare('SELECT id FROM leads WHERE id=?').bind(leadId).first();
        if(!exists)return json({error:'lead not found'},404,env);

        const relevance=(action==='useful'||action==='not_useful')?action:null;
        const outcome=['contacted','won','lost'].includes(action)?action:null;

        await env.DB.prepare(`INSERT INTO lead_feedback (user_id,lead_id,relevance,outcome,created_at,updated_at)
          VALUES (?,?,?,?,datetime('now'),datetime('now'))
          ON CONFLICT(user_id,lead_id) DO UPDATE SET
            relevance=COALESCE(excluded.relevance,lead_feedback.relevance),
            outcome=COALESCE(excluded.outcome,lead_feedback.outcome),
            updated_at=datetime('now')`)
          .bind(user.id,leadId,relevance,outcome).run();

        await env.DB.prepare(`INSERT INTO lead_feedback_events (user_id,lead_id,action,created_at)
          VALUES (?,?,?,datetime('now'))`).bind(user.id,leadId,action).run();

        const row=await env.DB.prepare(`SELECT relevance,outcome,updated_at FROM lead_feedback WHERE user_id=? AND lead_id=?`).bind(user.id,leadId).first();
        return json({ok:true,feedback:row},200,env);
      }
      if(path==='/competitor-watchlist'&&request.method==='GET'){
        if(!user)return json({error:'unauthorized'},401,env);
        const items=await listWatchlist(env,user);
        return json({ok:true,plan:userPlanActive(user),items},200,env);
      }
      if(path==='/competitor-watchlist'&&request.method==='POST'){
        if(!user)return json({error:'unauthorized'},401,env);
        if(userPlanActive(user)!=='Territory')return json({error:'Competitor watchlists are available on Territory.'},403,env);
        const body=await request.json();
        const company=canonicalCompanyName(body.company||'');
        const watching=body.watching!==false;
        if(!company)return json({error:'company required'},400,env);
        if(watching){
          await env.DB.prepare(`INSERT OR IGNORE INTO competitor_watchlist (user_id,company,created_at) VALUES (?,?,datetime('now'))`).bind(user.id,company).run();
        }else{
          await env.DB.prepare(`DELETE FROM competitor_watchlist WHERE user_id=? AND company=?`).bind(user.id,company).run();
        }
        return json({ok:true,items:await listWatchlist(env,user)},200,env);
      }
      if(path==='/changes'&&request.method==='GET'){
        if(!user)return json({error:'unauthorized'},401,env);
        const p=await env.DB.prepare('SELECT * FROM preferences WHERE user_id=?').bind(user.id).first();
        const activePlan=userPlanActive(user);
        const ent=PLANS[activePlan]||PLANS.Beta;
        const markets=cleanMarkets(parseJson(p?.markets,['Phoenix']),ent.marketLimit);
        const industries=cleanIndustries(parseJson(p?.industries,['Commercial services']),ent.industryLimit);
        const minScore=Number(p?.min_score||70);

        // "Since yesterday" is a Phoenix/Arizona calendar window, not a rolling
        // 24-hour timestamp. Municipal feeds often publish a permit date at or
        // near midnight, which caused valid same-day activity to disappear by
        // the evening. Filter market + score in SQL before applying the limit so
        // activity in a busy market cannot crowd out the user's selected market.
        const marketPlaceholders=markets.map(()=>'?').join(',');
        const r=await env.DB.prepare(`
          SELECT * FROM leads
          WHERE (
            (market='Phoenix' AND datetime(event_date) >= datetime(date('now','-7 hours','-1 day'),'+7 hours'))
            OR
            (market<>'Phoenix' AND date(event_date) >= date('now','-7 hours','-1 day'))
          )
            AND market IN (${marketPlaceholders})
            AND score>=?
          ORDER BY event_date DESC
          LIMIT 1500
        `).bind(...markets,minScore).all();

        const candidateRows=(r.results||[]).map(hydrateStoredLead);
        const recent=candidateRows.filter(x=>
          (x.categories||[]).some(c=>industries.includes(c))
        );
        const clustered=clusterLeads(recent);
        const hot=clustered.filter(x=>x.score>=75).length;
        const major=clustered.filter(x=>Number(x.officialPermitValue||0)>=500000).length;
        const movedIntoExecution=clustered.filter(x=>['PERMIT ISSUED','CONSTRUCTION'].includes(x.lifecycle?.stage)).length;
        const watchlist=activePlan==='Territory'?await listWatchlist(env,user):[];
        const competitorMoves=watchlist.flatMap(x=>(x.events||[]).map(e=>({company:x.company,...e}))).slice(0,5);

        return json({
          ok:true,
          window:'since_yesterday_arizona',
          windowLabel:'Since yesterday',
          plan:activePlan,
          filters:{markets,industries,minScore},
          diagnostics:{
            rowsAfterMarketAndScore:candidateRows.length,
            rowsAfterIndustryFilter:recent.length,
            clusteredOpportunities:clustered.length
          },
          summary:{
            opportunities:clustered.length,
            hot,
            majorProjects:major,
            movedIntoExecution,
            competitorMoves:competitorMoves.length
          },
          competitorMovesAvailable:activePlan==='Territory',
          competitorMoves,
          top:clustered.slice(0,5).map(x=>({id:x.id,name:x.name,market:x.market,score:x.score,temperature:x.temperature,actionIntelligence:x.actionIntelligence}))
        },200,env);
      }

      if(path==='/export.csv'&&request.method==='GET'){if(!user)return json({error:'unauthorized'},401,env);return await exportCsv(env,user);}
      if(path==='/billing/checkout'&&request.method==='POST'){if(!user)return json({error:'unauthorized'},401,env);return await createCheckout(request,env,user);}
      if(path==='/billing/sync'&&request.method==='POST'){
        if(!user)return json({error:'unauthorized'},401,env);
        const synced=await syncUserBillingFromStripe(env,user);
        return json({ok:true,user:await publicUser(env,synced)},200,env);
      }
      if(path==='/billing/portal'&&request.method==='POST'){if(!user)return json({error:'unauthorized'},401,env);return await createPortal(env,user);}

      return json({error:'not found'},404,env);
    }catch(e){return json({error:e.message||'server error'},500,env);}
  },
  async scheduled(event,env,ctx){ctx.waitUntil((async()=>{
    const d=new Date(event.scheduledTime||Date.now());
    await refresh(env,7);
    await runAlerts(env,d);
    await runCompetitorWatchAlerts(env,d);
    // V126 — controlled one-time Phoenix history backfill.
    // Run after customer-facing refresh/alerts so historical ingestion cannot delay them.
    try{await runPhoenixHistoricalBackfillBatch(env)}catch(e){console.error('Phoenix backfill batch failed',e)}
  })());}
};
