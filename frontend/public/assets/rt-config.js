/* One market list. Add future markets only after Core integrates their adapters. */
window.RTConfig=Object.freeze({
 checkoutDisabled:false,
 // This feature build uses its matching backend on preview aliases and version URLs.
 apiBase:typeof location!=='undefined'&&location.hostname.endsWith('-signalhound-phoenix.rolandcoyburt.workers.dev')
  ?'https://5e4cedeb-signalhound-api.rolandcoyburt.workers.dev/api'
  :'https://api.revenuetrigger.ai/api',
 markets:Object.freeze(['Phoenix','Tempe','Tucson','Scottsdale','Mesa','Chandler','Fort Worth','Dallas'])
});
