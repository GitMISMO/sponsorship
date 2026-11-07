/* The price list (Sponsorship-Prospectus/catalog.json) and every place it is written into a page.
   compare() lists, in plain words, every price, slot count, day or registration count on a page
   that disagrees with the catalog; apply() rewrites the pages to match it.
   Used by checks.js (compare) and apply-catalog.js (apply). */
const fs = require('fs'), path = require('path'), vm = require('vm');

const TIER_KEYS = ['diamond', 'platinum', 'gold', 'silver', 'bronze'];
const PAGES = [   // file, which TIERS programs it holds, and its single-summit page id
  { file: 'index.html', single: 'winter' },
  { file: 'spring-2027/index.html', single: 'spring' },
  { file: 'fall-2027/index.html', single: 'fall' }
];
const money = n => '$' + Number(n).toLocaleString('en-US');
const lowest = cat => Math.min(...cat.tiers.map(t => t.single));
const highest = cat => Math.max(...cat.tiers.map(t => t.single));
const FROM_RE = /(<span class="cp-k">From<\/span><span class="cp-v">)(\$[\d,]+)(<\/span>)/g;   // the cover's "From $5,000"
const RANGE_RE = /(Summit tiers, )(\$[\d,]+ to \$[\d,]+)()/g;                                  // the portal's Prospectuses tab

/* the text of the object literal that follows `marker` (brace matching, strings respected) */
function block(src, marker) {
  const at = src.indexOf(marker);
  if (at < 0) return null;
  const start = src.indexOf('{', at);
  let depth = 0, q = null;
  for (let i = start; i < src.length; i++) {
    const c = src[i];
    if (q) { if (c === '\\') i++; else if (c === q) q = null; continue; }
    if (c === '"' || c === "'") q = c;
    else if (c === '{') depth++;
    else if (c === '}' && --depth === 0) return { start, end: i + 1, text: src.slice(start, i + 1) };
  }
  return null;
}
const evalObj = text => vm.runInNewContext('(' + text + ')');

function loadCatalog(prosDir) { return JSON.parse(fs.readFileSync(path.join(prosDir, 'catalog.json'), 'utf8')); }
const tierOf = (cat, key) => cat.tiers.find(t => t.key === key);
const itemOf = (tier, name) => tier.items.find(i => i.opp === name || (i.alt || []).indexOf(name) >= 0);
const sameDays = (a, b) => JSON.stringify(a || null) === JSON.stringify(b || null);

/* static tier cards: [{page id, tier key, price text, at}] */
function cards(src) {
  const out = [], re = /<div class="page" id="([a-z0-9-]+)"|<div class="t-name">(\w+) Sponsor<\/div>\s*<div class="t-price">([^<]*)<\/div>/g;
  let m, page = '';
  while ((m = re.exec(src))) {
    if (m[1]) { page = m[1]; continue; }
    out.push({ page, key: m[2].toLowerCase(), price: m[3], at: m.index, len: m[0].length, whole: m[0] });
  }
  /* each card runs to the next card or the next page; its registration count lives in there */
  out.forEach((c, i) => {
    const next = out[i + 1] ? out[i + 1].at : src.length;
    const pageEnd = src.indexOf('<div class="page" id=', c.at);
    c.end = Math.min(next, pageEnd < 0 ? src.length : pageEnd);
    c.comps = [...src.slice(c.at, c.end).matchAll(/(\d+) complimentary/g)].map(x => +x[1]);
  });
  return out;
}

function comparePages(prosDir, cat) {
  const diffs = [];
  for (const pg of PAGES) {
    const f = path.join(prosDir, pg.file);
    if (!fs.existsSync(f)) continue;
    const src = fs.readFileSync(f, 'utf8');
    const b = block(src, 'var TIERS = {');
    if (!b) { diffs.push(pg.file + ': the tier list (var TIERS) was not found'); continue; }
    const T = evalObj(b.text);
    for (const prog of Object.keys(T)) {
      const series = prog === 'series';
      for (const key of TIER_KEYS) {
        const t = T[prog][key], ct = tierOf(cat, key);
        if (!t) continue;
        const want = money(series ? ct.series : ct.single);
        if (t.price !== want) diffs.push(`${pg.file}: ${prog} ${key} price is ${t.price}, the catalog says ${want}`);
        const regs = (/(\d+) complimentary/.exec(t.regs || '') || [])[1];
        if (regs && +regs !== ct.comps) diffs.push(`${pg.file}: ${prog} ${key} gives ${regs} registrations, the catalog says ${ct.comps}`);
        for (const o of t.opportunities || []) {
          const it = itemOf(ct, o.name);
          if (!it) { diffs.push(`${pg.file}: ${prog} ${key} sells "${o.name}", which is not in the catalog`); continue; }
          if ((o.cap === undefined ? null : o.cap) !== it.cap) diffs.push(`${pg.file}: ${prog} "${o.name}" has ${o.cap} slots, the catalog says ${it.cap}`);
          if (!sameDays(o.days, it.days)) diffs.push(`${pg.file}: ${prog} "${o.name}" days are ${JSON.stringify(o.days || null)}, the catalog says ${JSON.stringify(it.days || null)}`);
        }
        for (const it of ct.items) {
          if (t.opportunities && !t.opportunities.some(o => o.name === it.opp || (it.alt || []).indexOf(o.name) >= 0))
            diffs.push(`${pg.file}: ${prog} ${key} is missing "${it.opp}", which the catalog sells`);
        }
      }
    }
    for (const m of src.matchAll(FROM_RE)) if (m[2] !== money(lowest(cat)))
      diffs.push(`${pg.file}: the cover says "From ${m[2]}", the lowest price in the catalog is ${money(lowest(cat))}`);
    for (const c of cards(src)) {
      const ct = tierOf(cat, c.key); if (!ct) continue;
      const want = money(c.page === 'series' ? ct.series : ct.single);
      if (c.price !== want) diffs.push(`${pg.file}: the ${c.key} card on the ${c.page} page shows ${c.price}, the catalog says ${want}`);
      if (c.comps.some(n => n !== ct.comps)) diffs.push(`${pg.file}: the ${c.key} card on the ${c.page} page gives ${c.comps.join('/')} registrations, the catalog says ${ct.comps}`);
    }
  }
  return diffs;
}

function comparePortal(portalFile, cat) {
  const src = fs.readFileSync(portalFile, 'utf8');
  const b = block(src, 'var CATALOG = {');
  if (!b) return ['the portal\'s built-in price list (var CATALOG) was not found'];
  const C = evalObj(b.text)[cat.year];
  if (!C) return ['the portal has no built-in price list for ' + cat.year];
  const diffs = [];
  const range = money(lowest(cat)) + ' to ' + money(highest(cat));
  for (const m of src.matchAll(RANGE_RE)) if (m[2] !== range)
    diffs.push(`the portal's Prospectuses tab says "${m[2]}", the catalog runs ${range}`);
  for (const ct of cat.tiers) {
    const t = C.tiers.find(x => x.name === ct.name);
    if (!t) { diffs.push('the portal has no ' + ct.name + ' tier'); continue; }
    for (const k of ['single', 'series', 'comps']) if (t[k] !== ct[k]) diffs.push(`the portal's ${ct.name} ${k} is ${t[k]}, the catalog says ${ct[k]}`);
    for (const it of ct.items) {
      const p = t.items.find(x => x.opp === it.opp);
      if (!p) { diffs.push(`the portal's ${ct.name} tier is missing "${it.opp}"`); continue; }
      if ((p.cap === undefined ? null : p.cap) !== it.cap) diffs.push(`the portal's "${it.opp}" has ${p.cap} slots, the catalog says ${it.cap}`);
      if (!sameDays(p.days, it.days)) diffs.push(`the portal's "${it.opp}" days differ from the catalog`);
    }
  }
  return diffs;
}

/* ---------- rewriting the pages to match ---------- */
function setIn(text, re, value) { return text.replace(re, (m, a, _v, c) => a + value + c); }

function applyPages(prosDir, cat) {
  const changed = [];
  for (const pg of PAGES) {
    const f = path.join(prosDir, pg.file);
    if (!fs.existsSync(f)) continue;
    let src = fs.readFileSync(f, 'utf8');
    const before = src;
    const b = block(src, 'var TIERS = {');
    let tiers = b.text;
    const progs = Object.keys(evalObj(tiers));
    for (const prog of progs) {
      const pb = block(tiers, '\n    ' + prog + ': {'); if (!pb) continue;
      let ptext = pb.text;
      for (const key of TIER_KEYS) {
        const tb = block(ptext, '\n      ' + key + ': {'); if (!tb) continue;
        const ct = tierOf(cat, key);
        let t = tb.text;
        t = setIn(t, /(price:")([^"]*)(")/, money(prog === 'series' ? ct.series : ct.single));
        t = t.replace(/(\d+)( complimentary)/g, ct.comps + '$2');
        for (const it of ct.items) {
          for (const name of [it.opp].concat(it.alt || [])) {
            const re = new RegExp('(\\{[^{}]*name:"' + name.replace(/[.*+?^${}()|[\]\\\/]/g, '\\$&') + '"[^{}]*\\})', 'g');
            t = t.replace(re, o => {
              o = o.replace(/cap:(null|\d+)/, 'cap:' + (it.cap === null ? 'null' : it.cap));
              if (it.days && /days:\[/.test(o)) o = o.replace(/days:\[[^\]]*\]/, 'days:' + JSON.stringify(it.days));
              return o;
            });
          }
        }
        ptext = ptext.slice(0, tb.start) + t + ptext.slice(tb.end);
      }
      tiers = tiers.slice(0, pb.start) + ptext + tiers.slice(pb.end);
    }
    src = src.slice(0, b.start) + tiers + src.slice(b.end);
    /* the tier cards */
    const cs = cards(src).reverse();
    for (const c of cs) {
      const ct = tierOf(cat, c.key); if (!ct) continue;
      const want = money(c.page === 'series' ? ct.series : ct.single);
      const region = src.slice(c.at, c.end).replace(c.whole, c.whole.replace('>' + c.price + '<', '>' + want + '<'))
        .replace(/(\d+)( complimentary)/g, ct.comps + '$2');
      src = src.slice(0, c.at) + region + src.slice(c.end);
    }
    src = src.replace(FROM_RE, (m, a, v, c) => a + money(lowest(cat)) + c);
    if (src !== before) { fs.writeFileSync(f, src); changed.push(pg.file); }
  }
  return changed;
}

function applyPortal(portalFile, cat) {
  if (!comparePortal(portalFile, cat).length) return false;
  let src = fs.readFileSync(portalFile, 'utf8');
  src = src.replace(RANGE_RE, (m, a) => a + money(lowest(cat)) + ' to ' + money(highest(cat)));
  const b = block(src, 'var CATALOG = {');
  const yb = block(b.text, cat.year + ': {');
  const C = evalObj(yb.text);
  const fmtItem = it => '          {' + ['opp:' + JSON.stringify(it.opp), 'cap:' + (it.cap === null ? 'null' : it.cap)]
    .concat(it.exclusive ? ['exclusive:true'] : [])
    .concat(it.days ? ['days:' + JSON.stringify(it.days).replace(/,/g, ',')] : [])
    .concat(it.alt && it.opp !== 'Exclusive' ? ['alt:' + JSON.stringify(it.alt).replace(/,/g, ',')] : [])
    .join(', ') + '}';
  const tiersText = 'tiers:[\n' + cat.tiers.map(t => '        {name:' + JSON.stringify(t.name) + ', single:' + t.single + ', series:' + t.series +
    ', comps:' + t.comps + ', items:[\n' + t.items.map(fmtItem).join(',\n') + '\n        ]}').join(',\n') + '\n      ]';
  const ts = yb.text.indexOf('tiers:[');
  const te = yb.text.lastIndexOf(']');
  const newYear = yb.text.slice(0, ts) + tiersText + yb.text.slice(te + 1);
  const newCat = b.text.slice(0, yb.start) + newYear + b.text.slice(yb.end);
  const b2 = block(src, 'var CATALOG = {');
  src = src.slice(0, b2.start) + newCat + src.slice(b2.end);
  fs.writeFileSync(portalFile, src);
  return true;
}

module.exports = { loadCatalog, comparePages, comparePortal, applyPages, applyPortal, block, evalObj, PAGES };
