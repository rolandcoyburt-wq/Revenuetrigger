/* Mobile presentation experiment. Existing controls and data handlers stay intact. */
(()=>{
 const init=()=>{
  const mobile=matchMedia('(max-width:700px)');
  const updates=[];
  document.querySelectorAll('.pricing').forEach((grid,index)=>{
   const cards=[...grid.querySelectorAll('.price')];if(cards.length!==3)return;
   let selected=1,compare=false;
   const controls=document.createElement('div');controls.className='rt-mobile-plans';
   controls.innerHTML='<div class="rt-plan-choices" role="group" aria-label="Choose a plan to view"></div><button class="rt-compare-plans" type="button">Compare all plans <span aria-hidden="true">↓</span></button>';
   grid.before(controls);
   const buttons=cards.map((card,i)=>{
    const button=document.createElement('button');button.type='button';button.textContent=card.querySelector('h3').textContent;
    card.id=card.id||`mobile-plan-${index}-${i}`;button.setAttribute('aria-controls',card.id);
    controls.firstElementChild.append(button);button.addEventListener('click',()=>{selected=i;compare=false;paint()});return button;
   });
   const toggle=controls.lastElementChild;
   const paint=()=>{
    cards.forEach((card,i)=>card.classList.toggle('rt-mobile-plan-hidden',!compare&&i!==selected));
    buttons.forEach((button,i)=>button.setAttribute('aria-pressed',String(!compare&&i===selected)));
    toggle.setAttribute('aria-expanded',String(compare));toggle.textContent=compare?'Show one plan ↑':'Compare all plans ↓';
   };
   toggle.addEventListener('click',()=>{compare=!compare;paint()});paint();
  });
  let nextId=0;
  function disclose(container,nodes,label){
   if(!nodes.length)return;
   const body=document.createElement('div');body.className='rt-mobile-disclosure-body';body.id=`mobile-details-${++nextId}`;
   nodes[0].before(body);nodes.forEach(node=>body.append(node));
   const button=document.createElement('button');button.type='button';button.className='rt-mobile-disclosure-toggle';button.setAttribute('aria-controls',body.id);body.before(button);
   let open=false;
   const paint=()=>{body.classList.toggle('rt-mobile-collapsed',!open);button.setAttribute('aria-expanded',String(open));button.textContent=(open?'Less detail −':label+' +')};
   button.addEventListener('click',()=>{open=!open;paint()});paint();
  }
  document.querySelectorAll('.sources-page-grid .source').forEach(card=>disclose(card,[...card.children].filter(x=>x.matches('p,.source-detail')),'Source details'));
  document.querySelectorAll('.rt-market-panel').forEach(card=>disclose(card,[...card.children].filter(x=>x.matches('p')),'Coverage details'));
  // Keep feature headings and primary actions visible; expand explanatory illustrations.
  [['#intelligence','.rt-decision-grid','Explore decision intelligence'],['#early-pipeline','.rt-stage-preview','See the stage guide'],['#competitor-intelligence','.rt-competitor-preview','Explore the product overview'],['#solutions','.rt-trades','Explore trades']].forEach(([selector,child,label])=>{
   const section=document.querySelector(selector),content=section?.querySelector(child);if(content)disclose(content.parentElement,[content],label);
  });
  document.querySelectorAll('#signals .filters').forEach(filters=>{
   const bar=document.createElement('button');bar.type='button';bar.className='rt-mobile-filter-toggle';
   filters.id=filters.id||'mobile-feed-filters';bar.setAttribute('aria-controls',filters.id);filters.before(bar);
   let open=false;
   const paint=()=>{
    const text=id=>{const select=document.getElementById(id);return select?.selectedOptions?.[0]?.textContent||''};
    const summary=[text('market'),text('industry'),text('minScore')].filter(Boolean).join(' · ');
    bar.replaceChildren();const title=document.createElement('strong');title.textContent=open?'Close filters −':'Filters +';const small=document.createElement('span');small.textContent=summary;
    bar.append(title,small);bar.setAttribute('aria-expanded',String(open));filters.classList.toggle('rt-mobile-filters-closed',!open);
   };
   bar.addEventListener('click',()=>{open=!open;paint()});filters.addEventListener('change',paint);paint();
   updates.push(paint);
  });
  mobile.addEventListener('change',()=>updates.forEach(update=>update()));
 };
 if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',init,{once:true});else init();
})();
