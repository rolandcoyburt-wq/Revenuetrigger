const CONFIG=RTConfig;
const INDUSTRIES=['Commercial services','HVAC','Electrical','Plumbing','Roofing','Landscaping','Security','Signage'];
const LIVE_MARKETS=RTConfig.markets;
let leads=[],user=null,currentLead=null,savedOnly=false;
let publicFeed=null,publicFeedRequest=0;
let permitCompanyFilter='listed',pipelineCompanyFilter='listed';

const $=s=>document.querySelector(s);const $$=s=>[...document.querySelectorAll(s)];
const THEME_KEY='revenuetrigger_theme';
function currentTheme(){return document.documentElement.getAttribute('data-theme')==='light'?'light':'dark'}
function syncThemeUI(){
  const light=currentTheme()==='light';
  const b=$('#themeToggle'),i=$('#themeIcon'),label=$('#themeLabel'),shortLabel=$('#themeLabelShort');
  if(i)i.textContent=light?'☾':'☀';
  if(label)label.textContent=light?'Dark mode':'Light mode';
  if(shortLabel)shortLabel.textContent=light?'Dark':'Light';
  if(b){
    b.setAttribute('aria-label',light?'Switch to dark theme':'Switch to light theme');
    b.title=light?'Switch to dark theme':'Switch to light theme';
  }
  const meta=document.querySelector('meta[name="theme-color"]');
  if(meta)meta.setAttribute('content',light?'#f7faf7':'#020806');
}
function setTheme(theme){
  const next=theme==='light'?'light':'dark';
  document.documentElement.setAttribute('data-theme',next);
  try{localStorage.setItem(THEME_KEY,next)}catch(e){}
  syncThemeUI();
}
function toggleTheme(){setTheme(currentTheme()==='light'?'dark':'light')}

function initLightMouseGlow(){
  if(!window.matchMedia('(pointer:fine)').matches||window.matchMedia('(prefers-reduced-motion:reduce)').matches)return;
  const setGlow=(x,y)=>{document.body.style.setProperty('--mouse-x',x);document.body.style.setProperty('--mouse-y',y)};
  setGlow('72vw','14vh');
  window.addEventListener('pointermove',e=>{
    if(currentTheme()!=='light')return;
    setGlow(e.clientX+'px',e.clientY+'px');
  },{passive:true});
  window.addEventListener('pointerleave',()=>setGlow('72vw','14vh'));
}
initLightMouseGlow();

syncThemeUI();
function esc(s=''){return RTFormat.normalizeDisplayText(s).replace(/[&<>'"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c]))}
function money(n){return new Intl.NumberFormat('en-US',{style:'currency',currency:'USD',maximumFractionDigits:0,notation:n>=1e6?'compact':'standard'}).format(n||0)}
const {approxMoney,displayCompanyName,displayEventTitle,cleanPermitText,sentenceCasePermit,truncateAtWord,permitDescriptionText,feedHeadline}=RTFormat;
function setKpiValue(id,rawValue,displayValue){
  const el=document.getElementById(id);if(!el)return;
  el.textContent=displayValue;
  const tile=el.closest('.kpi');if(tile)tile.classList.toggle('is-zero',!(Number(rawValue)>0));
}
function setChangedStat(id,value,opts={}){
  const available=opts.available!==false;
  const el=document.getElementById(id);if(!el)return false;
  const tile=el.closest('.changed-stat');
  const visible=available&&Number(value)>0;
  if(tile)tile.hidden=!visible;
  el.textContent=visible?String(value):'—';
  return visible;
}
function age(ts){const h=Math.max(0,Math.round((Date.now()-new Date(ts).getTime())/36e5));return h<1?'just now':h<24?`${h}h ago`:`${Math.round(h/24)}d ago`}
function token(){return RTAuth.token()}
function authHeaders(extra={}){return RTAuth.headers(extra)}
function toast(msg){const t=$('#toast');t.textContent=msg;t.style.display='block';clearTimeout(window.__toast);window.__toast=setTimeout(()=>t.style.display='none',3500)}
function openModal(id){$('#'+id).classList.add('open')}function closeModal(id){$('#'+id).classList.remove('open')}
function openSignin(){openModal('signinModal');setTimeout(()=>$('#signinEmail').focus(),50)}
async function openAccount(){renderAccount();await syncBilling();openModal('accountModal')}
function planActive(){return user&&['active','trialing'].includes(user.subscriptionStatus)?user.plan:'Beta'}
function render(){
  if(user)$('#publicFeedNotice').hidden=true;
  const market=$('#market').value,industry=$('#industry').value,min=+$(`#minScore`).value,q=$('#search').value.toLowerCase(),saved=$('#savedFilter').value==='saved',sort=$('#sortFeed')?.value||'score';
  const hasListedCompany=x=>{const c=String(x.company||'').trim();return Boolean(c)&&!/^(not listed|unknown|n\/a|none|null|-+)$/i.test(c);};
  const baseFiltered=leads.filter(x=>(market==='all'||(x.market||'Phoenix')===market)&&(industry==='all'||x.categories?.includes(industry))&&x.score>=min&&(!saved||x.saved)&&(`${x.name} ${x.address} ${x.company} ${x.scope}`.toLowerCase().includes(q)));
  const listedCount=baseFiltered.filter(hasListedCompany).length;
  const notListedCount=Math.max(0,baseFiltered.length-listedCount);
  const listedBtn=$('#permitCompanyToggle [data-value="listed"]');
  const notListedBtn=$('#permitCompanyToggle [data-value="not-listed"]');
  if(listedBtn)listedBtn.textContent=`Listed (${listedCount})`;
  if(notListedBtn)notListedBtn.textContent=`Not Listed (${notListedCount})`;
  const filtered=user?baseFiltered.filter(x=>permitCompanyFilter==='listed'?hasListedCompany(x):!hasListedCompany(x)):baseFiltered;
  filtered.sort((a,b)=>{
    if(sort==='newest')return (new Date(b.date).getTime()||0)-(new Date(a.date).getTime()||0);
    if(sort==='oldest')return (new Date(a.date).getTime()||0)-(new Date(b.date).getTime()||0);
    return (Number(b.score)||0)-(Number(a.score)||0)||((new Date(b.date).getTime()||0)-(new Date(a.date).getTime()||0));
  });
  $('#leadList').innerHTML=filtered.length?filtered.map(x=>RTUI.opportunityCard(x,{signedIn:Boolean(user)})).join(''):`<div class="empty">${permitCompanyFilter==='listed'&&baseFiltered.length&&listedCount===0
    ?`None of the current ${baseFiltered.length} opportunities include a published company name. Switch to Not Listed to view them.`
    :!user&&publicFeed&&!leads.length?(publicFeed.state==='unavailable'?publicFeed.notice:'No stored opportunities are available for the selected markets and time window.'):'No signals match these filters.'}</div>`;
  const hotCount=filtered.filter(x=>x.temperature==='HOT').length;
  const totalValue=filtered.reduce((s,x)=>s+Number(x.value||0),0);
  const avgScore=filtered.length?Math.round(filtered.reduce((s,x)=>s+Number(x.score||0),0)/filtered.length):0;
  setKpiValue('kSignals',filtered.length,String(filtered.length));
  setKpiValue('kHot',hotCount,String(hotCount));
  setKpiValue('kValue',totalValue,approxMoney(totalValue));
  setKpiValue('kAvg',avgScore,String(avgScore));
  if(!user&&publicFeed?.state==='unavailable')for(const id of ['kSignals','kHot','kValue','kAvg'])$('#'+id).textContent='—';
  $('#feedKpis')?.classList.toggle('all-zero',filtered.length===0);
  const gate=$('#publicFeedGate');
  if(gate){
    if(user){
      gate.hidden=true;
    }else{
      const available=Number(publicFeed?.counts?.available||publicFeed?.counts?.clusteredAvailable||filtered.length);
      const shown=filtered.length;
      const remaining=Math.max(0,available-shown);
      $('#publicFeedGateCount').textContent=remaining>0
        ? `${remaining} more opportunities detected in this view`
        : 'More opportunity intelligence is available when you sign in';
      gate.hidden=false;
    }
  }

}

let currentFeedback={relevance:null,outcome:null};

function renderLeadFeedback(){
  const box=$('#mFeedback');
  if(!box)return;
  box.style.display=user?'block':'none';
  if(!user)return;

  $$('#mFeedback [data-feedback]').forEach(btn=>btn.classList.remove('active'));
  if(currentFeedback.relevance){
    const b=$(`#mFeedback [data-feedback="${currentFeedback.relevance}"]`);
    if(b)b.classList.add('active');
  }
  if(currentFeedback.outcome){
    const b=$(`#mFeedback [data-feedback="${currentFeedback.outcome}"]`);
    if(b)b.classList.add('active');
  }

  const parts=[];
  if(currentFeedback.relevance)parts.push(currentFeedback.relevance==='useful'?'Marked useful':'Marked not useful');
  if(currentFeedback.outcome)parts.push(currentFeedback.outcome==='contacted'?'Contacted':currentFeedback.outcome==='won'?'Won':'Lost');
  $('#mFeedbackState').textContent=parts.length?parts.join(' • '):'No feedback yet.';
}

async function loadLeadFeedback(){
  currentFeedback={relevance:null,outcome:null};
  renderLeadFeedback();
  if(!user||!currentLead)return;
  try{
    const r=await fetch(`${CONFIG.apiBase}/feedback?leadId=${encodeURIComponent(currentLead.id)}`,{headers:authHeaders()});
    if(!r.ok)return;
    const d=await r.json();
    currentFeedback=d.feedback||currentFeedback;
    renderLeadFeedback();
  }catch{}
}

async function setLeadFeedback(action){
  if(!user){openSignin();return}
  if(!currentLead)return;
  try{
    const r=await fetch(`${CONFIG.apiBase}/feedback`,{
      method:'POST',
      headers:authHeaders({'content-type':'application/json'}),
      body:JSON.stringify({leadId:currentLead.id,action})
    });
    const d=await r.json().catch(()=>({}));
    if(!r.ok)throw new Error(d.error||'Could not save feedback');
    currentFeedback=d.feedback||currentFeedback;
    renderLeadFeedback();
    const labels={useful:'Marked useful.',not_useful:'Marked not useful.',contacted:'Marked contacted.',won:'Marked won.',lost:'Marked lost.'};
    toast(labels[action]||'Feedback saved.');
  }catch(e){
    toast(e.message||'Could not save feedback.');
  }
}

function openLead(id){
  if(!user){
    RTAuth.set('revenuetrigger_return_to','/signals');
    openSignin();
    toast('Create a free account or sign in to reveal the company and full opportunity details.');
    return;
  }
  const x=leads.find(v=>String(v.id)===String(id));if(!x)return;currentLead=x;
  const fits=Object.entries(x.sellerFit||{}).sort((a,b)=>b[1]-a[1]).filter(([k,v])=>v>=20).slice(0,5);
  const fitText=fits.length?fits.map(([k,v])=>`${k} ${v}`).join(' • '):(x.categories||[]).join(', ');
  const conf=Number(x.dataConfidence?.score||0);
  const checked=x.checkedAt?new Date(x.checkedAt).toLocaleString():'Current feed refresh';
  $('#mTitle').textContent=displayEventTitle(x);
  $('#mGrid').innerHTML=[
    ["Score",x.score+' / 100'],['Data confidence',conf?conf+'%':'—'],['Temperature',x.temperature||'—'],
    ['Estimated service opportunity',approxMoney(x.value)],['Official permit valuation',x.officialPermitValue?money(x.officialPermitValue):'Not published'],
    ['Market',x.market||'Phoenix'],['Permit',x.permit||'—'],['Permit status',x.permitStatus||x.permit_status||'—'],
    ['Address',RTFormat.displayAddress(x.address||((x.market||'Phoenix')+', AZ'))],['Company on permit',displayCompanyName(x.company)],['Detected',new Date(x.date).toLocaleString()],
    ['Seller fit',fitText],['Source',x.source||'Municipal public permit data'],['Last checked',checked]
  ].map(([a,b])=>`<div class="detail"><small>${esc(a)}</small><strong>${esc(b)}</strong></div>`).join('');

  const b=x.scoreBreakdown||{};
  const lines=[
    ['Project stage',b.projectStage],['Recency',b.recency],['Project value',b.projectValue],['Trade relevance',b.tradeRelevance],
    ['Project type',b.projectType],['Pre-permit intelligence',b.prePermit],['Company context',b.companyBehavior]
  ].filter(([,v])=>v!==undefined).map(([k,v])=>`${esc(k)}: <strong>+${esc(v)}</strong>`).join('<br>');

  const lifecycle=RTUI.triggerTimeline(x);
  const confReasons=(x.dataConfidence?.reasons||[]).slice(0,4).join(' • ');
  const confidence=conf?`<div style="margin-top:14px"><strong>Data confidence</strong><div class="confidence-meter"><div class="confidence-track"><div class="confidence-fill" style="width:${Math.min(100,conf)}%"></div></div><b>${conf}%</b></div>${confReasons?`<div class="freshness">${esc(confReasons)}</div>`:''}</div>`:'';
  const cluster=x.relatedPermitCount>1?`<div class="cluster-note"><strong>Project cluster:</strong> ${x.relatedPermitCount} related permit records detected at this location and grouped into this opportunity.</div>`:'';
  const ai=x.actionIntelligence||{};
  const actionGrid=`<div class="action-grid">
    <div class="action-card accent"><small>First-Mover</small><strong>${ai.firstMover??'—'}</strong></div>
    <div class="action-card"><small>Opportunity window</small><strong>${esc(ai.opportunityWindow?.label||'—')}</strong><span class="action-reason">${esc(ai.opportunityWindow?.detail||'')}</span></div>
    <div class="action-card"><small>Buying window</small><strong>${esc(ai.buyingWindow?.label||'—')}</strong><span class="action-reason">${esc(ai.buyingWindow?.detail||'')}</span></div>
    <div class="action-card"><small>Momentum</small><strong>${esc(ai.momentum?.label||'—')}</strong><span class="action-reason">${esc(ai.velocity?.label||'')} ${esc(ai.velocity?.detail||'')}</span></div>
  </div>`;
  const whyNow=RTUI.whyNow(x);
  const nextAction=ai.nextBestAction?`<div class="action-callout"><b>RECOMMENDED ACTION — ${esc(RTFormat.displayLabel(ai.nextBestAction.action))}</b><span class="action-reason">${esc(RTFormat.intelligenceText(ai.nextBestAction.reason,x))}</span></div>`:'';

  $('#mWhy').innerHTML=`<strong>Full permit description:</strong><br>${esc(x.scope||'Recent permit activity suggests an upcoming spend event.')}<br>${actionGrid}${whyNow}${nextAction}<br>${lines?`<strong>Score breakdown</strong><br>${lines}`:''}${confidence}${lifecycle}${cluster}<br><span style="color:#8fa59b">Action Intelligence is a Revenue Trigger inference from observed public activity, not a guarantee of vendor selection or project timing.</span>`;
  $('#mSave').style.display=user?'inline-block':'none';$('#mSave').textContent=x.saved?'★ Saved':'☆ Save opportunity';
  currentFeedback={relevance:null,outcome:null};renderLeadFeedback();openModal('leadModal');loadLeadFeedback()
}

async function loadChanges(){
  const msg=$('#changedMessage');if(!msg)return;
  if(!user){
    ['chgOpp','chgHot','chgMajor','chgComp'].forEach(id=>{const tile=document.getElementById(id)?.closest('.changed-stat');if(tile)tile.hidden=true;});
    document.querySelector('.changed-shell')?.setAttribute('data-visible-stats','0');
    $('#changedMoves').innerHTML='';
    try{
      const r=await fetch(`${CONFIG.apiBase}/changes-teaser`);
      const d=await r.json().catch(()=>({}));
      if(!r.ok)throw new Error();
      const count=Number(d.opportunities||0);
      if(count>0){
        const tile=document.getElementById('chgOpp')?.closest('.changed-stat');
        if(tile)tile.hidden=false;
        $('#chgOpp').textContent=String(count);
        document.querySelector('.changed-shell')?.setAttribute('data-visible-stats','1');
        msg.textContent=`${count} new ${count===1?'opportunity':'opportunities'} since yesterday — sign in to see the details.`;
        $('#changedMoves').innerHTML='<div class="changed-locked-preview" aria-hidden="true"><span></span><span></span></div><button class="changed-signin" type="button" onclick="openSignin()">Sign in to view changes →</button>';
      }else{
        msg.textContent='No new WATCH+ opportunities since yesterday. Sign in to personalize what Revenue Trigger watches for you.';
      }
    }catch{
      msg.textContent='Sign in to see the activity that deserves your attention today.';
    }
    return;
  }
  try{
    const r=await fetch(`${CONFIG.apiBase}/changes`,{headers:authHeaders()});
    const d=await r.json().catch(()=>({}));
    if(!r.ok)throw new Error(d.error||'Could not load changes');
    const s=d.summary||{};
    const visibleStats=[
      setChangedStat('chgOpp',s.opportunities),
      setChangedStat('chgHot',s.hot),
      setChangedStat('chgMajor',s.majorProjects),
      setChangedStat('chgComp',s.competitorMoves,{available:Boolean(d.competitorMovesAvailable)})
    ].filter(Boolean).length;
    document.querySelector('.changed-shell')?.setAttribute('data-visible-stats',String(visibleStats));
    const filterText=d.filters?.markets?.length?` in ${d.filters.markets.join(', ')}`:'';
    msg.textContent=s.opportunities
      ? `${s.opportunities} matched opportunities since yesterday${filterText}. HOT uses the same 75+ threshold as the opportunity table.`
      : `No opportunities matched your current market, industry and score filters since yesterday.`;
    $('#changedMoves').innerHTML=(d.competitorMoves||[]).slice(0,2).map(x=>`<div class="watch-move">• ${esc(x.title)}</div>`).join('');
  }catch(e){
    ['chgOpp','chgHot','chgMajor','chgComp'].forEach(id=>{const tile=document.getElementById(id)?.closest('.changed-stat');if(tile)tile.hidden=true;});
    document.querySelector('.changed-shell')?.setAttribute('data-visible-stats','0');
    msg.textContent='Could not load today’s change summary.';
  }
}
async function updateSelectedMarketSourceStatus(){
  if(!user)return; // Public feed freshness is owned by /feed, not upstream source health.
  const selected=$('#market')?.value||'all';
  $('#feedStatus').closest('.status')?.classList.remove('source-degraded');
  if(selected!=='Chandler')return;
  try{
    const r=await fetch(`${CONFIG.apiBase}/source-health?market=Chandler&days=7`);
    const d=await r.json().catch(()=>({}));
    if(d.status==='degraded'||d.ok===false){
      const last=d.storedFallback?.lastRefresh;
      const suffix=last?` • last stored refresh ${new Date(last.replace(' ','T')+'Z').toLocaleString()}`:'';
      $('#feedStatus').textContent=`Stored snapshot • Chandler city source temporarily unavailable${suffix}`;
      $('#feedStatus').closest('.status')?.classList.add('source-degraded');
    }else{
      $('#feedStatus').closest('.status')?.classList.remove('source-degraded');
    }
  }catch{}
}
async function loadPublic(){
 const requestId=++publicFeedRequest;
 const selected=$('#market')?.value||'all';
 const marketParam=selected!=='all'?`&markets=${encodeURIComponent(selected)}`:'';
 const feed=await RTUI.readFeed(`days=7&limit=8${marketParam}`);
 if(requestId!==publicFeedRequest)return;
 publicFeed=feed;leads=feed.rows;
 const available=Number(feed.counts?.available||feed.counts?.clusteredAvailable||leads.length);
 $('#feedStatus').textContent=feed.state==='unavailable'?feed.label:`Live preview • ${leads.length} of ${available||leads.length} opportunities`;
 $('#feedExplainer').textContent='Explore a live sample of current money events. Create a free account to reveal company names, exact project details and your personalized feed.';
 const status=$('#feedStatus').closest('.status');
 status?.classList.remove('source-degraded');status?.setAttribute('data-feed-state',feed.state);
 const note=$('#publicFeedNotice');note.hidden=!feed.notice;note.textContent=feed.notice;note.dataset.state=feed.state;
 render();
}
async function loadDashboard(){if(!user)return loadPublic();try{const r=await fetch(`${CONFIG.apiBase}/dashboard?limit=200`,{headers:authHeaders()});if(r.status===401){localStorage.removeItem('revenuetrigger_session');localStorage.removeItem('signalhound_session');user=null;updateUserUI();return loadPublic()}if(!r.ok)throw new Error();const d=await r.json();leads=d.leads||[];$('#feedStatus').textContent=`Personalized • ${leads.length} matched signals`;$('#feedExplainer').textContent=`Your ${planActive()} feed is filtered to your saved industry preferences and plan history.`;render();await updateSelectedMarketSourceStatus();}catch(e){toast('Could not load personalized feed.');loadPublic()}}
async function loadMe(){if(!token()){user=null;updateUserUI();return false}try{const r=await fetch(`${CONFIG.apiBase}/me`,{headers:authHeaders()});if(!r.ok)throw new Error();user=(await r.json()).user;updateUserUI();return true}catch{localStorage.removeItem('revenuetrigger_session');localStorage.removeItem('signalhound_session');user=null;updateUserUI();return false}}
function updateUserUI(){
  const permitToggle=$('#permitCompanyToggle')?.closest('.company-toggle-wrap');
  const pipelineToggle=$('#pipelineCompanyToggle')?.closest('.company-toggle-wrap');
  if(user){
    $('#accountBtn').textContent=user.email.split('@')[0];$('#accountBtn').classList.add('live');
    $('#savedFilter').style.display='inline-block';
    if(permitToggle)permitToggle.style.display='';
    if(pipelineToggle)pipelineToggle.style.display='';
    if($('#exportTop'))$('#exportTop').style.display=user.entitlements?.export&&planActive()!=='Beta'?'inline-flex':'none';
  }else{
    $('#accountBtn').textContent='Sign in';$('#accountBtn').classList.remove('live');
    $('#savedFilter').style.display='none';$('#savedFilter').value='all';
    if(permitToggle)permitToggle.style.display='none';
    if(pipelineToggle)pipelineToggle.style.display='none';
    if($('#exportTop'))$('#exportTop').style.display='none';
  }
}
function renderAccount(){if(!user){$('#accountLoggedOut').style.display='block';$('#accountLoggedIn').style.display='none';return}$('#accountLoggedOut').style.display='none';$('#accountLoggedIn').style.display='block';$('#aEmail').textContent=user.email;$('#aPlan').textContent=planActive();$('#aStatus').textContent=user.subscriptionStatus||'inactive';$('#aSaved').textContent=user.savedCount||0;$('#prefScore').value=String(user.preferences?.minScore||70);$('#prefAlert').value=user.entitlements?.alert||'none';const limit=user.entitlements?.industryLimit||1;$('#industryLimitText').textContent=`Your ${planActive()} plan allows ${limit} industr${limit===1?'y':'ies'}.`;$('#industryChecks').innerHTML=INDUSTRIES.map(i=>`<label class="check"><input type="checkbox" value="${esc(i)}" ${(user.preferences?.industries||[]).includes(i)?'checked':''}>${esc(i)}</label>`).join('');const marketLimit=user.entitlements?.marketLimit||1;$('#marketLimitText').textContent=`Your ${planActive()} plan allows ${marketLimit} market${marketLimit===1?'':'s'}.`;$('#marketChecks').innerHTML=LIVE_MARKETS.map(m=>`<label class="check"><input type="checkbox" value="${esc(m)}" ${(user.preferences?.markets||['Phoenix']).includes(m)?'checked':''}>${esc(m)}</label>`).join('');$('#exportBtn').disabled=!(user.entitlements?.export&&planActive()!=='Beta');$('#billingBtn').textContent=user.subscriptionStatus==='active'||user.subscriptionStatus==='trialing'?'Manage billing':'Upgrade plan'}

function renderOnboarding(){
  if(!user)return;
  const industryLimit=user.entitlements?.industryLimit||1;
  const marketLimit=user.entitlements?.marketLimit||1;
  const selectedIndustries=user.preferences?.industries||['Commercial services'];
  const selectedMarkets=user.preferences?.markets||['Phoenix'];

  $('#onboardingIndustries').innerHTML=INDUSTRIES.map(i=>`
    <label class="onboarding-option">
      <input type="checkbox" value="${esc(i)}" ${selectedIndustries.includes(i)?'checked':''}>
      <span>${esc(i)}</span>
    </label>`).join('');

  $('#onboardingMarkets').innerHTML=LIVE_MARKETS.map(m=>`
    <label class="onboarding-option">
      <input type="checkbox" value="${esc(m)}" ${selectedMarkets.includes(m)?'checked':''}>
      <span>${esc(m)}</span>
    </label>`).join('');

  $('#onboardingIndustryLimit').textContent=`Your ${planActive()} plan allows ${industryLimit} industr${industryLimit===1?'y':'ies'}.`;
  $('#onboardingMarketLimit').textContent=`Your ${planActive()} plan allows ${marketLimit} market${marketLimit===1?'':'s'}.`;
  $('#onboardingScore').value=String(user.preferences?.minScore||60);
  $('#onboardingAlertNote').textContent=planActive()==='Beta'
    ? 'Beta accounts use the personalized dashboard. Automated alert delivery begins with a paid plan.'
    : `Your ${planActive()} plan includes ${user.entitlements?.alert||'plan-based'} alert delivery.`;
}

function maybeOpenOnboarding(){
  if(!user||user.onboardingComplete)return;
  renderOnboarding();
  openModal('onboardingModal');
}

async function completeOnboarding(){
  if(!user)return;

  const industryLimit=user.entitlements?.industryLimit||1;
  const marketLimit=user.entitlements?.marketLimit||1;
  const industries=$$('#onboardingIndustries input:checked').map(x=>x.value);
  const markets=$$('#onboardingMarkets input:checked').map(x=>x.value);

  if(!industries.length){toast('Choose at least one industry.');return}
  if(industries.length>industryLimit){toast(`Your plan allows ${industryLimit} industr${industryLimit===1?'y':'ies'}.`);return}
  if(!markets.length){toast('Choose at least one market.');return}
  if(markets.length>marketLimit){toast(`Your plan allows ${marketLimit} market${marketLimit===1?'':'s'}.`);return}

  try{
    const r=await fetch(`${CONFIG.apiBase}/preferences`,{
      method:'POST',
      headers:authHeaders({'content-type':'application/json'}),
      body:JSON.stringify({
        industries,
        markets,
        minScore:+$('#onboardingScore').value
      })
    });
    const d=await r.json().catch(()=>({}));
    if(!r.ok)throw new Error(d.error||'Could not build your feed.');

    user=d.user;
    updateUserUI();
    renderAccount();
    closeModal('onboardingModal');
    toast('Your personalized feed is ready.');
    await loadDashboard();
    document.querySelector('#signals')?.scrollIntoView({behavior:'smooth'});
  }catch(e){
    toast(e.message||'Could not build your feed.');
  }
}

async function requestSignin(email){return RTAuth.requestSignin(email)}
async function verifyMagic(raw){const r=await fetch(`${CONFIG.apiBase}/auth/verify`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({token:raw})});const d=await r.json().catch(()=>({}));if(!r.ok)throw new Error(d.error||'Sign-in link failed');localStorage.setItem('revenuetrigger_session',d.session);localStorage.removeItem('signalhound_session');user=d.user;history.replaceState({},'',location.pathname+location.search);updateUserUI();toast('Signed in.');await loadDashboard();maybeOpenOnboarding();loadChanges();const pending=localStorage.getItem('revenuetrigger_pending_plan')||localStorage.getItem('signalhound_pending_plan');if(pending){localStorage.removeItem('revenuetrigger_pending_plan');localStorage.removeItem('signalhound_pending_plan');setTimeout(()=>buyPlan(pending),300)}}
$('#signinForm').addEventListener('submit',async e=>{e.preventDefault();const email=$('#signinEmail').value;$('#signinNotice').style.display='block';$('#signinNotice').textContent='Sending secure link…';try{const d=await requestSignin(email);if(d.dev&&d.magicLink){$('#signinNotice').innerHTML=`Development mode is enabled. <a style="color:#2aee61" href="${esc(d.magicLink)}">Open the sign-in link</a>.`}else $('#signinNotice').textContent='Check your email. The link expires in 15 minutes.'}catch(err){$('#signinNotice').textContent=err.message}});
async function toggleSave(id){if(!user){openSignin();return}const x=leads.find(v=>String(v.id)===String(id));if(!x)return;const next=!x.saved;const r=await fetch(`${CONFIG.apiBase}/saved`,{method:'POST',headers:authHeaders({'content-type':'application/json'}),body:JSON.stringify({leadId:id,saved:next})});if(!r.ok){toast('Could not update saved lead.');return}x.saved=next;user.savedCount=Math.max(0,(user.savedCount||0)+(next?1:-1));updateUserUI();render();if(currentLead&&String(currentLead.id)===String(id)){$('#mSave').textContent=next?'★ Saved':'☆ Save opportunity'}toast(next?'Opportunity saved.':'Removed from saved.')}
function toggleCurrentSave(){if(currentLead)toggleSave(currentLead.id)}
function showSavedOnly(){if(!user)return openSignin();$('#savedFilter').value='saved';savedOnly=true;document.querySelector('#signals').scrollIntoView({behavior:'smooth'});render()}
async function savePreferences(){if(!user)return;const limit=user.entitlements?.industryLimit||1;let industries=$$('#industryChecks input:checked').map(x=>x.value);if(industries.length>limit){toast(`Your plan allows ${limit} industr${limit===1?'y':'ies'}.`);return}if(!industries.length){toast('Choose at least one industry.');return}const marketLimit=user.entitlements?.marketLimit||1;let markets=$$('#marketChecks input:checked').map(x=>x.value);if(markets.length>marketLimit){toast(`Your plan allows ${marketLimit} market${marketLimit===1?'':'s'}.`);return}if(!markets.length){toast('Choose at least one market.');return}const r=await fetch(`${CONFIG.apiBase}/preferences`,{method:'POST',headers:authHeaders({'content-type':'application/json'}),body:JSON.stringify({industries,markets,minScore:+$('#prefScore').value})});const d=await r.json().catch(()=>({}));if(!r.ok){toast(d.error||'Could not save preferences.');return}user=d.user;updateUserUI();renderAccount();closeModal('accountModal');toast('Preferences saved.');loadDashboard();loadChanges()}
async function buyPlan(plan){if(RTConfig.checkoutDisabled)return;if(!user){localStorage.setItem('revenuetrigger_pending_plan',plan);openSignin();toast(`Sign in first to choose ${plan}.`);return}try{const r=await fetch(`${CONFIG.apiBase}/billing/checkout`,{method:'POST',headers:authHeaders({'content-type':'application/json'}),body:JSON.stringify({plan})});const d=await r.json();if(!r.ok)throw new Error(d.error||'Checkout unavailable');location.href=d.url}catch(err){toast(err.message)}}
async function syncBilling(){
  if(!user)return null;
  try{
    const r=await fetch(`${CONFIG.apiBase}/billing/sync`,{method:'POST',headers:authHeaders()});
    const d=await r.json().catch(()=>({}));
    if(r.ok&&d.user){
      user=d.user;
      updateUserUI();
      renderAccount();
      return user;
    }
  }catch(e){}
  return null;
}
async function manageBilling(){if(!user)return;if(!['active','trialing','past_due'].includes(user.subscriptionStatus)){closeModal('accountModal');location.href='/#pricing';return}try{const r=await fetch(`${CONFIG.apiBase}/billing/portal`,{method:'POST',headers:authHeaders()});const d=await r.json();if(!r.ok)throw new Error(d.error||'Billing portal unavailable');location.href=d.url}catch(err){toast(err.message)}}
async function exportCsv(){if(!user){openSignin();return}if(!(user.entitlements?.export&&planActive()!=='Beta')){toast('CSV export is available on Hunter and Territory.');return}const r=await fetch(`${CONFIG.apiBase}/export.csv`,{headers:authHeaders()});if(!r.ok){const d=await r.json().catch(()=>({}));toast(d.error||'Export failed');return}const blob=await r.blob(),url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download='revenuetrigger-leads.csv';a.click();URL.revokeObjectURL(url)}
async function logout(){try{await fetch(`${CONFIG.apiBase}/logout`,{method:'POST',headers:authHeaders()})}catch{}localStorage.removeItem('revenuetrigger_session');localStorage.removeItem('signalhound_session');user=null;closeModal('accountModal');savedOnly=false;updateUserUI();toast('Signed out.');loadPublic()}

let pipelineRows=[],pipelineSourceStatus='live';

async function loadPipeline(){
  const status=$('#pipelineStatus');
  const list=$('#pipelineList');
  if(status)status.textContent='Loading Chandler early pipeline…';
  try{
    const r=await fetch(`${CONFIG.apiBase}/pipeline?market=Chandler`,user?{headers:authHeaders()}:{});
    const d=await r.json().catch(()=>({}));
    if(!r.ok||d.ok===false||d.sourceStatus==='unavailable'){
      pipelineRows=[];
      if(status)status.textContent='Chandler source temporarily unavailable';
      if(list)list.innerHTML=`<div class="pipeline-empty pipeline-source-alert">${esc(d.message||'The City of Chandler Early Pipeline source is temporarily unavailable. Revenue Trigger will not substitute live permit records for pre-construction signals.')}</div>`;
      return;
    }
    pipelineRows=d.pipeline||[];pipelineSourceStatus=d.sourceStatus||'live';
    renderPipeline();
    if(d.sourceStatus==='degraded'&&status)status.textContent=`Source degraded • ${pipelineRows.length} Chandler early-pipeline opportunities`;
  }catch{
    pipelineRows=[];
    if(status)status.textContent='Chandler source temporarily unavailable';
    if(list)list.innerHTML='<div class="pipeline-empty pipeline-source-alert">The City of Chandler Early Pipeline source could not be reached. Try Refresh pipeline again shortly.</div>';
  }
}


function pipelineStageLabel(stage=''){
  const v=String(stage||'').trim().toUpperCase();
  if(v==='PRE-TECH')return 'Pre-Tech';
  if(v==='APPROVED PROJECTS')return 'Approved';
  return sentenceCasePermit(stage||'');
}
function pipelineHeadline(x={}){
  let title=displayEventTitle(x);
  title=title.replace(/\s*\/\s*/g,' · ').replace(/\s*-\s*TI\b/gi,' · Tenant improvement');
  const words=title.split(/\s+/).map((w,i)=>{
    const bare=w.replace(/[^A-Za-z0-9&'-]/g,'');
    if(/^(e|w|n|s)$/i.test(bare))return w.toUpperCase();
    if(/^(llc|inc|corp|hvac|ev|ada|ti)$/i.test(bare))return w.toUpperCase();
    if(i>0&&/^(and|or|the|of|at|in|on|for|to)$/i.test(bare))return w.toLowerCase();
    return w.charAt(0).toUpperCase()+w.slice(1);
  }).join(' ');
  return truncateAtWord(words,70);
}
function pipelineSummary(x){
  const raw=permitDescriptionText(x)||cleanPermitText(x.scope||'');
  if(!raw)return '';
  const summary=sentenceCasePermit(raw).replace(/^\s*(?:pre[- ]?tech|approved projects?)\s*[—–:-]?\s*/i,'').trim();
  return truncateAtWord(summary,78);
}

function openPipelineLead(id){
  if(!user){
    RTAuth.set('revenuetrigger_return_to','/signals#pipeline');
    openSignin();
    toast('Create a free account or sign in to reveal Early Pipeline details.');
    return;
  }
  const x=pipelineRows.find(v=>String(v.id)===String(id));
  if(!x)return;

  const fits=Object.entries(x.sellerFit||{})
    .sort((a,b)=>b[1]-a[1])
    .filter(([k,v])=>v>=20)
    .slice(0,6);

  const fitText=fits.length
    ? fits.map(([k,v])=>`${k} ${v}`).join(' • ')
    : (x.categories||[]).join(', ');

  $('#pTitle').textContent=displayEventTitle(x);
  $('#pGrid').innerHTML=[
    ['Score',(x.score??'—')+' / 100'],
    ['Temperature',x.temperature||'—'],
    ['Stage',pipelineStageLabel(x.stage)||'—'],
    ['Permit / project ID',x.permit||'—'],
    ['Market',x.market||'Chandler'],
    ['Approval date',x.date?new Date(x.date).toLocaleDateString():'Not published'],
    ['Company / participant',displayCompanyName(x.company)],
    ['Role',x.companyRole||'—'],
    ['Seller fit',fitText],
    ['Source',x.source||'City of Chandler DSActiveProjects']
  ].map(([a,b])=>`<div class="detail"><small>${esc(a)}</small><strong>${esc(b)}</strong></div>`).join('');

  const b=x.scoreBreakdown||{};
  const scoreLines=[
    ['Project / permit type',b.projectType],
    ['Scope intensity',b.scopeIntensity],
    ['Commercial relevance',b.commercialRelevance],
    ['Permit stage',b.permitStage],
    ['Economic size',b.economicSize],
    ['Seller breadth',b.sellerBreadth],
    ['Recency',b.recency],
    ['Negative adjustment',b.negative]
  ].filter(([,v])=>v!==undefined)
   .map(([k,v])=>`${esc(k)}: <strong>${Number(v)>0?'+':''}${esc(v)}</strong>`)
   .join('<br>');

  $('#pWhy').innerHTML=
    `<strong>Full project description</strong><br>${esc(x.scope||'No detailed description published.')}<br><br>`+
    (scoreLines?`<strong>Score breakdown</strong><br>${scoreLines}<br><br>`:'')+
    `<span style="color:#8fa59b">Early Pipeline items are pre-construction intelligence and are kept separate from the live 7-day permit feed.</span>`;

  openModal('pipelineModal');
}

function renderPipeline(){
  const list=$('#pipelineList');
  if(!list)return;

  const stage=$('#pipelineStage')?.value||'all';
  const minScore=Number($('#pipelineMinScore')?.value||0);

  const baseRows=pipelineRows.filter(x=>
    (stage==='all'||x.stage===stage) &&
    Number(x.score||0)>=minScore
  );
  const pipelineListedCount=baseRows.filter(x=>Boolean(String(x.company||'').trim())).length;
  const pipelineNotListedCount=Math.max(0,baseRows.length-pipelineListedCount);
  const pipelineListedBtn=$('#pipelineCompanyToggle [data-value="listed"]');
  const pipelineNotListedBtn=$('#pipelineCompanyToggle [data-value="not-listed"]');
  if(pipelineListedBtn)pipelineListedBtn.textContent=`Listed (${pipelineListedCount})`;
  if(pipelineNotListedBtn)pipelineNotListedBtn.textContent=`Not Listed (${pipelineNotListedCount})`;
  const rows=user?baseRows.filter(x=>pipelineCompanyFilter==='listed'?Boolean(String(x.company||'').trim()):!String(x.company||'').trim()):baseRows;

  const coverageLabel=pipelineCompanyFilter==='listed'?'Listed':'Not Listed';
  $('#pipelineStatus').textContent=user
    ? `${pipelineSourceStatus==='degraded'?'Source degraded · ':''}${rows.length} ${coverageLabel} · ${baseRows.length} total at current stage/score`
    : `Live preview · ${rows.length} early-stage opportunities shown`;

  list.innerHTML=rows.slice(0,120).map(x=>`
    <div class="pipeline-lead">
      <div class="score">${esc(x.score)}</div>
      <div class="pipeline-main">
        <div class="leadname">${esc(displayEventTitle(x))}</div>
        <div class="pipeline-copy">${esc(pipelineSummary(x))}</div>
        <div class="pipeline-permit">${esc(x.permit||'—')}<span class="pipeline-inline-stage"> · ${esc(pipelineStageLabel(x.stage))}</span></div>
      </div>
      <div class="pipeline-stage">${esc(pipelineStageLabel(x.stage))}</div>
      <div class="pipeline-company-cell">${user?(x.company?`<strong>${esc(displayCompanyName(x.company))}</strong><small>${esc(x.companyRole||'Participant')}</small>`:'<span class="company-missing">Not listed</span>'):'<span class="rt-public-lock">Sign in to reveal</span>'}</div>
      <div class="chips pipeline-seller">${(x.categories||[]).slice(0,2).map(c=>`<span class="chip">${esc(c)}</span>`).join(' ')}</div>
      <div class="pipeline-temperature ${x.temperature==='HOT'?'hot':x.temperature==='WARM'?'warm':x.temperature==='WATCH'?'watch':'low'}">${esc(x.temperature||'LOW')}</div>
      <div class="pipeline-actions"><button class="view" onclick="openPipelineLead('${String(x.id).replace(/'/g,"\\'")}')">${user?'View':'Reveal'}</button></div>
    </div>
  `).join('') || '<div class="pipeline-empty">No pipeline opportunities match the current filters.</div>';
}


function bindCompanyToggle(rootId,onChange){
  const root=$('#'+rootId);
  if(!root)return;
  const buttons=[...root.querySelectorAll('.company-toggle-btn')];
  buttons.forEach(btn=>btn.addEventListener('click',()=>{
    buttons.forEach(b=>b.classList.toggle('active',b===btn));
    onChange(btn.dataset.value);
  }));
}
bindCompanyToggle('permitCompanyToggle',value=>{permitCompanyFilter=value;render()});
bindCompanyToggle('pipelineCompanyToggle',value=>{pipelineCompanyFilter=value;renderPipeline()});

$('#market').addEventListener('change',async()=>{if(user){render();await updateSelectedMarketSourceStatus()}else{await loadPublic();await updateSelectedMarketSourceStatus()}});['industry','minScore','sortFeed','savedFilter'].forEach(id=>$('#'+id).addEventListener('change',render));$('#pipelineStage')?.addEventListener('change',renderPipeline);$('#pipelineMinScore')?.addEventListener('change',renderPipeline);$('#pipelineRefresh')?.addEventListener('click',loadPipeline);$('#search').addEventListener('input',render);$$('.modal').forEach(m=>m.addEventListener('click',e=>{if(e.target===m)closeModal(m.id)}));
async function applyRouteState(){
  const q=new URLSearchParams(location.search);
  if(q.get('saved')==='1'){
    if(user){$('#savedFilter').value='saved';savedOnly=true;render()}
    else{RTAuth.set('revenuetrigger_return_to','/signals?saved=1');openSignin()}
  }
  if(q.get('account')==='1')await openAccount();
}
(async()=>{
  const q=new URLSearchParams(location.search), magic=new URLSearchParams(location.hash.slice(1)).get('magic');
  if(magic){try{await verifyMagic(magic)}catch(e){toast(e.message)}}
  else{const signed=await loadMe();if(signed){await loadDashboard();maybeOpenOnboarding();loadChanges()}else{await loadPublic();loadChanges()}}
  loadPipeline();
  if(q.get('billing')==='success'){toast('Subscription checkout completed. Updating your account…');await syncBilling();await loadDashboard()}
  if(q.get('billing')==='cancel')toast('Checkout canceled.');
  await applyRouteState();
  const pending=RTAuth.pendingPlan();
  if(user&&pending){RTAuth.clearPendingPlan();await buyPlan(pending)}
})();

document.getElementById('leadList').addEventListener('click',e=>{
 const b=e.target.closest('[data-lead-action]');if(!b)return;
 if(b.dataset.leadAction==='view')openLead(b.dataset.id);else toggleSave(b.dataset.id);
});
