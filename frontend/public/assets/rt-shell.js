/* Navigation markup shared by static pages. Feature handlers remain page-owned. */
(()=>{
 const host=document.getElementById('rt-header');if(!host)return;
 const app=host.dataset.shell==='app';
 const links=app?[['Opportunities','/signals'],['Early Pipeline','/signals#pipeline'],['Competitors','/competitors'],['Saved','/signals?saved=1']]:[['Product','/#product'],['Solutions','/#solutions'],['Markets','/#markets'],['Pricing','/#pricing'],['Resources','/sources']];
 const active=href=>href===(location.pathname+location.search+location.hash)||href===location.pathname&&!location.search&&!location.hash;
 const nav=links.map(([label,href])=>`<a href="${href}"${active(href)?' aria-current="page"':''}>${label}</a>`).join('');
 host.innerHTML=`<header class="rt-topbar"><nav class="rt-nav wrap" aria-label="${app?'Application':'Main'} navigation"><a href="/" class="rt-brand"><img src="/assets/RT-Logo-WHT-BG.svg?v=site-green" alt="Revenue Trigger"></a><div class="rt-links">${nav}</div><button id="accountBtn" class="rt-account" type="button">Sign in</button>${app?'':'<a class="rt-nav-cta" href="/signals">See opportunities <span aria-hidden="true">↗</span></a>'}<details class="rt-menu"><summary aria-label="Open navigation">Menu <span aria-hidden="true">☰</span></summary><div>${nav}${app?'<a href="/">Revenue Trigger home</a>':'<a href="/signals">See opportunities ↗</a>'}</div></details></nav></header>`;
 document.getElementById('accountBtn').addEventListener('click',()=>{
  if(typeof window.openAccount==='function')window.openAccount();
  else if(typeof window.accountAction==='function')window.accountAction();
  else if(typeof window.openSignin==='function')window.openSignin();
 });
 host.querySelectorAll('.rt-menu a').forEach(a=>a.addEventListener('click',()=>host.querySelector('details').open=false));
 // Keyboard and focus support for the pre-existing modal implementations.
 let lastFocus;const observer=new MutationObserver(()=>{
   const modal=document.querySelector('.modal.open,.modal.show');
   if(modal&&!modal.dataset.focused){lastFocus=document.activeElement;modal.dataset.focused='1';modal.setAttribute('role','dialog');modal.setAttribute('aria-modal','true');modal.setAttribute('aria-label',modal.querySelector('h2')?.textContent||'Dialog');modal.querySelector('input,button,a')?.focus()}
   document.querySelectorAll('.modal[data-focused]').forEach(m=>{if(!m.classList.contains('open')&&!m.classList.contains('show')){delete m.dataset.focused;lastFocus?.focus()}});
 });
 const observeModals=()=>document.querySelectorAll('.modal').forEach(m=>observer.observe(m,{attributes:true,attributeFilter:['class']}));
 if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',observeModals);else observeModals();
 document.addEventListener('keydown',e=>{
  const modal=document.querySelector('.modal.open,.modal.show');if(!modal)return;
  if(e.key==='Escape'){modal.classList.remove('open','show');return}
  if(e.key==='Tab'){const els=[...modal.querySelectorAll('a,button,input,select,[tabindex="0"]')].filter(x=>!x.disabled&&x.getClientRects().length);const first=els[0],last=els.at(-1);if(e.shiftKey&&document.activeElement===first){e.preventDefault();last?.focus()}else if(!e.shiftKey&&document.activeElement===last){e.preventDefault();first?.focus()}}
 });
})();
