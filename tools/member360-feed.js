/* The Sponsorship list for Member 360 (CN-016, approved by Jonna Nov 24, 2026).

   Member 360 shows each company's sponsorship activity in a Sponsorship section on its record. It reads
   this list through the save relay with its own signed-in users (/sponsorship/data/feed-member360), matches
   by Aptify Company ID (the company name when there is none), and never writes to the portal.

   Written to sponsorship-data data/feed-member360.json by the GitHub workflow "Member 360 Feed" in
   sponsorship-data (.github/workflows/member360-feed.yml): on every change to the records, and every
   morning. Run by hand:
       node tools/member360-feed.js <sponsorship-data folder>            prints the list
       node tools/member360-feed.js <sponsorship-data folder> --write    writes data/feed-member360.json
   (--write only rewrites the file when a company changed or the last copy is over 20 hours old.)

   Shape (add fields, never rename or remove; Member 360 reads them by name):
     {updated, count, companies:[{cid, name, prospect:{stage, owner, lastTouch, nextStep, ...},
       sponsorships:[{event, package, amount, status, invoiceSent, paid, ...}], lastEvent:{date, what}, key, aka}]}
     cid is the Aptify Company ID, or "" when no record gives one. prospect is always there; stage is ""
     (and open false) when the company has no open prospect. Dates are YYYY-MM-DD, or "" when not known.
     key is the portal's company key; aka lists the other names on its records (billing names too).

   The rules are the portal's own (index.html): one company per companyKey, prospects open unless
   LEAD_CLOSED, LEAD_LEGACY stage names, the owner, the last touch. tests/feed-check.js checks that the
   constants copied below still match index.html, so the two can't quietly drift apart. */
'use strict';
const fs = require('fs'), path = require('path');

/* ---- copied from index.html (tests/feed-check.js compares them) ---- */
const CO_NOISE = {inc:1, llc:1, ltd:1, corp:1, corporation:1, co:1, company:1, the:1, ai:1, io:1, com:1,
                  group:1, technologies:1, technology:1};
const LEAD_LEGACY = {"New Lead":"Lead", "Pitching to Management":"Proposal", "Follow Up":"Contacted",
    "Not Now — Follow Up":"Hold", "Not Now — Follow Up":"Hold", "Invoiced":"Verbal Commitment", "Paid":"Verbal Commitment"};
const LEAD_CLOSED = {"Lost":1, "Converted to Application":1, "Converted to Sponsorship":1};
const PIPE_STAGES = ["Lead","Contacted","Meeting Scheduled","Proposal","Verbal Commitment",
    "Application In","Approved","Pending Payment","Paid","Hold","Lost"];
const OTHER_TYPES_BASE = [
    {key:"ai-webinar", name:"AI Webinar Series", detail:"Webinar", share:0.5, partner:"MBA"}
  ];
/* ---- end of the copied part ---- */

function companyKey(s) {
  return String(s || "").toLowerCase().replace(/&/g, " and ").split(/[^a-z0-9]+/)
    .filter(w => w && !CO_NOISE[w]).join("");
}
function leadStage(l) { const st = l.status || "Lead"; return PIPE_STAGES.indexOf(st) >= 0 ? st : (LEAD_LEGACY[st] || "Lead"); }
const day = s => { const m = /^(\d{4}-\d{2}-\d{2})/.exec(String(s || "")); return m ? m[1] : ""; };
const clip = (s, n) => { s = String(s || "").replace(/\s+/g, " ").trim(); return s.length > n ? s.slice(0, n - 1).trimEnd() + "…" : s; };
const tier = k => String(k || "").charAt(0).toUpperCase() + String(k || "").slice(1).toLowerCase();
const num = v => { const n = Number(v); return isFinite(n) && v !== "" && v != null ? n : null; };

function readFile(dir, name) {
  const f = path.join(dir, 'data', name + '.json');
  if (!fs.existsSync(f)) return null;
  try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch (e) { throw new Error(name + '.json could not be read: ' + e.message); }
}
function docsOf(file) {
  const d = file && file.docs && typeof file.docs === 'object' ? file.docs : {};
  return Object.keys(d).map(id => Object.assign({id}, d[id]));
}

/* files: {applications, leads, workgroups, others, touchpoints, companies, settings, 'mismo-money-paid'} as stored */
function build(files, now) {
  const today = day((now || new Date()).toISOString());
  const apps = docsOf(files.applications), leads = docsOf(files.leads);
  const wgs = docsOf(files.workgroups).map(r => Object.assign(r, {__kind: "workgroup"}));
  const others = docsOf(files.others).map(r => Object.assign(r, {__kind: "other"}));
  const touches = docsOf(files.touchpoints).filter(t => !t.archived && t.co);
  const coDocs = (files.companies && files.companies.docs) || {};
  const setMain = (files.settings && files.settings.docs && files.settings.docs.main) || {};
  const types = OTHER_TYPES_BASE.concat(Array.isArray(setMain.otherTypes) ? setMain.otherTypes : []);
  const typeName = k => (types.find(t => t && t.key === k) || {}).name || (k ? String(k) : "Other Sponsorship");
  const orders = (files['mismo-money-paid'] && files['mismo-money-paid'].orders) || {};

  const map = {};
  const co = name => {
    const k = companyKey(name); if (!k) return null;
    return map[k] || (map[k] = {key: k, name: String(name || "").trim(), when: "", leads: [], apps: [], bills: [], touches: []});
  };
  const seen = (c, name, when) => { if (when && when >= c.when) { c.when = when; c.name = String(name).trim(); } };
  leads.forEach(l => { const c = co(l.company); if (!c) return; c.leads.push(l); seen(c, l.company, day(l.updatedAt || l.createdDate)); });
  wgs.concat(others).forEach(r => { const c = co(r.company); if (!c) return; c.bills.push(r); seen(c, r.company, day(r.invoiceDate || r.periodStart || r.paymentReceivedDate || r.updatedAt)); });
  /* the name on the newest application wins: it is what the company signed */
  apps.forEach(a => { const c = co(a.company); if (!c) return; c.apps.push(a); seen(c, a.company, "9" + String(a.dateSubmitted || "")); });
  touches.forEach(t => { const c = map[t.co] || (map[t.co] = {key: t.co, name: t.coName || t.co, when: "", leads: [], apps: [], bills: [], touches: []}); c.touches.push(t); });

  const list = Object.keys(map).map(k => {
    const c = map[k];
    /* Aptify Company ID: the workgroup and other records carry it; any record's Aptify order (its invoice
       number) gives it through MISMO Money's paid orders. The one seen most wins (newest on a tie). */
    const ids = {};
    const vote = (id, when) => { id = String(id || "").trim(); if (!/^\d+$/.test(id)) return; const v = ids[id] || (ids[id] = {n: 0, when: ""}); v.n++; if (when > v.when) v.when = when; };
    c.bills.forEach(r => vote(r.aptifyCustomerId, day(r.invoiceDate || r.periodStart)));
    c.apps.concat(c.bills).forEach(r => { const o = r.invoiceNumber && orders[String(r.invoiceNumber).trim()]; if (o) vote(o.companyId, day(o.lastPaidOn || r.invoiceDate)); });
    const cid = Object.keys(ids).sort((a, b) => ids[b].n - ids[a].n || ids[b].when.localeCompare(ids[a].when))[0] || "";

    /* owner: the company's own, else whoever owns its newest prospect */
    let owner = (coDocs[k] || {}).owner || "";
    if (!owner) { const ol = c.leads.filter(l => l.owner).sort((x, y) => String(y.updatedAt || "").localeCompare(String(x.updatedAt || "")))[0]; owner = ol ? ol.owner : ""; }
    /* last touch: newest email or note, or prospect contact date */
    let last = "";
    c.touches.forEach(t => { if (day(t.date) > last) last = day(t.date); });
    c.leads.forEach(l => { if (day(l.lastContactDate) > last) last = day(l.lastContactDate); });

    const open = c.leads.filter(l => !LEAD_CLOSED[l.status])
      .sort((x, y) => String(y.updatedAt || y.createdDate || "").localeCompare(String(x.updatedAt || x.createdDate || "")));
    const lp = open[0] || null;
    const openTouch = c.touches.filter(t => t.next && t.next.text && !t.next.done && !t.next.onLead)
      .sort((x, y) => String(x.next.due || "9").localeCompare(String(y.next.due || "9")))[0];
    const prospect = {
      stage: lp ? leadStage(lp) : "",
      owner,
      lastTouch: last,
      nextStep: lp && lp.nextStep ? String(lp.nextStep) : openTouch ? String(openTouch.next.text) : "",
      /* added beyond the asked-for shape */
      open: !!lp,
      nextDate: lp ? day(lp.nextFollowUpDate) : openTouch ? day(openTouch.next.due) : "",
      kind: lp ? (lp.stype === "workgroup" ? "Workgroup" : lp.stype && lp.stype !== "summit" ? typeName(lp.stype) : "Summit") : "",
      season: lp ? String(lp.summit || lp.season || "") : "",
      interestedIn: lp ? String(lp.interestedIn || "") : "",
      leadNo: lp ? String(lp.leadNo || "") : "",
      createdDate: lp ? day(lp.createdDate) : ""
    };

    const events = [];
    const ev = (date, what) => { date = day(date); if (date && date <= today && what) events.push({date, what: clip(what, 160)}); };

    const sponsorships = [];
    c.apps.slice().sort((x, y) => String(y.dateSubmitted || "").localeCompare(String(x.dateSubmitted || ""))).forEach(a => {
      const lv = a.level2027 || a.level2026 || "";
      let opp = String(a.opportunity || "").trim();
      if (a.day && opp && opp.indexOf(a.day) < 0) opp += " — " + a.day;
      const pkg = [tier(lv), opp].filter(Boolean).join(" ");
      sponsorships.push({event: String(a.event || ""), package: pkg, amount: num(a.amountDue), status: String(a.status || ""),
        invoiceSent: day(a.invoiceDate), paid: day(a.paymentReceivedDate),
        kind: "Summit", no: String(a.appNo || ""), invoiceNumber: String(a.invoiceNumber || ""), amountPaid: num(a.amountPaid),
        applied: day(a.dateSubmitted), approved: day(a.approvedDate)});
      const what = (a.event || "Summit") + (pkg ? " " + pkg : "");
      ev(a.dateSubmitted, "Applied: " + what);
      ev(a.approvedDate, "Approved: " + what);
      ev(a.invoiceDate, "Invoiced: " + what);
      ev(a.paymentReceivedDate, "Paid: " + what);
    });
    c.bills.slice().sort((x, y) => String(y.invoiceDate || y.periodStart || "").localeCompare(String(x.invoiceDate || x.periodStart || ""))).forEach(r => {
      const wg = r.__kind === "workgroup";
      const event = wg ? String(r.workgroup || "Workgroup") : typeName(r.otype);
      const pkg = wg ? ["Workgroup Sponsorship", r.term, r.cadence].filter(Boolean).join(", ") +
          (r.periodStart || r.periodEnd ? " (" + [day(r.periodStart), day(r.periodEnd)].filter(Boolean).join(" to ") + ")" : "")
        : String(r.what || r.webinar || "");
      sponsorships.push({event, package: pkg, amount: num(r.amountDue), status: String(r.status || ""),
        invoiceSent: day(r.invoiceDate), paid: day(r.paymentReceivedDate),
        kind: wg ? "Workgroup" : typeName(r.otype), no: String(r.no || ""), invoiceNumber: String(r.invoiceNumber || ""),
        amountPaid: num(r.amountPaid), archived: !!r.archived});
      const what = event + (pkg ? ": " + pkg : "");
      ev(r.invoiceDate, "Invoiced: " + what);
      ev(r.paymentReceivedDate, "Paid: " + what);
    });
    c.leads.forEach(l => {
      ev(l.createdDate, "Added as a prospect" + (l.leadNo ? " (" + l.leadNo + ")" : ""));
      ev(l.lastContactDate, "Contacted (prospect " + (l.leadNo || "") + ", " + leadStage(l) + ")");
      (Array.isArray(l.history) ? l.history : []).forEach(h => { if (h) ev(h.at, h.text); });
    });
    c.touches.forEach(t => ev(t.date, (t.type || "Note") + ": " + (t.subject || t.summary || "")));
    events.sort((x, y) => y.date.localeCompare(x.date));
    const lastEvent = events[0] || {date: "", what: ""};

    /* every other spelling of the name on its records, billing names included, to help a name match */
    const aka = {};
    c.leads.concat(c.apps, c.bills).forEach(r => [r.company, r.billingName, r.sponsorName].forEach(n => { n = String(n || "").trim(); if (n && n !== c.name) aka[n] = 1; }));
    c.touches.forEach(t => { const n = String(t.coName || "").trim(); if (n && n !== c.name) aka[n] = 1; });

    return {cid, name: c.name, prospect, sponsorships, lastEvent, key: k, aka: Object.keys(aka).sort()};
  }).sort((x, y) => x.name.localeCompare(y.name, 'en', {sensitivity: 'base'}));

  return {updated: (now || new Date()).toISOString(), count: list.length, source: "Sponsorship Portal (GitMISMO/sponsorship tools/member360-feed.js)", companies: list};
}

function buildFromFolder(dir, now) {
  const files = {};
  ['applications', 'leads', 'workgroups', 'others', 'touchpoints', 'companies', 'settings', 'mismo-money-paid']
    .forEach(n => { files[n] = readFile(dir, n); });
  if (!files.applications || !files.leads) throw new Error('applications.json and leads.json are needed in ' + path.join(dir, 'data'));
  return build(files, now);
}

/* writes only when a company changed or the last copy is over 20 hours old; returns what it did */
function writeFeed(dir, now) {
  const feed = buildFromFolder(dir, now);
  const out = path.join(dir, 'data', 'feed-member360.json');
  let old = null; try { old = JSON.parse(fs.readFileSync(out, 'utf8')); } catch (e) {}
  const same = old && JSON.stringify(old.companies) === JSON.stringify(feed.companies);
  const age = old ? (Date.parse(feed.updated) - Date.parse(old.updated || 0)) / 36e5 : Infinity;
  if (same && age < 20) return {wrote: false, count: feed.count, why: 'no change (last written ' + Math.round(age * 10) / 10 + ' hours ago)'};
  if (JSON.stringify(feed).length > 900000) throw new Error('the list is over 900 KB, too close to the relay limit of 1 MB');
  fs.writeFileSync(out, JSON.stringify(feed, null, 1) + '\n');
  return {wrote: true, count: feed.count, why: same ? 'daily refresh' : 'companies changed'};
}

module.exports = {build, buildFromFolder, writeFeed, companyKey, CONSTANTS: {CO_NOISE, LEAD_LEGACY, LEAD_CLOSED, PIPE_STAGES, OTHER_TYPES_BASE}};

if (require.main === module) {
  const dir = process.argv[2];
  if (!dir) { console.error('usage: node tools/member360-feed.js <sponsorship-data folder> [--write]'); process.exit(2); }
  if (process.argv.includes('--write')) {
    const r = writeFeed(dir);
    console.log((r.wrote ? 'Wrote' : 'Left') + ' data/feed-member360.json: ' + r.count + ' companies, ' + r.why);
  } else console.log(JSON.stringify(buildFromFolder(dir), null, 1));
}
