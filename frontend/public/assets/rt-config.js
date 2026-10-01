/* One market list. Add future markets only after Core integrates their adapters. */
window.RTConfig=Object.freeze({
 // Isolated combined-preview backend; do not inherit a stale production API override.
 apiBase:'https://integration-signal-command-fort-worth-v1-signalhound-api.rolandcoyburt.workers.dev/api',
 markets:Object.freeze(['Phoenix','Tempe','Tucson','Scottsdale','Mesa','Chandler','Fort Worth'])
});
