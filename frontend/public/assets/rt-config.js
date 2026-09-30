/* One market list. Add future markets only after Core integrates their adapters. */
window.RTConfig=Object.freeze({
 apiBase: (()=>{try{return localStorage.getItem('revenuetrigger_api')||localStorage.getItem('signalhound_api')||'https://api.revenuetrigger.ai/api'}catch{return 'https://api.revenuetrigger.ai/api'}})(),
 markets:Object.freeze(['Phoenix','Tempe','Tucson','Scottsdale','Mesa','Chandler'])
});
