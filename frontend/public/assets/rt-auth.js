/* Shared session/API primitives. No backend callback or entitlement changes. */
window.RTAuth=(()=>{
 const get=k=>{try{return localStorage.getItem(k)||''}catch{return ''}};
 const set=(k,v)=>localStorage.setItem(k,v);
 const remove=k=>{try{localStorage.removeItem(k)}catch{}};
 const token=()=>get('revenuetrigger_session')||get('signalhound_session');
 const headers=(extra={})=>({...extra,...(token()?{Authorization:`Bearer ${token()}`}:{})});
 const clear=()=>{remove('revenuetrigger_session');remove('signalhound_session')};
 async function request(path,{method='GET',body,authenticated=false}={}){
   const r=await fetch(RTConfig.apiBase+path,{method,headers:{...(body?{'content-type':'application/json'}:{}),...(authenticated?headers():{})},...(body?{body:JSON.stringify(body)}:{})});
   const d=await r.json().catch(()=>({}));
   if(!r.ok){if(r.status===401&&authenticated)clear();throw new Error(d.error||'This request could not be completed. Please try again.')}
   return d;
 }
 const requestSignin=email=>request('/auth/request',{method:'POST',body:{email}});
 async function verifyMagic(raw){
   const d=await request('/auth/verify',{method:'POST',body:{token:raw}});
   if(!d.session)throw new Error('The sign-in link did not return a session. Please request a new link.');
   set('revenuetrigger_session',d.session);remove('signalhound_session');return d.user;
 }
 const pendingPlan=()=>get('revenuetrigger_pending_plan')||get('signalhound_pending_plan');
 const clearPendingPlan=()=>{remove('revenuetrigger_pending_plan');remove('signalhound_pending_plan')};
 return {get,set,remove,token,headers,clear,request,requestSignin,verifyMagic,pendingPlan,clearPendingPlan};
})();
