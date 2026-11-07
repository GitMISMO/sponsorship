/* Daily health check of everything the Sponsorship Portal depends on (November 7, 2026).

   Runs with the hourly background work (GitMISMO.github.io, sponsorship-background.yml), but
   only checks once a day, on the first run after 8 am Eastern, or whenever the workflow is
   started by hand. A problem fails the run, and GitHub emails Jonna. Each run's summary lists
   every check.

   What it checks:
     - Availability flow: answers with the list of taken slots, as the prospectuses ask it.
     - Intake flow: still at the address the prospectuses post to, and switched on.
     - Team Emails flow: every email the portal queued more than 30 minutes ago has been sent.
     - MISMO Money: its payments file has been updated in the last four days (weekends included).
     - The public pages and the price list load.
   The flow addresses are read from the live prospectus, so this follows any change to them.
   Reading the portal's records needs SPONSORSHIP_DATA_TOKEN (read access is enough). */
const fs = require('fs');

const SITE = 'https://resources.mismo.org';
const GH = 'https://api.github.com/repos/GitMISMO/sponsorship-data';
const token = process.env.SPONSORSHIP_DATA_TOKEN;
const force = !!process.env.HEALTH_NOW;

const results = [];
function ok(name, detail) { results.push({ ok: true, name, detail }); console.log('  OK   ' + name + (detail ? ' (' + detail + ')' : '')); }
function bad(name, detail) { results.push({ ok: false, name, detail }); console.log('  FAIL ' + name + ': ' + detail); }
function warn(name, detail) { results.push({ ok: true, warn: true, name, detail }); console.log('  WARN ' + name + ': ' + detail); }
async function check(name, fn) { try { const d = await fn(); if (d !== undefined) ok(name, d); } catch (e) { bad(name, e.message || String(e)); } }
function finish() {
  const failed = results.filter(r => !r.ok);
  if (process.env.GITHUB_STEP_SUMMARY) fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY,
    '### Sponsorship health check\n\n' + results.map(r => (r.ok ? (r.warn ? '- ⚠️ ' : '- ✅ ') : '- ❌ ') + r.name + (r.detail ? ': ' + r.detail : '')).join('\n') + '\n');
  if (failed.length) console.log('::error::' + failed.map(r => r.name + ': ' + r.detail).join(' | '));
  process.exit(failed.length ? 1 : 0);
}
async function timed(url, opts = {}, ms = 30000) {
  const c = new AbortController(); const t = setTimeout(() => c.abort(), ms);
  try { return await fetch(url, Object.assign({ signal: c.signal }, opts)); } finally { clearTimeout(t); }
}
async function dataFile(name) {
  const r = await timed(GH + '/contents/data/' + name + '.json?ref=main', { headers: {
    'Authorization': 'Bearer ' + token, 'Accept': 'application/vnd.github.raw+json', 'User-Agent': 'sponsorship-health' } });
  if (!r.ok) throw new Error('could not read data/' + name + '.json (' + r.status + ')');
  return JSON.parse(await r.text());
}

(async () => {
  const eastern = Number(new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', hour: 'numeric', hourCycle: 'h23' }).format(new Date()));
  if (!force && eastern !== 8) { console.log('Health check runs once a day, on the 8 am Eastern run.'); process.exit(0); }

  let page = '';
  await check('The 2027 prospectus loads', async () => {
    const r = await timed(SITE + '/Sponsorship-Prospectus/');
    if (!r.ok) throw new Error('status ' + r.status);
    page = await r.text();
    return 'status 200';
  });
  for (const [name, url] of [['The Spring prospectus loads', '/Sponsorship-Prospectus/spring-2027/'], ['The Fall prospectus loads', '/Sponsorship-Prospectus/fall-2027/'],
                             ['The Spring & Fall prospectus loads', '/Sponsorship-Prospectus/spring-fall-2027/'], ['The price list loads', '/Sponsorship-Prospectus/catalog.json']]) {
    await check(name, async () => { const r = await timed(SITE + url); if (!r.ok) throw new Error('status ' + r.status); return 'status 200'; });
  }

  const avail = (/AVAIL_ENDPOINT = "([^"]+)"/.exec(page) || [])[1];
  const intake = (/SUBMIT_ENDPOINT = "([^"]+)"/.exec(page) || [])[1];
  await check('Availability flow answers', async () => {
    if (!avail) throw new Error('the prospectus has no Availability flow address');
    const r = await timed(avail, { method: 'POST', headers: { 'Content-Type': 'text/plain' }, body: '{}' }, 60000);
    if (!r.ok) throw new Error('status ' + r.status + ': ' + (await r.text()).slice(0, 200));
    const j = await r.json();
    const rows = Array.isArray(j) ? j : (j && j.value);
    if (!Array.isArray(rows)) throw new Error('it answered, but not with a list of sold slots');
    if (rows.length && !rows.some(x => x && Object.prototype.hasOwnProperty.call(x, 'program')))
      throw new Error('its rows have no Program, so Spring and Fall can\'t tell their sales apart');
    return rows.length + ' sold slots';
  });
  await check('Intake flow is switched on', async () => {
    if (!intake) throw new Error('the prospectus has no Intake flow address');
    /* asking with GET makes no application: a working flow refuses it as the wrong method */
    const r = await timed(intake, { method: 'GET' });
    const t = await r.text();
    if (/TriggerRequestMethodNotValid/.test(t)) return 'it answers at its address';
    throw new Error('status ' + r.status + ': ' + t.slice(0, 200));
  });

  if (!token) { warn('Team Emails and MISMO Money', 'not checked: no data key'); return finish(); }
  await check('Team Emails flow has sent every queued email', async () => {
    const outbox = await dataFile('outbox'), sent = await dataFile('outbox-sent');
    const done = {}; (sent.list || []).forEach(x => { if (x && x.id) done[x.id] = 1; });
    const cutoff = Date.now() - 30 * 60000;
    const stuck = Object.keys(outbox.docs || {}).map(id => Object.assign({ id }, outbox.docs[id]))
      .filter(o => o.status === 'queued' && !done[o.id] && Date.parse(o.queuedAt || 0) < cutoff);
    if (stuck.length) throw new Error(stuck.length + ' waiting more than 30 minutes, oldest ' +
      stuck.map(o => o.queuedAt).sort()[0].slice(0, 16).replace('T', ' ') + ' UTC (' +
      stuck.slice(0, 5).map(o => (o.kind || 'email') + ' for ' + (o.company || o.appNo)).join('; ') + ')');
    return 'nothing waiting';
  });
  await check('MISMO Money payments are up to date', async () => {
    const m = await dataFile('mismo-money-paid');
    const w = Date.parse(m.writtenAt || m.savedAt || 0);
    if (!w) throw new Error('the payments file has no date');
    const days = (Date.now() - w) / 864e5;
    if (days > 4) throw new Error('last updated ' + Math.floor(days) + ' days ago; MISMO Money normally updates it every weekday');
    return 'updated ' + new Date(w).toISOString().slice(0, 10);
  });
  finish();
})().catch(e => { bad('Health check', e.message); finish(); });
