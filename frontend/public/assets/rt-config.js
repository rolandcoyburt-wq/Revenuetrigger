/* One market list. Add future markets only after Core integrates their adapters. */
window.RTConfig=Object.freeze({
 checkoutDisabled:false,
 // Isolated combined-preview backend; do not inherit a stale production API override.
 apiBase:'https://api.revenuetrigger.ai/api',
 markets:Object.freeze(['Phoenix','Tempe','Tucson','Scottsdale','Mesa','Chandler','Fort Worth'])
});
