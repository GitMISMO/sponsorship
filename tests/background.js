/* Background work, on a schedule (November 7, 2026).

   Three jobs used to wait for someone with edit rights to open the portal:
     - turning a new application from a prospectus into a record (the inbox),
     - recording payments MISMO Money has found (Paid, and the Payment Made email),
     - putting prospects back on the list once their summits are over.
   This opens the real portal, signed in as the portal's own robot account, exactly the way a
   person would, lets it do those jobs with its own code, and closes it. Nothing is duplicated
   here, so the jobs can never drift from what the portal does when a person opens it.

   GitHub runs it every hour (.github/workflows/background.yml). It needs two repository
   secrets, set once by a GitHub admin (Settings > Secrets and variables > Actions):
       SPONSORSHIP_ROBOT_EMAIL      the robot account's email
       SPONSORSHIP_ROBOT_PASSWORD   its password
   The account needs Staff access to the Sponsorship Portal. Until both secrets are set this
   does nothing and says so.

   Try it on practice data:   node background.js --practice   (serves this folder locally) */
const { chromium } = require('playwright');
const fs = require('fs'), path = require('path'), http = require('http');

const RELAY = 'https://rgvdi67cg27o5kcmiytcqbqnrm0hmztx.lambda-url.us-east-1.on.aws';
const PORTAL_URL = 'https://resources.mismo.org/sponsorship/';
const PRACTICE = process.argv.includes('--practice');
const summary = [];
function say(line) { console.log(line); summary.push(line); }
function finish(code) {
  if (process.env.GITHUB_STEP_SUMMARY) fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, '### Sponsorship background work\n\n' + summary.map(l => '- ' + l).join('\n') + '\n');
  process.exit(code);
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
  let session = null, url = PORTAL_URL, server = null;
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
    try { session = await signIn(); } catch (e) { say('Could not run: ' + e.message); finish(1); }
    if (!session) { say('Not set up yet: add the SPONSORSHIP_ROBOT_EMAIL and SPONSORSHIP_ROBOT_PASSWORD secrets to turn this on.'); finish(0); }
    if (!/^(admin|staff)$/.test(String(session.access.sponsorship || ''))) {
      /* the access map from sign-in can be partial; the portal asks the relay itself, so carry on and let it decide */
    }
  }

  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1400, height: 900 } });
  if (session) await ctx.addInitScript(s => { try { localStorage.setItem('resources:session', s); } catch (e) {} }, JSON.stringify(session));
  const page = await ctx.newPage();
  const errors = [], toasts = [];
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
    stamp: (document.getElementById('money-stamp') || {}).textContent || ''
  }));
  await page.waitForTimeout(10000);   // the saves the jobs started
  await browser.close();
  if (server) server.close();

  if (state.gate) { say('Could not run: the portal asked the robot account to sign in, so it has no access to the Sponsorship Portal.'); finish(1); }
  if (state.conn) { say('The portal showed a warning: ' + state.conn); }
  const fromInbox = toasts.filter(t => /online prospectus/i.test(t));
  say(fromInbox.length ? 'New applications: ' + fromInbox.join(' ') : 'No new applications from the prospectuses.');
  say(/recorded/i.test(state.money) ? state.money.replace(/\s*Got It$/, '').replace(/\n+/g, ' ') : 'No new payments from MISMO Money. ' + state.stamp.trim() + '.');
  if (errors.length) { say('Page errors: ' + errors.join(' | ')); finish(1); }
  finish(state.conn ? 1 : 0);
})().catch(e => { say('Could not run: ' + e.message); finish(1); });
