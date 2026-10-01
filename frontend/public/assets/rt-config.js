/* One market list. Add future markets only after Core integrates their adapters. */
window.RTConfig=Object.freeze({
 checkoutDisabled:false,
 // Only this feature preview uses its matching backend; production stays unchanged.
 apiBase:typeof location!=='undefined'&&location.hostname==='feature-public-opportunity-funnel-v1-signalhound-phoenix.rolandcoyburt.workers.dev'
  ?'https://feature-public-opportunity-funnel-v1-signalhound-api.rolandcoyburt.workers.dev/api'
  :'https://api.revenuetrigger.ai/api',
 markets:Object.freeze(['Phoenix','Tempe','Tucson','Scottsdale','Mesa','Chandler','Fort Worth'])
});
