/* Background work, on a schedule (November 7, 2026).

   Three jobs used to wait for someone with edit rights to open the portal:
     - turning a new application from a prospectus into a record (the inbox),
     - recording payments MISMO Money has found (Paid, and the Payment Made email),
     - putting prospects back on the list once their summits are over.
   This opens the real portal, signed in as the portal's own robot account, exactly the way a
   person would, lets it do those jobs with its own code, and closes it. Nothing is duplicated
   here, so the jobs can never drift from what the portal does when a person opens it.

   GitHub runs it every hour from the site repo (GitMISMO.github.io,
   .github/workflows/sponsorship-background.yml), with the same data key the Summit Sponsor
   Feed uses (the SPONSOR_DATA_TOKEN secret there). With that key the portal's saves go
   straight into the private sponsorship-data repo as commits, worded the way the relay words
   them ("Update APPLICATIONS dashboard data (saved by Sponsorship Robot)"), and the
   repo's webhook still wakes the Team Emails flow for any email they queue.

   Either of these turns it on:
       SPONSORSHIP_DATA_TOKEN       a GitHub key that can read and write GitMISMO/sponsorship-data
       SPONSORSHIP_ROBOT_EMAIL and SPONSORSHIP_ROBOT_PASSWORD
                                    a relay account with Staff access (signs in like a person)
   Without either it does nothing and says so.

   Try it on practice data:   node background.js --practice   (serves this folder locally) */
const { chromium } = require('playwright');
const fs = require('fs'), path = require('path'), http = require('http');

const RELAY = 'https://rgvdi67cg27o5kcmiytcqbqnrm0hmztx.lambda-url.us-east-1.on.aws';
const PORTAL_URL = process.env.SPONSORSHIP_PORTAL_URL || 'https://resources.mismo.org/sponsorship/';
const PRACTICE = process.argv.includes('--practice');
const summary = [];
function say(line) { console.log(line); summary.push(line); }
function finish(code) {
  if (process.env.GITHUB_STEP_SUMMARY) fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, '### Sponsorship background work\n\n' + summary.map(l => '- ' + l).join('\n') + '\n');
  process.exit(code);
}

/* ---- the data key: the relay's two calls, answered from GitHub ---- */
const DATA_REPO = 'GitMISMO/sponsorship-data', ROBOT = 'Sponsorship Robot';
const GH = (process.env.SPONSORSHIP_GH_API || 'https://api.github.com') + '/repos/' + DATA_REPO;
function gh(token, url, opts = {}) {
  return fetch(url, Object.assign({}, opts, { headers: Object.assign({
    'Authorization': 'Bearer ' + token, 'Accept': 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28', 'User-Agent': 'sponsorship-background' }, opts.headers || {}) }));
}
async function canWrite(token) {
  /* an unreferenced blob changes nothing and is cleaned up by GitHub; it needs write access */
  const r = await gh(token, GH + '/git/blobs', { method: 'POST', body: JSON.stringify({ content: 'write check', encoding: 'utf-8' }) });
  return r.status === 201 ? true : (r.status === 403 || r.status === 404 ? false : null);
}
async function relayGet(token, name) {
  const r = await gh(token, GH + '/contents/data/' + encodeURIComponent(name) + '.json?ref=main');
  if (r.status === 404) return { status: 404, body: { error: 'NOT_FOUND' } };
  if (!r.ok) return { status: r.status, body: { error: 'HTTP_' + r.status } };
  const f = await r.json();
  let text;
  if (f.encoding === 'base64' && f.content) text = Buffer.from(f.content, 'base64').toString('utf8');
  else {   // files over 1 MB come back without content
    const b = await gh(token, GH + '/git/blobs/' + f.sha);
    const bj = await b.json();
    text = Buffer.from(bj.content || '', 'base64').toString('utf8');
  }
  let data = null; try { data = JSON.parse(text); } catch (e) { data = null; }
  return { status: 200, body: { data, sha: f.sha } };
}
async function relayPut(token, name, body) {
  let b = {}; try { b = JSON.parse(body || '{}'); } catch (e) {}
  const r = await gh(token, GH + '/contents/data/' + encodeURIComponent(name) + '.json', { method: 'PUT', body: JSON.stringify({
    message: 'Update ' + name.toUpperCase() + ' dashboard data (saved by ' + ROBOT + ')',
    content: Buffer.from(JSON.stringify(b.content, null, 2) + '\n', 'utf8').toString('base64'),
    sha: b.sha || undefined, branch: 'main' }) });
  const j = await r.json().catch(() => ({}));
  if (r.ok) return { status: 200, body: { sha: j.content && j.content.sha } };
  if (r.status === 409 || r.status === 422) return { status: 409, body: { error: 'CONFLICT' } };   // someone saved in between
  return { status: r.status, body: { error: 'HTTP_' + r.status, message: j.message } };
}

async function signIn() {
  const email = process.env.SPONSORSHIP_ROBOT_EMAIL, password = process.env.SPONSORSHIP_ROBOT_PASSWORD;
  if (!email || !password) return null;
  const body = { email: email.trim().toLowerCase(), password };
  if (process.env.SPONSORSHIP_ROBOT_DEVICE) body.device = process.env.SPONSORSHIP_ROBOT_DEVICE;
  const r = await fetch(RELAY + '/hub/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const b = await r.json().catch(() => ({}));
  if (r.ok && b.token) return { token: b.token, name: b.name || 'Sponsorship Robot', email: b.email || body.email, access: b.access || {}, platformAdmin: false, passwords: true, expiresAt: b.expiresAt };
  if (b.codeRequired) throw new Error('the relay asked the robot account for an emailed sign-in code. Ask Perry to exempt it from two-step sign-in (or add a SPONSORSHIP_ROBOT_DEVICE secret).');
  throw new Error('the robot account could not sign in (' + r.status + (b.message ? ': ' + b.message : '') + ').');
}

(async () => {
  let session = null, url = PORTAL_URL, server = null, dataToken = null;
  if (PRACTICE) {
    const root = path.resolve(__dirname, '..'), pros = path.resolve(root, '..', 'Sponsorship-Prospectus');
    server = http.createServer((q, res) => {
      let p = decodeURIComponent(q.url.split('?')[0]); if (p.endsWith('/')) p += 'index.html';
      const f = p.startsWith('/sponsorship/') ? root + p.slice(12) : p.startsWith('/Sponsorship-Prospectus/') ? pros + p.slice(23) : null;
      if (!f || !fs.existsSync(f)) { res.writeHead(404); return res.end(); }
      res.writeHead(200, { 'Content-Type': (f.endsWith('.js') ? 'text/javascript' : f.endsWith('.json') ? 'application/json' : 'text/html') + '; charset=utf-8' });
      fs.createReadStream(f).pipe(res);
    }).listen(8799);
    url = 'http://localhost:8799/sponsorship/?practice';
    say('Practice run on test data.');
  } else {
    if (process.env.SPONSORSHIP_DATA_TOKEN) {
      const ok = await canWrite(process.env.SPONSORSHIP_DATA_TOKEN).catch(() => null);
      if (ok === false) {
        /* a warning, not a failure: until the key is given write access every hourly run would
           otherwise email a failure */
        console.log('::warning::The data key can read the sponsorship records but not save them.');
        say('Waiting to be switched on: the data key can read the sponsorship records but not save them. Give it Contents: Read and write on GitMISMO/sponsorship-data.');
        finish(0);
      }
      if (ok === null) { say('Could not run: GitHub did not answer the data key check. The next run will try again.'); finish(1); }
      dataToken = process.env.SPONSORSHIP_DATA_TOKEN;
    } else {
      try { session = await signIn(); } catch (e) { say('Could not run: ' + e.message); finish(1); }
      if (!session) { say('Not set up yet: no data key and no robot account, so nothing ran.'); finish(0); }
    }
  }

  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1400, height: 900 } });
  if (session) await ctx.addInitScript(s => { try { localStorage.setItem('resources:session', s); } catch (e) {} }, JSON.stringify(session));
  if (dataToken) {
    /* who the portal thinks is signed in; session.js keeps the first ResourcesSession it finds */
    await ctx.addInitScript(name => {
      const who = { name, email: 'robot@resources.mismo.org', token: 'data-key', role: 'staff' };
      window.ResourcesSession = { current: () => who, token: () => 'data-key', requireAccess: () => Promise.resolve('staff'),
        requireSignIn: () => Promise.resolve(who), signIn: () => Promise.resolve(who), signOut() {}, onChange() {},
        mount(el) { if (el) el.textContent = name; }, role: () => 'staff', canEdit: () => true, isAdmin: () => false, isPlatformAdmin: () => false };
    }, ROBOT);
    await ctx.route(/\.on\.aws\/sponsorship\/data\/[a-z0-9-]+$/, async route => {
      const req = route.request(), name = req.url().split('/').pop();
      const out = req.method() === 'GET' ? await relayGet(dataToken, name)
                : req.method() === 'PUT' ? await relayPut(dataToken, name, req.postData()) : { status: 405, body: { error: 'METHOD' } };
      if (req.method() === 'PUT' && out.status === 200) saves.push(name);
      await route.fulfill({ status: out.status, contentType: 'application/json', headers: { 'Access-Control-Allow-Origin': '*' }, body: JSON.stringify(out.body) });
    });
  }
  const page = await ctx.newPage();
  const errors = [], toasts = [], saves = [];
  page.on('pageerror', e => errors.push(String(e).split('\n')[0]));
  page.on('dialog', d => d.dismiss());          // never answer a question for a person
  await page.exposeFunction('__robotToast', t => toasts.push(t));
  await page.addInitScript(() => {
    let last = '';
    const mo = new MutationObserver(ms => {
      const t = document.getElementById('toast');
      if (!t || !ms.some(m => m.target === t || t.contains(m.target))) return;
      const txt = t.textContent.replace(/\s+/g, ' ').trim();
      if (txt && txt !== last) { last = txt; window.__robotToast(txt); }
    });
    const go = () => mo.observe(document.documentElement, { childList: true, subtree: true, characterData: true });
    if (document.documentElement) go(); else document.addEventListener('readystatechange', go, { once: true });
  });

  await page.goto(url, { waitUntil: 'load', timeout: 60000 });
  /* the portal reads its files, takes the inbox and records payments within a few seconds;
     give it time, then wait until its saves have settled */
  await page.waitForTimeout(15000);
  const state = await page.evaluate(() => ({
    gate: !!document.querySelector('.rs-scrim, [data-rs-gate].rs-locked'),
    conn: (() => { const b = document.getElementById('conn-banner'); return b && b.style.display !== 'none' ? b.textContent.trim() : ''; })(),
    money: (() => { const b = document.getElementById('money-banner'); return b && b.style.display !== 'none' ? b.innerText.trim() : ''; })(),
    stamp: (document.getElementById('money-stamp') || {}).textContent || '',
    list: ((document.getElementById('stock-body') || {}).textContent || '').match(/The Sponsorship Requests list[^.]*(\.|\))[^.]*\.?/) || ['']
  }));
  await page.waitForTimeout(10000);   // the saves the jobs started
  await browser.close();
  if (server) server.close();

  if (state.gate) { say('Could not run: the portal asked the robot account to sign in, so it has no access to the Sponsorship Portal.'); finish(1); }
  if (state.conn) { say('The portal showed a warning: ' + state.conn); }
  const fromInbox = toasts.filter(t => /online prospectus/i.test(t));
  say(fromInbox.length ? 'New applications: ' + fromInbox.join(' ') : 'No new applications from the prospectuses.');
  say(/recorded/i.test(state.money) ? state.money.replace(/\s*Got It$/, '').replace(/\n+/g, ' ') : 'No new payments from MISMO Money. ' + state.stamp.trim() + '.');
  if (state.list[0]) say(state.list[0].trim());
  if (errors.length) { say('Page errors: ' + errors.join(' | ')); finish(1); }
  finish(state.conn ? 1 : 0);
})().catch(e => { say('Could not run: ' + e.message); finish(1); });
