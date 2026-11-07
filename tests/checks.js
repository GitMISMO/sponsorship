/* Automated checks for the Sponsorship Portal and the three prospectuses (November 7, 2026).

   Run before publishing a change to either repo:
       cd tests && npm install && npx playwright install chromium   (first time only)
       node checks.js                       portal, plus the prospectuses if ../../Sponsorship-Prospectus is there
       node checks.js /path/to/Sponsorship-Prospectus
   They also run on GitHub after every change (.github/workflows/checks.yml); a red X on the
   commit means something below failed, and GitHub emails whoever made the change.

   Every check opens the pages with ?practice, so they run on the made-up data in
   ../practice-data.json and nothing real is read, saved or emailed. Each one says in plain
   words what it protects; when one fails, the message says what went wrong. */
const { chromium } = require('playwright');
const http = require('http'), fs = require('fs'), path = require('path');

const PORTAL = path.resolve(__dirname, '..');
const PROS = path.resolve(process.argv[2] || path.join(PORTAL, '..', 'Sponsorship-Prospectus'));
const HAVE_PROS = fs.existsSync(path.join(PROS, 'index.html'));
const PORT = 8790 + Math.floor(Math.random() * 100);
const ORIGIN = 'http://localhost:' + PORT;

/* resources.mismo.org, in miniature: /sponsorship/ and /Sponsorship-Prospectus/ side by side, and a
   made-up website sponsor list at /sponsors/ (tests/fixtures/sponsors/) */
const ROOTS = { '/sponsorship/': PORTAL + '/', '/Sponsorship-Prospectus/': PROS + '/', '/sponsors/': path.join(__dirname, 'fixtures', 'sponsors') + '/' };
const TYPES = { '.js': 'text/javascript', '.json': 'application/json', '.html': 'text/html', '.png': 'image/png', '.svg': 'image/svg+xml' };
const server = http.createServer((req, res) => {
  let p = decodeURIComponent(req.url.split('?')[0]);
  if (p.endsWith('/')) p += 'index.html';
  let f = null;
  for (const k in ROOTS) if (p.startsWith(k)) f = ROOTS[k] + p.slice(k.length);
  if (!f || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.writeHead(404); return res.end(); }
  res.writeHead(200, { 'Content-Type': (TYPES[path.extname(f)] || 'application/octet-stream') + '; charset=utf-8' });
  fs.createReadStream(f).pipe(res);
});

const results = [];
function pass(name) { results.push({ ok: true, name }); console.log('  ✓ ' + name); }
function fail(name, why) { results.push({ ok: false, name, why }); console.log('  ✗ ' + name + '\n      ' + why); }
async function check(name, fn) {
  try { await fn(); pass(name); } catch (e) { fail(name, (e && e.message) || String(e)); }
}
function expect(cond, msg) { if (!cond) throw new Error(msg); }

let browser;
/* a fresh browser profile = fresh practice data */
async function open(url, opts = {}) {
  const ctx = opts.ctx || await browser.newContext({ viewport: opts.viewport || { width: 1400, height: 900 } });
  const page = await ctx.newPage();
  page.errors = []; page.outside = [];
  page.on('pageerror', e => page.errors.push(String(e).split('\n')[0]));
  page.on('dialog', d => d.accept());
  if (!opts.ctx) await ctx.route(u => !u.href.startsWith(ORIGIN), r => {
    const h = new URL(r.request().url()).hostname;
    if (!/fonts\.(googleapis|gstatic)\.com$/.test(h)) page.outside.push(h);
    return r.abort();
  });
  await page.goto(ORIGIN + url, { waitUntil: 'load' });
  await page.waitForTimeout(opts.wait || 3000);
  page.ctx = ctx;
  return page;
}
const P = (page, fn, arg) => page.evaluate(fn, arg);
const apps = page => P(page, () => { const d = window.__practice.file('applications').docs; return Object.keys(d).map(id => Object.assign({ id }, d[id])); });
const appBy = async (page, test) => (await apps(page)).find(test);

(async () => {
  await new Promise(r => server.listen(PORT, r));
  browser = await chromium.launch();

  if (HAVE_PROS) {
    console.log('\nPrice list (Sponsorship-Prospectus/catalog.json)');
    const L = require('./catalog-lib');
    let cat = null;
    await check('the price list is readable and complete', async () => {
      cat = L.loadCatalog(PROS);
      expect(cat.tiers && cat.tiers.length === 5, 'expected 5 tiers, found ' + (cat.tiers || []).length);
      for (const t of cat.tiers) {
        expect(t.single > 0 && t.series > 0 && t.comps > 0, t.name + ' is missing a price or registration count');
        expect(Math.abs(t.series - t.single * 3 * 0.9) < 0.01, t.name + ' series price ' + t.series + ' is not three summits less 10% (' + t.single * 2.7 + ')');
      }
    });
    if (cat) {
      await check('all three prospectuses match the price list', async () => {
        const d = L.comparePages(PROS, cat);
        expect(!d.length, d.join('; ') + '. Run node apply-catalog.js to fix.');
      });
      await check('each prospectus shows exactly the contract wording it says it shows', async () => {
        const crypto = require('crypto');
        const norm = h => h.replace(/\s+/g, ' ').trim();
        const sha = h => crypto.createHash('sha256').update(norm(h)).digest('hex');
        const vf = path.join(PROS, 'contracts', 'versions.json');
        expect(fs.existsSync(vf), 'contracts/versions.json is missing');
        const versions = JSON.parse(fs.readFileSync(vf, 'utf8')).versions;
        for (const v of versions) {
          const f = path.join(PROS, 'contracts', v.file);
          expect(fs.existsSync(f), 'the saved wording for ' + v.version + ' (' + v.file + ') is missing');
          const t = fs.readFileSync(f, 'utf8'), m = /<div class="contract-terms"[^>]*>([\s\S]*?)\n<\/div>/.exec(t);
          expect(m && sha(m[1]) === v.sha256, 'the saved wording for ' + v.version + ' has been changed. A signed version must never change; save new wording as a new version');
        }
        for (const pg of L.PAGES) {
          const t = fs.readFileSync(path.join(PROS, pg.file), 'utf8');
          const m = /<div class="contract-box" data-contract-version="([^"]+)">([\s\S]*?)<\/div>/.exec(t);
          expect(m, pg.file + ': the contract box has no data-contract-version');
          const v = versions.find(x => x.version === m[1]);
          expect(v, pg.file + ' says it shows contract ' + m[1] + ', which is not in contracts/versions.json');
          expect(sha(m[2]) === v.sha256, pg.file + ': the contract wording differs from version ' + m[1] + '. If the contract changed, save it as a new version in contracts/ and point the page at it');
          expect(/contractVersion:/.test(t), pg.file + ' does not send the contract version with an application');
        }
      });
      await check('every prospectus is exactly what tools/build.py makes from the template', async () => {
        const os = require('os'), cp = require('child_process');
        const out = fs.mkdtempSync(path.join(os.tmpdir(), 'pros-'));
        cp.execFileSync('python3', [path.join(PROS, 'tools', 'build.py'), out], { stdio: 'pipe' });
        const conf = JSON.parse(fs.readFileSync(path.join(PROS, 'tools', 'prospectuses.json'), 'utf8'));
        const files = ['index.html'].concat(conf.pages.map(p => p.folder + '/index.html'));
        const off = files.filter(f => !fs.existsSync(path.join(PROS, f)) || fs.readFileSync(path.join(PROS, f), 'utf8') !== fs.readFileSync(path.join(out, f), 'utf8'));
        expect(!off.length, off.join(', ') + ' differ from the build. Make the change in tools/template.html (or tools/prospectuses.json), run python3 tools/build.py, and publish what it writes');
      });
      await check('the portal matches the price list', async () => {
        const d = L.comparePortal(path.join(PORTAL, 'index.html'), cat);
        expect(!d.length, d.join('; ') + '. Run node apply-catalog.js to fix.');
      });
    }
  }

  console.log('\nSponsorship Portal');
  const portal = await open('/sponsorship/?practice');

  await check('opens with no errors, in practice mode', async () => {
    expect(await P(portal, () => !!window.__practice && !!document.getElementById('practice-bar')), 'the practice bar is missing, so practice.js did not load');
    expect(!portal.errors.length, 'page errors: ' + portal.errors.join(' | '));
    expect(await P(portal, () => { const b = document.getElementById('conn-banner'); return !b || b.style.display === 'none' || !b.textContent.trim(); }),
      'a connection warning is showing: ' + await P(portal, () => document.getElementById('conn-banner').textContent));
  });

  await check('every section on the left opens without an error', async () => {
    const views = await P(portal, () => [...document.querySelectorAll('.tab[data-view]')].map(t => t.getAttribute('data-view')));
    expect(views.length >= 6, 'expected the left panel sections, found ' + views.length);
    for (const v of views) {
      await portal.click('.tab[data-view="' + v + '"]');
      await portal.waitForTimeout(250);
      const shown = await P(portal, v => { const s = document.getElementById('view-' + v); return !!s && s.offsetParent !== null && s.textContent.trim().length > 20; }, v);
      expect(shown, 'the "' + v + '" section did not show');
    }
    expect(!portal.errors.length, 'page errors while switching sections: ' + portal.errors.join(' | '));
    await portal.click('.tab[data-view="pipeline"]').catch(() => {});
  });

  await check('an application from the prospectus inbox becomes a record on the right summit', async () => {
    const a = await appBy(portal, x => x.prospectusRef === 'MS27-T0006');
    expect(a, 'the Spring application waiting in the inbox (MS27-T0006) was not turned into a record');
    expect(a.event === 'Spring 2027', 'it was filed under "' + a.event + '", not Spring 2027');
    expect(a.status === 'Submitted', 'its status is ' + a.status);
    expect(Number(a.amountDue) === 5000, 'amount due is ' + a.amountDue + ', expected 5000');
    expect(a.day === 'Wednesday', 'day is ' + a.day);
    const all = await apps(portal);
    expect(new Set(all.map(x => x.appNo)).size === all.length, 'two records share an application number');
    /* several applications arriving together are each taken exactly once */
    const nos = all.map(x => +String(x.appNo).replace(/\D/g, '')).sort((a, b) => a - b);
    expect(nos.every((n, i) => !i || n === nos[i - 1] + 1), 'application numbers skip (' + nos.join(', ') + '), so something was taken twice');
    const log = (await P(portal, () => window.__practice.file('log').entries)).filter(e => /received from the online prospectus/.test(e.text || e.what || JSON.stringify(e)));
    expect(log.length === 3, log.length + ' "received from the online prospectus" entries for 3 applications');
  });

  await check('a custom package can set the day at each summit, and the list hears about it', async () => {
    await portal.click('tr[data-open="app-t-custom"]');
    await portal.waitForTimeout(500);
    expect(await portal.isVisible('#x-cday-Spring') && await portal.isVisible('#x-cday-Fall'), 'no Day choice on the Spring and Fall lines');
    expect(!(await portal.isVisible('#x-cday-Winter')), 'a Day choice shows for the Livestream, which has no days');
    await portal.selectOption('#x-cday-Spring', 'Tuesday');
    await portal.selectOption('#x-cday-Fall', 'Tuesday');
    await portal.click('#d-save');
    await portal.waitForTimeout(2500);
    const a = await appBy(portal, x => x.id === 'app-t-custom');
    const days = (a.custom || []).map(l => l.s + ':' + (l.day || '-')).join(' ');
    expect(days === 'Winter:- Spring:Tuesday Fall:Tuesday', 'the lines saved as ' + days);
    const row = (await P(portal, () => window.__practice.list())).find(r => r.reference === 'MS27-T0010');
    const lines = JSON.parse((row && row.lines) || '[]');
    expect(lines.filter(l => l.day === 'Tuesday').map(l => l.s).join(',') === 'Spring,Fall', 'the list was told: ' + (row && row.lines));
    await portal.click('#d-close').catch(() => {});
    await portal.waitForTimeout(300);
  });

  await check('each application records which contract wording it agreed to, and prints a signed copy', async () => {
    const a = await appBy(portal, x => x.prospectusRef === 'MS27-T0006');
    if (HAVE_PROS) expect(a.contractVersion === '2027-v1', 'the contract version recorded is "' + a.contractVersion + '"');
    expect(a.acceptanceTitle === 'VP Marketing', 'the signer\'s title was not kept ("' + a.acceptanceTitle + '")');
    if (!HAVE_PROS) return;
    await portal.click('tr[data-open="' + a.id + '"]');
    await portal.waitForTimeout(400);
    const line = await P(portal, () => (document.querySelector('#drawer .contractline') || {}).textContent || '');
    expect(/Version 2027-v1/.test(line), 'the record does not show the contract version: "' + line + '"');
    const [pop] = await Promise.all([portal.waitForEvent('popup'), portal.click('#x-print-contract')]);
    await pop.waitForTimeout(1200);
    const txt = await pop.evaluate(() => document.body.innerText);
    expect(/Litware Analytics/.test(txt) && /Gray Test, VP Marketing/.test(txt), 'the signed copy is missing the sponsor or signer');
    expect(/Cancellation and Force Majeure/.test(txt) && /Version|2027-v1/.test(txt), 'the signed copy is missing the contract terms');
    await pop.close();
    await portal.click('#d-cancel').catch(() => {});
    await portal.click('#d-close').catch(() => {});
    await portal.waitForTimeout(300);
  });

  await check('the price comes from the price list, not from the sponsor\'s page', async () => {
    const ok = await appBy(portal, x => x.prospectusRef === 'MS27-T0006');
    expect(!ok.priceFlag, 'a correctly priced application was flagged: ' + ok.priceFlag);
    const t = await appBy(portal, x => x.prospectusRef === 'MS27-T0007');
    expect(t, 'the $5 test application was not taken in');
    expect(Number(t.amountDue) === 40500, 'a page that sent $5 for Platinum Series left the amount due at ' + t.amountDue);
    expect(Number(t.priceSent) === 5 && /40,500/.test(t.priceFlag || ''), 'the $5 was not flagged (' + t.priceFlag + ')');
    const g = await appBy(portal, x => x.prospectusRef === 'MS27-T0008');
    expect(/PLATINUM opportunity/.test(g.priceFlag || ''), 'a Platinum opportunity sold as Gold was not flagged (' + g.priceFlag + ')');
    await portal.click('tr[data-open="' + t.id + '"]');
    await portal.waitForTimeout(400);
    const warn = await P(portal, () => (document.querySelector('#drawer .dnote.warn') || {}).textContent || '');
    expect(/Check the price before approving/.test(warn) && /\$5\b/.test(warn), 'the record does not warn about the price: "' + warn + '"');
    await portal.click('#d-cancel').catch(() => {});
    await portal.click('#d-close').catch(() => {});
    await portal.waitForTimeout(300);
  });

  await check('likely spam is held for review, not made into a record', async () => {
    const all = await apps(portal);
    expect(!all.some(a => /MS27-T0009|MS27-T0011/.test(a.prospectusRef || '')), 'a spam application was made into a record');
    const banner = await P(portal, () => { const b = document.getElementById('held-banner'); return b && b.style.display !== 'none' ? b.textContent : ''; });
    expect(/2 applications look like spam/.test(banner) && /hidden spam box/.test(banner) && /2 seconds/.test(banner), 'the held list is not showing them: "' + banner.slice(0, 200) + '"');
    await portal.click('[data-held-take="ms27-t0011"]');
    await portal.waitForTimeout(1500);
    await portal.click('[data-held-drop="ms27-t0009"]');
    await portal.waitForTimeout(1500);
    const kept = await appBy(portal, x => x.prospectusRef === 'MS27-T0011');
    expect(kept && kept.status === 'Submitted', 'Take It In did not put it on the Pipeline');
    const taken = await P(portal, () => window.__practice.file('inbox-taken').docs);
    expect(taken['ms27-t0009'] && taken['ms27-t0009'].dismissed && taken['ms27-t0011'].released, 'the choices were not saved: ' + JSON.stringify(taken).slice(0, 200));
    expect(await P(portal, () => document.getElementById('held-banner').style.display === 'none'), 'the held list did not clear');
  });

  await check('a payment in MISMO Money marks the record Paid and sends the Payment Made email once', async () => {
    const a = await appBy(portal, x => x.appNo === 'AN90005');
    expect(a.status === 'Paid', 'Adatum Credit is still ' + a.status);
    expect(Number(a.amountPaid) === 10000, 'amount paid is ' + a.amountPaid);
    const sent = await P(portal, () => window.__practice.sent());
    const paid = sent.filter(x => x.emailKind === 'paid' && x.appNo === 'AN90005');
    expect(paid.length === 1, paid.length + ' Payment Made emails went out for it');
    const row = (await P(portal, () => window.__practice.list())).find(r => r.reference === 'MS27-T0005');
    expect(row && row.status === 'Paid', 'the Sponsorship Requests list row says ' + (row && row.status));
    const n = (await P(portal, () => window.__practice.sent())).filter(x => x.emailKind === 'paid').length;
    await portal.reload(); await portal.waitForTimeout(3000);
    const n2 = (await P(portal, () => window.__practice.sent())).filter(x => x.emailKind === 'paid').length;
    expect(n2 === n, 'opening the portal again sent the Payment Made email again');
  });

  await check('approving keeps a change someone else saved a moment earlier', async () => {
    await portal.click('tr[data-open="app-t-new"]');
    await portal.waitForTimeout(500);
    /* while the record is open here, someone else saves a note and a new email on it */
    await P(portal, () => window.__practice.write('applications', d => {
      d.docs['app-t-new'].comments = 'Practice record. Changed by someone else.';
      d.docs['app-t-new'].contactEmail = 'drew.new@example.org';
    }));
    await portal.fill('#x-statusNotes', 'Approved in the automated check');
    await portal.click('#drawer button:has-text("Approved")');
    await portal.waitForTimeout(300);
    if (await portal.isVisible('#d-save')) await portal.click('#d-save');
    await portal.waitForTimeout(2500);
    const a = await appBy(portal, x => x.id === 'app-t-new');
    expect(a.status === 'Approved', 'status is ' + a.status);
    expect(a.statusNotes === 'Approved in the automated check', 'this screen\'s note was not saved');
    expect(/someone else/.test(a.comments || ''), 'the other person\'s comment was overwritten');
    expect(a.contactEmail === 'drew.new@example.org', 'the other person\'s email change was overwritten');
    const row = (await P(portal, () => window.__practice.list())).find(r => r.reference === 'MS27-T0004');
    expect(row && row.status === 'Approved', 'the list row was not updated to Approved (' + (row && row.status) + ')');
    const invoice = (await P(portal, () => window.__practice.sent())).filter(x => x.emailKind === 'invoice' && x.appNo === 'AN90004');
    expect(invoice.length === 1, invoice.length + ' invoice requests went to Bernie');
  });

  await check('the Sponsorship Requests list is checked against the records and put right', async () => {
    if (!HAVE_PROS) return;   // it reads the Availability flow's address from the prospectus
    await P(portal, () => { const c = document.getElementById('d-close'); if (c && c.offsetParent) c.click(); });
    await portal.waitForTimeout(300);
    await portal.click('.tab[data-view="stock"]');
    await portal.waitForFunction(() => !/Checking the Sponsorship Requests list/.test(document.getElementById('stock-body').textContent), null, { timeout: 25000 }).catch(() => {});
    let note = await P(portal, () => (document.getElementById('view-stock') || document.body).textContent);
    expect(/Sponsorship Requests list matches these records/.test(note), 'the list check did not say the list matches: ' + (note.match(/Sponsorship Requests list[^.]*\./) || ['(nothing)'])[0]);
    /* a missed flow run: Fabrikam's row is lost and a stray sold slot appears */
    await P(portal, () => window.__practice.setList(list => {
      const i = list.findIndex(r => r.reference === 'MS27-T0003'); list.splice(i, 1);
      list.push({ reference: 'MS27-STRAY', program: 'Fall Summit', tier: 'Silver', opportunity: 'Banner Sponsor', day: null, status: 'Approved', lines: null });
    }));
    await portal.reload(); await portal.waitForTimeout(13000);
    await P(portal, () => { const c = document.getElementById('d-close'); if (c && c.offsetParent) c.click(); });
    await portal.click('.tab[data-view="stock"]');
    await portal.waitForFunction(() => !/Checking the Sponsorship Requests list/.test(document.getElementById('stock-body').textContent), null, { timeout: 25000 }).catch(() => {});
    await portal.waitForTimeout(2000);
    note = await P(portal, () => (document.getElementById('view-stock') || document.body).textContent);
    expect(/doesn.t match these records/.test(note) && /Fabrikam Title/.test(note) && /Banner Sponsor/.test(note), 'the mismatch was not reported: ' + (note.match(/Sponsorship Requests list[\s\S]{0,300}/) || ['(nothing)'])[0]);
    const row = (await P(portal, () => window.__practice.list())).find(r => r.reference === 'MS27-T0003');
    expect(row && row.status === 'Approved', 'Fabrikam was not sent to the list again');
    await portal.click('.tab[data-view="pipeline"]').catch(() => {});
  });

  await check('the activity log keeps everything, in monthly files, and shows on each record', async () => {
    const month = 'log-' + new Date().toISOString().slice(0, 7);
    /* someone else's entry saved a moment ago must survive this screen's next one */
    await P(portal, () => window.__practice.write('log', d => { d.entries.unshift({ at: new Date().toISOString(), appNo: 'AN90001', what: 'note from another screen', who: 'Someone Else' }); }));
    await P(portal, () => { const c = document.getElementById('d-close'); if (c && c.offsetParent) c.click(); });
    await portal.click('tr[data-open="app-t-spring"]');
    await portal.waitForTimeout(400);
    await portal.click('#drawer button:has-text("Pending")').catch(() => {});
    await portal.fill('#x-statusNotes', 'History check');
    await portal.click('#d-save');
    await portal.waitForTimeout(2500);
    const main = await P(portal, () => window.__practice.file('log').entries);
    expect(main.some(e => e.what === 'note from another screen'), 'another screen\'s log entry was wiped out');
    const mf = await P(portal, m => window.__practice.file(m), month);
    expect(mf && mf.entries && mf.entries.length >= main.filter(e => String(e.at).slice(0, 7) === month.slice(4)).length - 1,
      'this month\'s history file is missing or short (' + (mf && mf.entries ? mf.entries.length : 'none') + ')');
    const old = await P(portal, () => window.__practice.file('log-' + new Date(Date.now() - 30 * 864e5).toISOString().slice(0, 7)));
    expect(old && old.entries.some(e => e.appNo === 'AN90001'), 'last month\'s entries were not swept into their month\'s file');
    await P(portal, () => { const c = document.getElementById('d-close'); if (c && c.offsetParent) c.click(); });
    await portal.click('tr[data-open="app-t-paid"]');
    await portal.waitForTimeout(400);
    await portal.click('#x-fullhist');
    await portal.waitForTimeout(1500);
    const hist = await P(portal, () => document.getElementById('x-hist').textContent);
    expect(/marked Paid from MISMO Money/.test(hist) && /note from another screen/.test(hist) && /monthly history files/.test(hist), 'the full history does not show: "' + hist.slice(0, 200) + '"');
    await P(portal, () => { const c = document.getElementById('d-close'); if (c && c.offsetParent) c.click(); });
  });

  await check('every approved sponsor has a benefits checklist with owners and due dates', async () => {
    await P(portal, () => { const c = document.getElementById('d-close'); if (c && c.offsetParent) c.click(); });
    await portal.click('.tab[data-view="benefits"]');
    await portal.waitForTimeout(500);
    await portal.selectOption('#ben-summit', 'Winter 2027');
    await portal.waitForTimeout(300);
    const body = await P(portal, () => document.getElementById('ben-body').textContent);
    expect(/Northwind Lending/.test(body) && /Contoso Mortgage/.test(body) && /Dedicated LinkedIn recognition post/.test(body), 'the Winter checklist is missing sponsors or items');
    expect(!/Proseware Price Test/.test(body), 'a sponsorship still waiting for approval has a checklist');
    expect(/6 complimentary registrations: comp code sent[\s\S]*?Done \(comp code on the record\)/.test(body), 'registrations did not tick themselves from the comp code');
    /* the logo is never a to-do while the website shows it; only a name with no logo file is */
    expect(/Logo on the website[\s\S]*?Done \(on the website with its logo\)/.test(body), 'a logo already on the website is not ticked from the website list');
    expect(/Logo file for the website/.test(body), 'a sponsor the website shows without a logo is not listed as needing its logo file');
    const todo = await P(portal, () => { const h = document.getElementById('ben-todo-head'); const t = h && h.nextElementSibling; return t ? t.textContent : ''; });
    expect(!/Logo on the website/.test(todo), 'a logo the website handles is still on the To Do list');
    expect(/Contoso Mortgage\s*Logo file for the website/.test(todo), 'the missing logo file is not on the To Do list');
    /* the agenda ticks itself from Summit HQ: Northwind by its person record, Contoso by the sponsor card's mark */
    /* the agenda is never a to-do (the website adds sponsors to it); it shows Summit HQ's mark where there is one */
    expect(!/On the summit agenda/.test(todo), 'the agenda is on the To Do list, but the website adds sponsors to it automatically');
    expect(/Done \(on the agenda in Summit HQ\)/.test(body), 'the agenda did not show Summit HQ\'s mark');
    /* the weekly registration list is sent by a flow, and To Do only holds what is due in the next 45 days */
    expect(!/Weekly registration list/.test(todo), 'the weekly registration list (sent by a flow) is on the To Do list');
    const late = await P(portal, () => { const lim = new Date(); lim.setDate(lim.getDate() + 45); const h = document.getElementById('ben-todo-head'); const t = h && h.nextElementSibling;
      return t ? [...t.querySelectorAll('tbody tr')].map(r => r.querySelector('td').textContent).filter(d => new Date(d) > lim) : []; });
    expect(!late.length, 'To Do has items due more than 45 days out: ' + late.join(', '));
    expect(!/Rosalyn/.test(body), 'Rosalyn is listed in the portal (she works from Summit HQ only)');
    /* someone else ticks the LinkedIn post while this screen ticks the Mic'd Up invitation: both stay */
    await P(portal, () => window.__practice.write('applications', d => { d.docs['app-t-paid']['bf:Winter 2027:linkedin'] = { done: '2026-11-07', by: 'Someone Else' }; }));
    const unfold = () => P(portal, () => document.querySelectorAll('#ben-body details').forEach(d => { d.open = true; }));
    await unfold();
    await portal.click('[data-ben-done="bf:Winter 2027:micdup"][data-ben-id="app-t-paid"]');
    await portal.waitForTimeout(2000);
    await unfold();
    await portal.selectOption('[data-ben-owner="bf:Winter 2027:chair"][data-ben-id="app-t-paid"]', 'Amy Moses');
    await portal.waitForTimeout(2000);
    const a = await appBy(portal, x => x.id === 'app-t-paid');
    expect(a['bf:Winter 2027:micdup'] && a['bf:Winter 2027:micdup'].done, 'Done was not saved');
    expect(a['bf:Winter 2027:linkedin'] && a['bf:Winter 2027:linkedin'].by === 'Someone Else', 'another person\'s tick was overwritten');
    expect(a['bf:Winter 2027:chair'] && a['bf:Winter 2027:chair'].owner === 'Amy Moses', 'the owner change was not saved');
    await portal.click('.tab[data-view="pipeline"]').catch(() => {});
  });

  await check('nothing reaches a real address', async () => {
    const out = [...new Set(portal.outside)];
    expect(!out.length, 'the page tried to reach ' + out.join(', '));
    const blocked = (await P(portal, () => window.__practice.sent())).filter(x => x.kind === 'blocked');
    expect(!blocked.length, blocked.map(x => x.text).join('; '));
    expect(!portal.errors.length, 'page errors: ' + portal.errors.join(' | '));
  });
  await portal.ctx.close();

  if (!HAVE_PROS) {
    console.log('\n(Prospectus checks skipped: no Sponsorship-Prospectus folder at ' + PROS + ')');
  } else {
    console.log('\nProspectuses');
    const PAGES = [
      { url: '/Sponsorship-Prospectus/', name: '2027 Series and Winter', col: 'Winter Summit', programs: ['Winter Summit', 'Summit Series'] },
      { url: '/Sponsorship-Prospectus/spring-2027/', name: 'Spring 2027', col: 'Spring Summit', programs: ['Spring Summit'] },
      { url: '/Sponsorship-Prospectus/fall-2027/', name: 'Fall 2027', col: 'Fall Summit', programs: ['Fall Summit'] },
      { url: '/Sponsorship-Prospectus/spring-fall-2027/', name: 'Spring & Fall 2027', col: 'Spring & Fall Summits', programs: ['Summit Series'], package: 'springfall', price: 9000 }
    ];
    /* the availability table's cell for one opportunity under one column ("Winter Summit", "Summit Series", ...) */
    const cell = (page, opp, col) => P(page, ([opp, col]) => {
      const t = document.querySelector('.snap-table'); if (!t) return '';
      const heads = [...t.querySelectorAll('thead th')].map(th => th.textContent.trim());
      const i = heads.findIndex(h => h.indexOf(col) >= 0);
      const r = [...t.querySelectorAll('tbody tr')].find(tr => tr.children[0].textContent.trim() === opp);
      return (r && i >= 0 && r.children[i]) ? r.children[i].textContent.replace(/\s+/g, ' ').trim() : '(no ' + col + ' column for ' + opp + ')';
    }, [opp, col]);
    for (const pg of PAGES) {
      const page = await open(pg.url + '?practice', { wait: 1500 });
      await check(pg.name + ': opens with no errors and reads availability', async () => {
        expect(!page.errors.length, 'page errors: ' + page.errors.join(' | '));
        const stamp = await P(page, () => (document.getElementById('avail-stamp') || {}).textContent || '');
        expect(/just now|Checked/i.test(stamp), 'availability was not read from the list (it says "' + stamp + '")');
      });
      await check(pg.name + ': sold slots show at the right summit only', async () => {
        /* practice data: a Series Workshop (all three summits), Spring-only Event App, Fall-only Session Introduction */
        const work = await cell(page, 'Workshop Sponsor', pg.col);
        const app = await cell(page, 'Event App Sponsor', pg.col);
        const intro = await cell(page, 'Session Introduction', pg.col);
        expect(/1 sold/i.test(work), 'the Series Workshop sale is not counted at ' + pg.col + ': "' + work + '"');
        if (pg.package) {
          /* a package needs the slot free at both: Spring's sale and Fall's sale both count */
          expect(/^sold$/i.test(app), 'Spring\'s Event App sale does not make the package sold: "' + app + '"');
          expect(/1 sold/i.test(intro), 'Fall\'s Session Introduction sale is not counted on the package: "' + intro + '"');
          return;
        }
        if (pg.col === 'Spring Summit') expect(/^sold$/i.test(app), 'Spring\'s Event App sale is not shown as sold: "' + app + '"');
        else expect(/available/i.test(app) && !/sold/i.test(app), 'Spring\'s Event App sale shows at ' + pg.col + ': "' + app + '"');
        if (pg.col === 'Fall Summit') expect(/1 sold/i.test(intro), 'Fall\'s Session Introduction sale is not counted: "' + intro + '"');
        else expect(!/sold/i.test(intro), 'Fall\'s Session Introduction sale shows at ' + pg.col + ': "' + intro + '"');
        if (pg.col === 'Winter Summit') {
          /* a Series slot has to be free at all three summits, so a sale at any one of them takes it */
          const s1 = await cell(page, 'Session Introduction', 'Summit Series'), s2 = await cell(page, 'Event App Sponsor', 'Summit Series');
          expect(/1 sold/i.test(s1), 'the Series column ignores Fall\'s Session Introduction sale: "' + s1 + '"');
          expect(/^sold$/i.test(s2), 'the Series column ignores Spring\'s Event App sale: "' + s2 + '"');
        }
      });
      await check(pg.name + ': an application goes through with the right summit and price', async () => {
        await P(page, () => document.getElementById('reserve').scrollIntoView());
        if (await page.isVisible('[data-program="winter"], .opt-card[data-value="winter"]').catch(() => false)) {
          await page.click('.opt-card[data-value="winter"]').catch(() => {});
        }
        await page.click('#tier-options .opt-card[data-value="bronze"]');
        await page.click('#opp-options .opt-card:has-text("Afternoon Snack")');
        await page.click('.day-chip:not([disabled]) >> nth=0');
        await page.fill('#f-company', 'Check ' + pg.name);
        await page.fill('#f-contact', 'Pat Check'); await page.fill('#f-email', 'pat@example.org'); await page.fill('#f-phone', '555-0100');
        const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=', 'base64');
        await page.setInputFiles('#f-logo', { name: 'logo.png', mimeType: 'image/png', buffer: png });
        await page.waitForTimeout(300);
        await page.fill('#f-signer-name', 'Pat Check'); await page.fill('#f-signer-title', 'VP'); await page.fill('#f-signer-date', '2026-11-07');
        await page.check('#f-agree');
        await page.waitForTimeout(3000);   // a person takes more than five seconds; quicker is held as likely spam
        await page.click('#submit-btn');
        await page.waitForTimeout(1200);
        const sub = (await P(page, () => window.__practice.sent())).find(x => x.kind === 'intake');
        expect(sub, 'nothing reached the Intake flow');
        const p = sub.payload;
        expect(pg.programs.indexOf(p.program) >= 0, 'program sent was "' + p.program + '", expected ' + pg.programs.join(' or '));
        const price = Number(String(p.price).replace(/[^0-9.]/g, ''));
        const want = pg.price || (p.program === 'Summit Series' ? 13500 : 5000);
        if (pg.package) expect(p.package === pg.package && p.summits === 'Spring,Fall', 'the package was sent as "' + p.package + '" for "' + p.summits + '"');
        expect(price === want, 'price sent was ' + p.price + ', the catalog says ' + want);
        expect(p.agreed && p.signerName === 'Pat Check', 'the signature was not sent');
        expect(p.contractVersion === '2027-v1', 'the contract version sent was "' + p.contractVersion + '"');
        expect(p.hp === '' && p.secondsOnPage >= 5, 'the spam signs were not sent as a person would send them (box "' + p.hp + '", ' + p.secondsOnPage + ' seconds)');
        expect(!page.errors.length, 'page errors: ' + page.errors.join(' | '));
      });
      await check(pg.name + ': the application arrives in the portal on the right summit', async () => {
        const portal2 = await open('/sponsorship/?practice', { ctx: page.ctx });
        const a = await appBy(portal2, x => x.company === 'Check ' + pg.name);
        expect(a, 'the portal did not pick it up from the inbox');
        const want = pg.name === 'Spring 2027' ? 'Spring 2027' : pg.name === 'Fall 2027' ? 'Fall 2027' : /Series|Winter/;
        expect(want instanceof RegExp ? want.test(a.event) : a.event === want, 'it was filed under "' + a.event + '"');
        if (pg.package) {
          const lines = (a.custom || []).map(l => l.s + ' ' + l.tier + ' ' + l.opp + ' ' + (l.day || '')).join(' | ');
          expect(a.package === pg.package && (a.custom || []).length === 2 && a.custom.every(l => l.tier === 'BRONZE' && /Afternoon Snack/.test(l.opp) && l.day),
            'the package did not become Spring and Fall lines with the day: ' + lines);
          expect(Number(a.amountDue) === pg.price && !a.priceFlag, 'amount due ' + a.amountDue + (a.priceFlag ? ', flagged: ' + a.priceFlag : ''));
        }
        expect(!portal2.errors.length, 'portal errors: ' + portal2.errors.join(' | '));
      });
      await check(pg.name + ': nothing reaches a real address', async () => {
        const out = [...new Set(page.outside)];
        expect(!out.length, 'the page tried to reach ' + out.join(', '));
      });
      await page.ctx.close();

      const phone = await open(pg.url + '?practice', { viewport: { width: 390, height: 844 }, wait: 1200 });
      await check(pg.name + ': fits a phone screen with no sideways scrolling', async () => {
        const w = await P(phone, () => document.documentElement.scrollWidth);
        expect(w <= 392, 'the page is ' + w + 'px wide on a 390px phone');
      });
      await phone.ctx.close();
    }
  }

  await browser.close();
  server.close();
  const bad = results.filter(r => !r.ok);
  console.log('\n' + (bad.length ? bad.length + ' of ' + results.length + ' checks FAILED' : 'All ' + results.length + ' checks passed'));
  if (process.env.GITHUB_STEP_SUMMARY) {
    fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, '### Sponsorship checks\n\n' + results.map(r =>
      (r.ok ? '- ✅ ' : '- ❌ ') + r.name + (r.ok ? '' : ' — ' + r.why)).join('\n') + '\n');
  }
  process.exit(bad.length ? 1 : 0);
})().catch(e => { console.error(e); process.exit(2); });
