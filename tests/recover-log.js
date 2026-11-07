/* One-time recovery of the activity history (November 7, 2026).

   Before November 7 a log save could wipe out entries another screen had just saved, and the log
   only ever kept its latest 300. Every version of data/log.json is still in the sponsorship-data
   repo's history, though. This reads every version, collects every entry ever saved, and adds
   any missing ones to that month's history file (data/log-YYYY-MM.json), the same files the
   portal now keeps. It only ever adds; it never removes or changes an entry.

   Run from the site repo's "Sponsorship Background Work" workflow with "Recover the activity
   history" ticked. Needs SPONSORSHIP_DATA_TOKEN (read and write on GitMISMO/sponsorship-data).
   Safe to run again: entries already in a month's file are skipped. */
const cp = require('child_process'), fs = require('fs'), os = require('os'), path = require('path');

const token = process.env.SPONSORSHIP_DATA_TOKEN;
const GH = 'https://api.github.com/repos/GitMISMO/sponsorship-data';
const lines = [];
function say(l) { console.log(l); lines.push(l); }
function done(code) {
  if (process.env.GITHUB_STEP_SUMMARY) fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, '### Activity history recovery\n\n' + lines.map(l => '- ' + l).join('\n') + '\n');
  process.exit(code);
}
const gh = (url, opts = {}) => fetch(url, Object.assign({}, opts, { headers: Object.assign({
  'Authorization': 'Bearer ' + token, 'Accept': 'application/vnd.github+json', 'User-Agent': 'sponsorship-recover-log' }, opts.headers || {}) }));
const key = e => [e.at, e.appNo || '', e.what].join('|');

(async () => {
  if (!token) { say('No data key, nothing done.'); done(1); }
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sd-'));
  cp.execFileSync('git', ['clone', '--quiet', '--filter=blob:none', 'https://x-access-token:' + token + '@github.com/GitMISMO/sponsorship-data.git', dir], { stdio: 'pipe' });
  const shas = cp.execFileSync('git', ['-C', dir, 'log', '--format=%H', '--', 'data/log.json']).toString().trim().split('\n').filter(Boolean);
  say('Read ' + shas.length + ' saved versions of the activity log.');
  const all = {};
  for (const sha of shas) {
    let j;
    try { j = JSON.parse(cp.execFileSync('git', ['-C', dir, 'show', sha + ':data/log.json'], { maxBuffer: 64 << 20 }).toString()); } catch (e) { continue; }
    const list = (j && (j.entries || (j.content && j.content.entries))) || [];
    list.forEach(e => {
      if (!e || !e.at) return;
      const n = { at: e.at, appNo: e.appNo || '', what: e.what || e.text || '', who: e.who || e.by || '' };
      if (n.what) all[key(n)] = n;
    });
  }
  const byMonth = {};
  Object.values(all).forEach(e => { const m = 'log-' + String(e.at).slice(0, 7); (byMonth[m] = byMonth[m] || []).push(e); });
  say(Object.keys(all).length + ' different entries found, from ' + Object.keys(byMonth).sort().map(m => m.slice(4)).join(', ') + '.');

  for (const m of Object.keys(byMonth).sort()) {
    for (let tries = 0; tries < 4; tries++) {
      const r = await gh(GH + '/contents/data/' + m + '.json?ref=main');
      let have = { entries: [] }, sha;
      if (r.ok) { const f = await r.json(); sha = f.sha; try { have = JSON.parse(Buffer.from(f.content || '', 'base64').toString() || '{}'); } catch (e) {} }
      else if (r.status !== 404) { say(m + ': could not read it (' + r.status + ')'); break; }
      const ents = Array.isArray(have.entries) ? have.entries : [];
      const seen = {}; ents.forEach(e => { seen[key(e)] = 1; });
      const add = byMonth[m].filter(e => !seen[key(e)]);
      if (!add.length) { say(m.slice(4) + ': already complete (' + ents.length + ' entries).'); break; }
      const next = { entries: add.concat(ents).sort((x, y) => String(y.at).localeCompare(String(x.at))) };
      const put = await gh(GH + '/contents/data/' + m + '.json', { method: 'PUT', body: JSON.stringify({
        message: 'Update ' + m.toUpperCase() + ' dashboard data (saved by Sponsorship Robot: activity history recovered)',
        content: Buffer.from(JSON.stringify(next, null, 2) + '\n').toString('base64'), sha, branch: 'main' }) });
      if (put.ok) { say(m.slice(4) + ': ' + add.length + ' entries recovered (' + next.entries.length + ' in all).'); break; }
      if (put.status === 409 || put.status === 422) continue;   // the portal saved it in between: read again
      say(m.slice(4) + ': could not save (' + put.status + ')'); break;
    }
  }
  done(0);
})().catch(e => { say('Stopped: ' + e.message); done(1); });
