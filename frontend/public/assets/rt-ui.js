/* Presentation only: temperature, valuation and intelligence remain API-owned. */
window.RTUI=(()=>{
 const esc=v=>RTFormat.normalizeDisplayText(v).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 const tempClass=t=>({HOT:'hot',WARM:'warm',WATCH:'watch',LOW:'low'}[t]||'low');
 const badge=x=>`<span class="rt-temperature ${tempClass(x.temperature)}">${esc(x.temperature||'Unrated')}</span>`;
 const listed=x=>RTFormat.displayCompanyName(x.company)!=='Not listed';
 const date=x=>x.date&&!isNaN(new Date(x.date))?new Date(x.date).toLocaleDateString('en-US',{month:'short',day:'numeric'}):'';
 const money=x=>Number(x.value)>0?RTFormat.approxMoney(x.value):'—';
 function opportunityCard(x,{preview=false,signedIn=false}={}){
  const title=RTFormat.displayEventTitle(x), company=RTFormat.displayCompanyName(x.company);
  const gated=!signedIn&&Boolean(x.publicPreview);
  if(preview)return `<article class="rt-preview-card"><div class="rt-card-top"><span class="rt-kicker">${esc(x.market)} / ${gated?'Live signal':esc(x.permit||'Public record')}</span>${badge(x)}</div><h3>${esc(title)}</h3><p class="rt-card-address">${esc(RTFormat.displayAddress(x.address||x.market))} · ${esc(date(x))}</p><div class="rt-card-company ${gated?'rt-gated-field':''}"><small>Company on permit</small><strong>${gated?'Sign in to reveal':esc(company)}</strong>${!gated&&x.companyRole?`<small>${esc(x.companyRole)}</small>`:''}</div><div class="rt-card-metrics"><div><small>Opportunity score</small><strong>${esc(x.score??'—')}<span>/100</span></strong></div><div><small>Est. service opportunity</small><strong class="rt-money">${money(x)}</strong></div></div><a class="rt-text-link" href="/signals">${gated?'Reveal opportunity details':'Explore opportunities'} <span aria-hidden="true">↗</span></a></article>`;
  return `<div class="lead ${gated?'rt-public-lead':''}"><div class="score">${esc(x.score??'—')}</div><div class="lead-main"><div class="leadname">${esc(title)}</div><div class="meta">${esc(RTFormat.displayAddress(x.address||x.market||''))} · ${esc(date(x))}</div></div><div class="permit-company">${gated?'<span class="rt-public-lock">Sign in to reveal</span>':(listed(x)?esc(company):'<span class="company-missing">Not listed</span>')}${!gated&&x.companyRole?`<small class="rt-role">${esc(x.companyRole)}</small>`:''}</div><div class="chips lead-seller">${(x.categories||[]).slice(0,4).map(c=>`<span class="chip">${esc(c)}</span>`).join('')}</div><div class="value lead-value" title="Estimated service opportunity; not official permit valuation">${money(x)}</div><div class="lead-temperature">${badge(x)}</div><div class="row-actions lead-actions">${signedIn?`<button class="save ${x.saved?'active':''}" data-lead-action="save" data-id="${esc(x.id)}" aria-label="${x.saved?'Unsave':'Save'} ${esc(title)}">${x.saved?'★':'☆'}</button>`:''}<button class="view" data-lead-action="view" data-id="${esc(x.id)}">${gated?'Reveal':'View'}</button></div></div>`;
 }
 function whyNow(x){
  const text=RTFormat.intelligenceText(x.actionIntelligence?.whyNow||'',x);
  if(!text)return '';
  const company=RTFormat.displayCompanyName(x.company);
  const body=company!=='Not listed'?text.split(company).map(esc).join(`<strong>${esc(company)}</strong>`):esc(text);
  return `<div class="rt-reason rt-why-now"><small>Why now</small><p>${body}</p></div>`;
 }
 function triggerTimeline(x){
  const ai=x.actionIntelligence||{},stage=x.lifecycle?.stage||x.permitStatus||x.stage;
  const timing=ai.opportunityWindow?.label||ai.buyingWindow?.label;
  if(!stage&&!timing&&!ai.nextBestAction?.action)return '';
  return `<section class="rt-project-stage" aria-label="Published project stage"><small>Project stage</small><strong>${esc(RTFormat.displayLabel(stage||'Not published'))}</strong>${timing?`<p><span>Opportunity window</span> ${esc(RTFormat.displayLabel(timing))}</p>`:''}${ai.nextBestAction?.action?`<p><span>Next action</span> ${esc(RTFormat.displayLabel(ai.nextBestAction.action))}</p>`:''}</section>`;
 }
 function decision(x){
  const ai=x.actionIntelligence||{};
  const metrics=[['First-Mover',ai.firstMover],['Opportunity window',ai.opportunityWindow?.label],['Buying window',ai.buyingWindow?.label],['Momentum',ai.momentum?.label],['Data confidence',x.dataConfidence?.score!=null?x.dataConfidence.score+'%':null]].filter(([,v])=>v!=null&&v!=='');
  if(!metrics.length&&!ai.whyNow&&!ai.nextBestAction?.action)return '';
  return `<div class="rt-decision-metrics">${metrics.map(([k,v])=>`<div><small>${esc(k)}</small><strong>${esc(RTFormat.displayLabel(v))}</strong></div>`).join('')}</div>${whyNow(x)}${ai.nextBestAction?.action?`<div class="rt-reason"><small>Next best action</small><p>${esc(RTFormat.displayLabel(ai.nextBestAction.action))}</p>${ai.nextBestAction.reason?`<p class="rt-muted">${esc(RTFormat.intelligenceText(ai.nextBestAction.reason,x))}</p>`:''}</div>`:''}`;
 }
 function feedState(data,status=200){
  const valid=['fresh','stale','partial','empty','unavailable'];
  const requestError=status===400&&data?.error==='invalid_market';
  const state=status>=400||data?.ok===false||(['fresh','stale','partial'].includes(data?.state)&&!Array.isArray(data?.leads))?'unavailable':valid.includes(data?.state)?data.state:'unavailable';
  const rows=['fresh','stale','partial'].includes(state)&&Array.isArray(data?.leads)?data.leads:[];
  // This array describes stored D1 freshness, never municipal source health.
  const markets=Array.isArray(data?.freshness?.markets)?data.freshness.markets.filter(x=>x&&RTConfig.markets.includes(x.market)&&valid.includes(x.state)).map(x=>({market:x.market,state:x.state,storedCount:x.storedCount,lastStoredAt:x.lastStoredAt,latestEventAt:x.latestEventAt,ageMinutes:x.ageMinutes})):[];
  const label=requestError?'Feed request error':{fresh:'Stored opportunities',stale:'Stored snapshot · stale',partial:'Partial market coverage',empty:'No current opportunities',unavailable:'Feed unavailable'}[state];
  let notice=requestError?'The feed request contains an unsupported market. Check the market selection or configuration.':{fresh:'',stale:'Stored opportunities are shown. Some stored market data may be delayed; verify timing before acting.',partial:'Available stored opportunities are shown. Some stored market data may be delayed or missing.',empty:'No stored opportunities are available for the selected markets and time window.',unavailable:'Current opportunities are temporarily unavailable. Please try again shortly.'}[state];
  if(!rows.length&&['partial','stale'].includes(state))notice='Some stored market data may be delayed or missing. No stored opportunities are available in this window.';
  if(['partial','stale'].includes(state)&&markets.length)notice+=' Stored data: '+markets.map(x=>`${x.market} (${x.state})`).join(', ')+'.';
  return {state,rows,label,notice,requestError,publicPreview:Boolean(data?.publicPreview),counts:data?.counts||{},freshness:{thresholdMinutes:data?.freshness?.thresholdMinutes,markets}};
 }
 async function readFeed(query){
  try{const response=await fetch(RTConfig.apiBase+'/feed?'+query);return feedState(await response.json(),response.status)}catch{return feedState(null)}
 }

 return {whyNow,esc,badge,opportunityCard,triggerTimeline,decision,money,feedState,readFeed};
})();
