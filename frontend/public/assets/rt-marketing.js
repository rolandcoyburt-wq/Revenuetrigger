/* Homepage controller: public data + existing root auth and billing callbacks. */
let marketingUser=null;
function openSignin(){document.getElementById('signinModal').classList.add('open');document.getElementById('signinEmail').focus()}
function closeSignin(){document.getElementById('signinModal').classList.remove('open')}
function accountAction(){if(marketingUser)location.href='/signals?account=1';else openSignin()}
function homeNotice(message){const el=document.getElementById('callbackNotice');el.hidden=false;el.textContent=message;const link=document.createElement('a');link.href='/signals?account=1';link.textContent=' Open your account →';el.append(link)}
function syncHomeAccount(){document.getElementById('accountBtn').textContent=marketingUser?'Account':'Sign in'}
async function buyPlan(plan){
 if(!['Scout','Hunter','Territory'].includes(plan))return;
 if(RTConfig.checkoutDisabled)return;
 if(!marketingUser){RTAuth.set('revenuetrigger_pending_plan',plan);openSignin();return}
 try{const d=await RTAuth.request('/billing/checkout',{method:'POST',authenticated:true,body:{plan}});location.href=d.url}
 catch(e){homeNotice(e.message);if(!RTAuth.token()){marketingUser=null;syncHomeAccount();openSignin()}}
}
async function sendHomeLink(email){
 const notice=document.getElementById('signinNotice');notice.hidden=false;notice.textContent='Sending secure link…';
 try{await RTAuth.requestSignin(email);notice.textContent='Check your email. The link expires in 15 minutes.'}catch(e){notice.textContent=e.message}
}
document.getElementById('signinForm').addEventListener('submit',async e=>{e.preventDefault();const button=e.currentTarget.querySelector('button');button.disabled=true;await sendHomeLink(document.getElementById('signinEmail').value);button.disabled=false});
document.getElementById('capture').addEventListener('submit',async e=>{e.preventDefault();const email=document.getElementById('email').value;document.getElementById('signinEmail').value=email;openSignin();await sendHomeLink(email)});
document.getElementById('signinModal').addEventListener('click',e=>{if(e.target.id==='signinModal')closeSignin()});
document.getElementById('marketList').innerHTML=RTConfig.markets.filter(m=>!['Fort Worth','Dallas'].includes(m)).map(m=>`<span>${RTUI.esc(m)}</span>`).join('');
// Hero-only context uses public teaser fields, never hidden Action Intelligence.
function heroPublicContext(x,now=new Date()){
 const {esc}=RTUI;
 const labels={'APPLICATION':'Application','PERMIT ISSUED':'Permit issued','PRE-TECH':'Pre-technical review','PLANNING':'Planning','APPROVED PROJECTS':'Approved project','CONSTRUCTION':'Construction','UNDER CONSTRUCTION':'Construction','COMPLETE':'Completed project'};
 const stage=labels[x.stage]||'Project';
 let timing='';
 const event=x.date?new Date(x.date):null;
 if(event&&Number.isFinite(event.getTime())){
  const day=d=>Date.UTC(d.getFullYear(),d.getMonth(),d.getDate());
  const age=Math.round((day(now)-day(event))/86400000);
  timing=age===0?' today':age===1?' yesterday':` on ${event.toLocaleDateString('en-US',{month:'short',day:'numeric',year:'numeric'})}`;
 }
 const summary=`${stage} activity recorded${timing}.`;
 const value=Number(x.value)>0?` Estimated service opportunity: ${RTUI.money(x)}.`:'';
 const why=`<div class="rt-reason rt-why-now"><small>Why now</small><p>${esc(summary+value)} <button type="button" class="rt-hero-reveal" onclick="openSignin()">Sign in to see available company and project details.</button></p></div>`;
 const steps=[['APPLICATION','Application'],['PERMIT ISSUED','Permit issued'],['CONTRACTOR ASSIGNED','Contractor assigned']];
 const timeline=`<section class="rt-project-stage" aria-label="Published project stage"><small>Project stage</small><strong>${esc(labels[x.stage]||'Not published')}</strong><ol class="rt-hero-stage-track">${steps.map(([key,label])=>`<li${x.stage===key?' aria-current="step"':''}><span>${label} <span class="rt-hero-stage-dot" aria-hidden="true">${x.stage===key?'●':'○'}</span></span><span class="sr-only">${x.stage===key?' — published stage':' — not confirmed'}</span></li>`).join('')}</ol><p class="rt-hero-stage-key">Filled dot: published stage. Hollow dots: not confirmed.</p></section>`;
 return {why,timeline};
}
async function loadMarketingSignals(){
 const {esc,badge,opportunityCard,triggerTimeline,decision,money}=RTUI;
 let feed;
 try{
  feed=await RTUI.readFeed('days=7&limit=3');
  const note=document.getElementById('homeFeedNotice');
  note.hidden=!feed.notice;note.textContent=feed.notice;note.dataset.state=feed.state;
  document.getElementById('heroState').textContent=feed.label;
  if(feed.state==='unavailable')throw new Error('Feed unavailable');
  const rows=feed.rows.slice(0,3);
  if(!rows.length){document.getElementById('heroState').textContent='No current records';throw new Error('No current opportunities were returned. Open the feed to explore markets and filters.')}
  const x=rows[0],heroContext=heroPublicContext(x);
  document.getElementById('heroState').textContent=feed.label;
  document.getElementById('heroSignal').innerHTML=`<span class="rt-kicker">${esc(x.market)} / ${esc(x.permit||'Public record')}</span><div class="rt-hero-priority"><h2>${esc(RTFormat.displayEventTitle(x))}</h2>${badge(x)}</div><p class="rt-muted">${esc(RTFormat.displayAddress(x.address||x.market))}</p>${heroContext.timeline}<div class="rt-command-value"><div><small>Estimated service opportunity</small><strong class="rt-money">${money(x)}</strong></div><div><small>Opportunity score</small><strong class="rt-hero-score">${esc(x.score??'—')} <span>/100</span></strong></div></div>${x.officialPermitValue?`<p class="rt-muted">Official permit valuation: ${esc(new Intl.NumberFormat('en-US',{style:'currency',currency:'USD',maximumFractionDigits:0}).format(x.officialPermitValue))}</p>`:''}${heroContext.why}<a class="rt-text-link" href="/signals">Explore the opportunity feed <span aria-hidden="true">↗</span></a>`;
  document.getElementById('signalPreviews').innerHTML=rows.map(x=>opportunityCard(x,{preview:true})).join('');
  const tickerItems=rows.map(x=>`<span class="rt-ticker-item"><strong>${esc(x.market)}</strong> · ${esc(RTFormat.displayEventTitle(x))}${Number(x.value)>0?' · '+money(x):''}</span>`).join('');
  document.getElementById('marketTicker').innerHTML=`<div class="rt-ticker-group">${tickerItems}</div><div class="rt-ticker-group" aria-hidden="true">${tickerItems}</div>`;
  const rich=rows.find(x=>x.actionIntelligence&&Object.keys(x.actionIntelligence).length)||x;
  document.getElementById('decisionDemo').innerHTML=`<span class="rt-kicker">${esc(rich.market)} / ${esc(rich.permit||'Public record')}</span><h3>${esc(RTFormat.displayEventTitle(rich))}</h3>${decision(rich)||'<p class="rt-unavailable">Additional intelligence is not published for this record.</p>'}${triggerTimeline(rich)}`;
 }catch(e){
  const text=feed?.requestError?feed.notice:e.message.startsWith('No current')?e.message:'Current opportunities are temporarily unavailable. Please try the opportunity feed again shortly.';
  if(!e.message.startsWith('No current')){document.getElementById('heroState').textContent=feed?.label||'Feed unavailable';const note=document.getElementById('homeFeedNotice');note.hidden=false;note.textContent=feed?.notice||RTUI.feedState(null).notice;note.dataset.state='unavailable';}
  document.getElementById('heroSignal').innerHTML=`<p class="rt-unavailable">${esc(text)}</p><a class="rt-text-link" href="/signals">Open the opportunity feed →</a>`;
  document.getElementById('signalPreviews').innerHTML=`<p class="rt-preview-empty">${esc(text)}</p>`;
  document.getElementById('marketTicker').textContent='No current activity available to display.';
  document.getElementById('decisionDemo').innerHTML='<p class="rt-unavailable">Current record details will appear here when the feed is available.</p>';
 }
}
(async()=>{
 // Legacy anchor links remain useful after the application moves off the root.
 if(location.hash==='#signals'||location.hash==='#pipeline'){location.replace('/signals'+(location.hash==='#pipeline'?'#pipeline':''));return}
 const q=new URLSearchParams(location.search), magic=new URLSearchParams(location.hash.slice(1)).get('magic');
 if(magic){
  try{
   marketingUser=await RTAuth.verifyMagic(magic);
   history.replaceState({},'',location.pathname+location.search);
   const dest=RTAuth.get('revenuetrigger_return_to');RTAuth.remove('revenuetrigger_return_to');
   location.replace(dest==='/signals?saved=1'?dest:'/signals');return;
  }catch(e){history.replaceState({},'',location.pathname+location.search);homeNotice(e.message);openSignin()}
 }else if(RTAuth.token()){
  try{marketingUser=(await RTAuth.request('/me',{authenticated:true})).user}catch{marketingUser=null}
 }
 syncHomeAccount();
 if(q.get('billing')==='success'){
  homeNotice('Subscription checkout completed. Updating your account…');
  if(marketingUser){
   try{const d=await RTAuth.request('/billing/sync',{method:'POST',authenticated:true});marketingUser=d.user||marketingUser;syncHomeAccount();homeNotice('Checkout returned successfully. Open your account to review your subscription status.')}catch(e){homeNotice('Checkout returned successfully, but account sync is not available yet. Please open your account and try again.')}
  }else homeNotice('Checkout returned successfully. Sign in to review your subscription status.');
  q.delete('billing');history.replaceState({},'',location.pathname+(q.size?'?'+q.toString():''));
 }else if(q.get('billing')==='cancel'){homeNotice('Checkout canceled. You can choose a plan whenever you are ready.');q.delete('billing');history.replaceState({},'',location.pathname+(q.size?'?'+q.toString():'')+'#pricing')}
})();
loadMarketingSignals();

const tickerToggle=document.querySelector('.rt-ticker-toggle');
if(tickerToggle)tickerToggle.addEventListener('click',()=>{const paused=tickerToggle.getAttribute('aria-pressed')!=='true';tickerToggle.setAttribute('aria-pressed',String(paused));tickerToggle.setAttribute('aria-label',`${paused?'Resume':'Pause'} market activity scrolling`);tickerToggle.textContent=paused?'▶':'Ⅱ';document.querySelector('.rt-ticker').classList.toggle('is-paused',paused)});
