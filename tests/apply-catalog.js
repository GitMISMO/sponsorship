/* Carry the price list onto every page:  node apply-catalog.js [path/to/Sponsorship-Prospectus]
   Edit Sponsorship-Prospectus/catalog.json first; this rewrites the prices, slot counts, days and
   registration counts written into the three prospectuses and the portal to match it, then
   lists anything it could not fix. Run checks.js afterwards, then publish the changed files. */
const path = require('path');
const L = require('./catalog-lib');
const PORTAL = path.resolve(__dirname, '..', 'index.html');
const PROS = path.resolve(process.argv[2] || path.join(__dirname, '..', '..', 'Sponsorship-Prospectus'));
const cat = L.loadCatalog(PROS);
const pages = L.applyPages(PROS, cat);
const portal = L.applyPortal(PORTAL, cat);
console.log('Changed: ' + (pages.concat(portal ? ['sponsorship/index.html'] : []).join(', ') || 'nothing, everything already matches'));
const left = L.comparePages(PROS, cat).concat(L.comparePortal(PORTAL, cat));
if (left.length) { console.log('Still different (fix these by hand):\n  ' + left.join('\n  ')); process.exit(1); }
