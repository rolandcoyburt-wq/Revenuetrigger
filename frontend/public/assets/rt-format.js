/* Display-only helpers shared by both experiences; stored records stay unchanged. */
window.RTFormat=(()=>{
// Exact recurring UTF-8-as-CP437 artifacts confirmed in sanitized Arizona fixtures.
// Do not guess at unknown sequences or transcode whole strings.
function normalizeDisplayText(v=''){
  return String(v??'').replace(/ΓÇö/g,'—').replace(/ΓÇ¥/g,'”').replace(/\bRevenueTrigger\b/g,'Revenue Trigger');
}
function preserveRedaction(v){return v.replace(/\[phone redacted\]/gi,'[PHONE REDACTED]')}
function approxMoney(n){
  n=Number(n||0);
  if(!n)return '—';
  const usd=String.fromCharCode(36);
  if(n>=1000000){const m=n/1000000;return '~'+usd+(m>=10?Math.round(m):Math.round(m*10)/10)+'M'}
  if(n>=1000)return '~'+usd+Math.round(n/1000)+'K';
  return '~'+usd+(Math.round(n/10)*10);
}
function displayCompanyName(v=''){
  const raw=normalizeDisplayText(v).replace(/\s+/g,' ').trim();
  if(!raw||/^(not listed|unknown|n\/a|none|null|-+)$/i.test(raw))return 'Not listed';
  if(raw!==raw.toUpperCase())return raw;
  const keepUpper=new Set(['LLC','LLP','LP','PLLC','USA','US','HVAC','GC','DBA','AZ','TX','II','III','IV']);
  return preserveRedaction(raw.toLowerCase().replace(/\b[a-z0-9][a-z0-9'&.-]*\b/g,w=>{const u=w.toUpperCase();return keepUpper.has(u)?u:w.charAt(0).toUpperCase()+w.slice(1)}));
}
function displayAddress(v=''){
  const keep=new Set(['N','S','E','W','NE','NW','SE','SW','AZ','TX','US','USA','PO']);
  return preserveRedaction(normalizeDisplayText(v).replace(/\b[A-Z][A-Z']*\b/g,w=>keep.has(w)?w:w[0]+w.slice(1).toLowerCase()));
}
function displayLabel(v=''){
  const s=normalizeDisplayText(v).replace(/_/g,' ').trim();
  if(!s||s!==s.toUpperCase())return s;
  return preserveRedaction(s[0]+s.slice(1).toLowerCase());
}
function intelligenceText(v='',x={}){
  let s=normalizeDisplayText(v);
  if(x.company&&displayCompanyName(x.company)!=='Not listed')s=s.split(normalizeDisplayText(x.company).toUpperCase()).join(displayCompanyName(x.company)).split(normalizeDisplayText(x.company)).join(displayCompanyName(x.company));
  if(x.address)s=s.split(normalizeDisplayText(x.address)).join(displayAddress(x.address));
  s=s.replace(/\b(APPLICATION|ISSUED|APPROVED|PRE-TECH|NOW|OPEN|STABLE)\b/g,w=>w.toLowerCase());
  return preserveRedaction(s.replace(/^([a-z])/,c=>c.toUpperCase()));
}
function cleanPermitText(v=''){
  return normalizeDisplayText(v)
    .replace(/[\r\n]+/g,' ')
    .replace(/^\s*(?:\d+[.)]|[-•])\s*/,'')
    .replace(/\s+/g,' ')
    .trim();
}
function sentenceCasePermit(v=''){
  let s=cleanPermitText(v);
  if(!s)return s;
  const letters=(s.match(/[A-Za-z]/g)||[]);
  const uppers=(s.match(/[A-Z]/g)||[]);
  if(letters.length>=8&&uppers.length/letters.length>.72){
    s=s.toLowerCase();
    s=s.charAt(0).toUpperCase()+s.slice(1);
    const acronyms=['HVAC','FACP','EV','ADA','LED','CCTV','CMU','PVC','RTU','VAV','AHU','CO2'];
    for(const a of acronyms)s=s.replace(new RegExp('\\b'+a.toLowerCase()+'\\b','g'),a);
  }
  return preserveRedaction(s);
}
function truncateAtWord(v,max=62){
  const s=normalizeDisplayText(v).trim();
  if(s.length<=max)return s;
  const cut=s.slice(0,max+1);
  const at=cut.lastIndexOf(' ');
  return (at>Math.floor(max*.6)?cut.slice(0,at):s.slice(0,max)).replace(/[,:;\-\s]+$/,'')+'…';
}
function permitDescriptionText(x={}){
  const generic=/^(other\s+commercial|commercial|commercial building|permit activity|building permit|other)$/i;
  const parts=normalizeDisplayText(x.scope).split(/\s+[—–-]\s+/).map(cleanPermitText).filter(Boolean);
  const useful=parts.find(v=>v.length>=5&&!generic.test(v)&&!/^com$/i.test(v)&&!/^\d{3}\s*-/.test(v));
  return useful||'';
}
function feedHeadline(x={}){
  const generic=/^(other\s+commercial|commercial|commercial building|permit activity|building permit|other)$/i;
  const original=cleanPermitText(x.name||'');
  const prefixed=/^x\s+team\s*\/{2,}\s*/i.test(original);
  const raw=original.replace(/^x\s+team\s*\/{2,}\s*/i,'');
  let text=(!raw||generic.test(raw))?permitDescriptionText(x):raw;
  const source=(permitDescriptionText(x)||text||'').toLowerCase();

  if(/magnetic\s+(?:lock|locking)|access control/.test(source)&&/fire alarm/.test(source))return 'Magnetic door lock + fire alarm tie-in';
  if(/fire alarm/.test(source)&&/(facp|panel)/.test(source)&&/(replace|replacement|new)/.test(source))return 'Fire alarm panel replacement';
  if(/(?:hvac|chiller)/.test(source)&&/(breaker|wiring|electrical|feeder)/.test(source))return 'HVAC chiller electrical upgrade';
  if(/gas line/.test(source)&&/(repair|replace|new)/.test(source))return 'Commercial gas line repair';
  if(/(?:ev charging|ev charger|charging station)/.test(source))return 'EV charger installation';
  if(/solar|photovoltaic/.test(source)&&/(install|installation|new)/.test(source))return 'Commercial solar installation';
  if(/tenant improvement|tenant build.?out/.test(source))return 'Commercial tenant improvement';
  if(/roof/.test(source)&&/(replace|replacement|reroof|re-roof)/.test(source))return 'Commercial roof replacement';
  if(/(?:water heater|boiler)/.test(source)&&/(replace|replacement|install)/.test(source))return 'Water-heating equipment upgrade';

  text=prefixed?displayCompanyName(text.toUpperCase()):sentenceCasePermit(text||((x.market||'Arizona')+' permit activity'));
  text=text.replace(/^\s*\d+[.)]\s*/,'');
  return truncateAtWord(text,62);
}
function displayEventTitle(x={}){
  return feedHeadline(x);
}

return {displayAddress,displayLabel,intelligenceText,normalizeDisplayText,approxMoney,displayCompanyName,displayEventTitle,cleanPermitText,sentenceCasePermit,truncateAtWord,permitDescriptionText,feedHeadline};
})();
