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

  console.log('\nMember 360 list (tools/member360-feed.js)');
  await require('./feed-check').run(check, expect);

  console.log('\nSponsorship Portal');
  const portal = await open('/sponsorship/?practice');
  /* A record opens inside its company's card now (November 21, 2026), and the card covers the page. A
     person closes it before working on the page behind; the checks do the same before any click on
     something that isn't in an open panel. */
  {
    const click0 = portal.click.bind(portal);
    portal.click = async (sel, opts) => {
      await portal.evaluate(sel => {
        const cp = document.getElementById('co-panel'); if (!cp || !cp.classList.contains('on')) return;
        let el = null; try { el = document.querySelector(sel); } catch (e) { return; }
        if (!el || el.closest('#co-panel, .drawer.on, #toast, .stagedrawer, .impdrawer')) return;
        ['d-close', 'bd-close', 'ld-close'].forEach(id => { const d = document.getElementById(id); const dr = d && d.closest('.drawer'); if (dr && dr.classList.contains('on')) d.click(); });
        const c = document.getElementById('co-close'); if (c && cp.classList.contains('on')) c.click();
      }, sel).catch(() => {});
      return click0(sel, opts);
    };
  }
  /* open a record the way a person does since the record pages were folded into the Pipeline
     (Nov 18, 2026): its Pipeline row (All, every type) opens its company, and the company's
     own row for it opens the record itself */
  const openRec = async id => {
    await P(portal, () => { ['d-close','ld-close','bd-close','co-close'].forEach(id => { const c = document.getElementById(id); if (c && c.offsetParent) c.click(); }); });
    await portal.click('.tab[data-view="flow"]'); await portal.waitForTimeout(200);
    await portal.click('[data-fgroup="all"]');
    await portal.selectOption('#flow-owner', ''); await portal.fill('#flow-q', ''); await portal.waitForTimeout(150);
    /* the Pipeline shows one kind at a time (November 21, 2026): find the kind the record is */
    for (const k of ['summit', 'workgroup', 'other']) {
      await portal.click('[data-ftype="' + k + '"]'); await portal.waitForTimeout(150);
      if (await portal.isVisible('#flow-body tr[data-fid="' + id + '"]')) break;
    }
    await portal.click('#flow-body tr[data-fid="' + id + '"] td:first-child'); await portal.waitForTimeout(400);
    if (await portal.isVisible('#co-panel.on')) {
      const direct = '#co-panel [data-fid="' + id + '"][data-direct]';
      if (!(await portal.isVisible(direct))) { await portal.click('#co-panel [data-cotab="sponsorships"]'); await portal.waitForTimeout(250); }
      await portal.click(direct); await portal.waitForTimeout(300);
      /* the record now opens inside its company's card */
    }
  };

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
    await portal.click('.tab[data-view="flow"]').catch(() => {});
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
    await openRec('app-t-custom');
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
    await openRec(a.id);
    await portal.waitForTimeout(400);
    const line = await P(portal, () => (document.querySelector('#drawer .contractline') || {}).textContent || '');
    expect(/Version 2027-v1/.test(line), 'the record does not show the contract version: "' + line + '"');
    const [pop] = await Promise.all([portal.waitForEvent('popup'), portal.click('#x-print-contract')]);
    await pop.waitForTimeout(1200);
    const txt = await pop.evaluate(() => document.body.innerText);
    expect(/Litware Analytics/.test(txt) && /Gray Test, VP Marketing/.test(txt), 'the signed copy is missing the sponsor or signer');
    expect(/Cancellation and Force Majeure/.test(txt) && /Version|2027-v1/.test(txt), 'the signed copy is missing the contract terms');
    const sig = await pop.evaluate(() => (document.querySelector('.sig') || {}).innerText || '');
    expect(/Signature/i.test(sig) && /Gray Test/.test(sig) && /VP Marketing/.test(sig), 'the signed copy has no signature block at the end: "' + sig.slice(0, 120) + '"');
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
    await openRec(t.id);
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
    await openRec('app-t-new');
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
    await portal.click('.tab[data-view="flow"]').catch(() => {});
  });

  await check('the activity log keeps everything, in monthly files, and shows on each record', async () => {
    const month = 'log-' + new Date().toISOString().slice(0, 7);
    /* someone else's entry saved a moment ago must survive this screen's next one */
    await P(portal, () => window.__practice.write('log', d => { d.entries.unshift({ at: new Date().toISOString(), appNo: 'AN90001', what: 'note from another screen', who: 'Someone Else' }); }));
    await P(portal, () => { const c = document.getElementById('d-close'); if (c && c.offsetParent) c.click(); });
    await openRec('app-t-spring');
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
    await openRec('app-t-paid');
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
    /* someone else ticks the LinkedIn post while this screen ticks the opportunity: both stay (the Mic'd Up
       invitation ticks itself from MISMO Media now, November 21, 2026) */
    await P(portal, () => window.__practice.write('applications', d => { d.docs['app-t-paid']['bf:Winter 2027:linkedin'] = { done: '2026-11-07', by: 'Someone Else' }; }));
    const unfold = () => P(portal, () => document.querySelectorAll('#ben-body details').forEach(d => { d.open = true; }));
    await unfold();
    await portal.click('[data-ben-done="bf:Winter 2027:opp"][data-ben-id="app-t-paid"]');
    await portal.waitForTimeout(2000);
    await unfold();
    await portal.selectOption('[data-ben-owner="bf:Winter 2027:chair"][data-ben-id="app-t-paid"]', 'Amy Moses');
    await portal.waitForTimeout(2000);
    const a = await appBy(portal, x => x.id === 'app-t-paid');
    expect(a['bf:Winter 2027:opp'] && a['bf:Winter 2027:opp'].done, 'Done was not saved');
    expect(a['bf:Winter 2027:linkedin'] && a['bf:Winter 2027:linkedin'].by === 'Someone Else', 'another person\'s tick was overwritten');
    expect(a['bf:Winter 2027:chair'] && a['bf:Winter 2027:chair'].owner === 'Amy Moses', 'the owner change was not saved');
    await portal.click('.tab[data-view="flow"]').catch(() => {});
  });

  /* ---- one Pipeline, Other Sponsorships, the mismosponsor@ mailbox (November 18, 2026) ---- */
  const fileOf = name => P(portal, n => window.__practice.file(n), name);
  /* a save that doesn't land says so, and no email goes about it (Guidehouse, November 20, 2026) */
  await check('an approval that fails to save says Not Saved, sends no email, and shows what is saved', async () => {
    const before = (await fileOf('applications')).docs['app-ms27-t0008'];
    const ob0 = Object.keys((await fileOf('outbox') || {docs: {}}).docs || {}).length;
    await openRec('app-ms27-t0008'); await portal.waitForTimeout(300);
    await P(portal, () => window.__practice.failNext('applications', 1));
    await portal.click('#drawer [data-setstatus="Approved"]'); await portal.waitForTimeout(4000);
    const after = (await fileOf('applications')).docs['app-ms27-t0008'];
    expect(after.status === before.status, 'the failed save changed the record anyway: ' + after.status);
    const ob1 = Object.keys((await fileOf('outbox') || {docs: {}}).docs || {}).length;
    expect(ob1 === ob0, 'an email was queued for an approval that did not save');
    const tst = await P(portal, () => document.getElementById('toast').innerText);
    expect(/NOT saved/i.test(tst), 'no Not Saved message: ' + tst.slice(0, 200));
    const local = await P(portal, () => document.getElementById('d-msg').textContent);
    expect(/Not saved/.test(local), 'the panel does not say Not saved: ' + local);
    await P(portal, () => window.__practice.failNext('applications', 0));
    await portal.waitForTimeout(1500);
    const hl = Object.entries(((await fileOf('health')) || {docs: {}}).docs || {}).filter(([k, v]) => k !== 'main' && v && v.msg);
    expect(hl.some(([k, v]) => /applications/.test(v.msg)), 'the failed save is not kept for System Health: ' + JSON.stringify(hl).slice(0, 200));
    await P(portal, () => document.getElementById('d-close').click());
  });
  const toTodo = async () => {
    await P(portal, () => { ['d-close','bd-close','ld-close','co-close'].forEach(id => { const c = document.getElementById(id); if (c && c.offsetParent) c.click(); }); });
    await portal.click('.tab[data-view="todo"]'); await portal.waitForTimeout(300);
  };
  const toFlow = async () => {
    await P(portal, () => { ['d-close','bd-close','ld-close','co-close'].forEach(id => { const c = document.getElementById(id); if (c && c.offsetParent) c.click(); }); });
    await portal.click('.tab[data-view="flow"]'); await portal.waitForTimeout(300);
  };
  await check('the Pipeline lists every kind of sponsorship, from lead to paid', async () => {
    await toFlow();
    await portal.click('[data-fgroup="all"]'); await portal.waitForTimeout(200);
    let body = '';
    for (const k of ['summit', 'workgroup', 'other']) { await portal.click('[data-ftype="' + k + '"]'); await portal.waitForTimeout(150); body += await P(portal, () => document.getElementById('flow-body').innerText); }
    expect(await P(portal, () => document.querySelector('[data-ftype="summit"]').getAttribute('aria-pressed') !== null), 'the Pipeline has no Summit button');
    for (const co of ['Wingtip Servicing', 'Litware Group', 'Fourth Coffee Test', 'Proseware Group Test', 'Contoso Mortgage'])
      expect(body.indexOf(co) >= 0, co + ' is missing from the Pipeline');
    expect(/Fourth Coffee Test[\s\S]*?AI Webinar Series/.test(body), 'the AI webinar sponsorship is not shown as its type');
    await portal.click('[data-ftype="other"]'); await portal.click('[data-fgroup="hold"]'); await portal.waitForTimeout(200);
    let hold = ''; for (const k of ['summit', 'workgroup', 'other']) { await portal.click('[data-ftype="' + k + '"]'); await portal.waitForTimeout(120); hold += await P(portal, () => document.getElementById('flow-body').innerText); }
    const hold0 = await P(portal, () => document.getElementById('flow-body').innerText);
    expect(/Margie's Travel Test/.test(hold), 'a prospect saved under an old stage name ("Not Now — Follow Up") is not under Hold');
    await portal.click('[data-fgroup="open"]'); await portal.click('[data-ftype="workgroup"]'); await portal.waitForTimeout(200);
    const types = await P(portal, () => [...document.querySelectorAll('#flow-body tr td:nth-child(2)')].map(td => td.textContent.trim()));
    expect(types.length && types.every(t => t === 'Workgroup'), 'the Workgroup filter shows other types: ' + types.join(', '));
    await portal.click('[data-ftype="summit"]');
  });
  await check('every Pipeline number lists what makes it up, and Due Now stays short', async () => {
    await toFlow();
    await portal.click('[data-fdrill="open"]'); await portal.waitForTimeout(250);
    const said = await P(portal, () => +document.querySelector('[data-fdrill="open"]').textContent);
    const rows = await P(portal, () => document.querySelectorAll('#flow-drill tbody tr').length);
    expect(said > 0 && rows === said, 'the open count says ' + said + ' but the list under it has ' + rows);
    await portal.click('[data-fdrill="worth"]'); await portal.waitForTimeout(250);
    const worth = await P(portal, () => ({said: document.querySelector('[data-fdrill="worth"]').textContent, foot: (document.querySelector('#flow-drill tfoot') || {}).innerText || ''}));
    expect(worth.foot.indexOf(worth.said) >= 0, 'the amounts listed do not add up to ' + worth.said + ': ' + worth.foot);
    await portal.click('[data-fdrill="stage:Contacted"]'); await portal.waitForTimeout(250);
    const st = await P(portal, () => [...document.querySelectorAll('#flow-drill tbody tr td:nth-child(4)')].map(td => td.textContent.trim()));
    expect(st.length && st.every(x => x === 'Contacted'), 'the Contacted list shows other stages: ' + st.join(', '));
    await portal.click('#flow-drill [data-fdrill=""]'); await portal.waitForTimeout(200);
    expect(await P(portal, () => document.getElementById('flow-drill').hidden), 'Close did not put the list away');
    const dueRows = await P(portal, () => document.querySelectorAll('#flow-due .fbrow').length);
    expect(dueRows <= 4, 'Due Now shows ' + dueRows + ' rows (it keeps to four, with See All for the rest)');
    /* the record pages are back as their own pages (November 21, 2026) */
    expect(await P(portal, () => document.querySelectorAll('.tab[data-view="pipeline"], .tab[data-view="workgroup"], .tab[data-view="other"]').length === 3),
      'Summit, Workgroup and Other Sponsorships do not all have a tab');
    /* Prospects is part of the Pipeline (Amy, November 24, 2026) */
    expect(!(await P(portal, () => !!document.querySelector('.tab[data-view="plist"]'))), 'Prospects still has its own tab');
    expect(await portal.isVisible('[data-fdrill="todo"]'), 'applications waiting on a next step are not counted on the Pipeline');
    await portal.click('[data-fdrill="todo"]'); await portal.waitForTimeout(250);
    const todo = await P(portal, () => document.getElementById('flow-drill').innerText);
    expect(/Review and Approve|Raise the Invoice|Raise the invoice/.test(todo), 'the waiting list does not say what each is waiting on: ' + todo.slice(0, 200));
    await portal.click('#flow-drill [data-fdrill=""]');
  });
  await check('Bernie\'s Registration Desk entries (Summit HQ) are applied to the records', async () => {
    const docs = (await fileOf('applications')).docs;
    const d = docs['app-t-desk'];
    expect(d.invoiceNumber === '991234' && d.status === 'Pending Payment', 'the order ID was not applied, or did not move it to Pending Payment: ' + d.invoiceNumber + ' / ' + d.status);
    expect(d.compCode === 'COHO27' && Number(d.numComps) === 4, 'the comp code was not applied: ' + d.compCode + ' (' + d.numComps + ')');
    expect(d['bf:Fall 2027:comps'] && d['bf:Fall 2027:comps'].done && d['bf:Fall 2027:comps'].by === 'Bernardo Jordan', 'the comp code email did not tick the comps benefit');
    expect(d.deskAppliedAt, 'the record does not keep when the Desk was applied');
    /* matched on the application number, two follow-ups, counted once each */
    const c = docs['app-t-series'];
    const today = await P(portal, () => { const x = new Date(); return x.getFullYear() + '-' + String(x.getMonth() + 1).padStart(2, '0') + '-' + String(x.getDate()).padStart(2, '0'); });
    expect(Number(c.followUpCount) === 2 && c.lastFollowUpDate === today && (c.deskChases || []).length === 2, 'the follow-ups were not counted: ' + c.followUpCount + ', last ' + c.lastFollowUpDate);
    /* a payment MISMO Money never sees, marked paid on the Desk, with the usual Payment Made email */
    expect(c.status === 'Paid' && c.paymentReceivedDate && Number(c.amountPaid) > 0, 'the Desk\'s paid date did not mark it Paid: ' + c.status);
    const ob = Object.values((await fileOf('outbox')).docs);
    expect(ob.some(o => o.kind === 'paid' && o.appNo === 'AN90002'), 'no Payment Made email was queued for the payment from the Desk');
    /* an older Desk entry never overwrites the record */
    expect(docs['app-t-paid'].invoiceNumber === '990101', 'an older Desk entry overwrote the order ID');
    const log = await P(portal, () => window.__practice.file('log').entries);
    expect(log.some(e => e.appNo === 'AN90007' && /From the Registration Desk: order 991234/.test(e.what) && /COHO27/.test(e.what)), 'the record\'s history does not say what came from the Desk');
    /* opening again applies nothing twice */
    await portal.reload({ waitUntil: 'load' }); await portal.waitForTimeout(4000);
    const again = (await fileOf('applications')).docs['app-t-series'];
    expect(Number(again.followUpCount) === 2, 'a follow-up was counted twice after reopening: ' + again.followUpCount);
    const n = (await P(portal, () => window.__practice.file('log').entries)).filter(e => e.appNo === 'AN90007' && /Registration Desk/.test(e.what)).length;
    expect(n === 1, 'the Desk entry was applied ' + n + ' times');
  });
  await check('a prospect\'s stage changes on its company card, not in the list', async () => {
    await toFlow();
    expect(!(await P(portal, () => !!document.querySelector('#flow-body select[data-flowstage], #pl-rows select[data-flowstage]'))), 'a list still has a stage picker in the row');
    await openRec('lead-t-1');
    if (await portal.isVisible('#cp-dockback')) { await portal.click('#cp-dockback'); await portal.waitForTimeout(400); }
    if (!(await portal.isVisible('#co-panel select[data-flowstage="lead-t-1"]'))) { await portal.click('#co-panel [data-cotab="overview"]'); await portal.waitForTimeout(300); }
    await portal.selectOption('#co-panel select[data-flowstage="lead-t-1"]', 'Meeting Scheduled');
    await portal.waitForTimeout(1500);
    const l = (await fileOf('leads')).docs['lead-t-1'];
    expect(l.status === 'Meeting Scheduled', 'the stage was not saved: ' + l.status);
    expect((l.history || []).some(h => /Contacted → Meeting Scheduled/.test(h.text)), 'the stage change is not in its notes');
    await P(portal, () => { const c = document.getElementById('co-close'); if (c && c.offsetParent) c.click(); });
  });
  await check('the AI Webinar Series moved into Other Sponsorships, keeping its split', async () => {
    const o = (await fileOf('others')).docs['wb-t-1'], w = (await fileOf('webinars')).docs['wb-t-1'];
    expect(o && o.otype === 'ai-webinar' && o.no === 'WB90001', 'the webinar record was not copied into others.json');
    expect(w && !w.otype, 'webinars.json was changed; it is kept as it was');
    await openRec('wb-t-1');
    const row = await P(portal, () => document.querySelector('#flow-body tr[data-fid="wb-t-1"]').innerText);
    expect(/AI Webinar Series/.test(row), 'the Pipeline row does not show the type: ' + row);
    const rec = await P(portal, () => document.getElementById('bill-drawer').innerText);
    expect(/\$2,000/.test(rec), 'the record does not show MISMO\'s half');
  });
  await check('a new sponsorship type can be added and used', async () => {
    await toFlow();
    await portal.selectOption('#flow-newkind', 'newtype'); await portal.waitForTimeout(200);
    await portal.fill('#ot-name', 'Bootcamp Test');
    await portal.fill('#ot-detail', 'Bootcamp');
    await portal.click('#ot-save'); await portal.waitForTimeout(1200);
    const st = (await fileOf('settings')) || {docs:{}};
    const types = ((st.docs.main || {}).otherTypes || []).map(t => t.key);
    expect(types.indexOf('bootcamp-test') >= 0, 'the type was not saved: ' + types.join(', '));
    await portal.selectOption('#flow-newkind', 'other:bootcamp-test'); await portal.waitForTimeout(400);
    const sel = await P(portal, () => document.getElementById('bx-otype').value);
    expect(sel === 'bootcamp-test', 'a new sponsorship does not start as the type being looked at: ' + sel);
    await P(portal, () => document.getElementById('bd-close').click());
    await toFlow();
    const btns = await P(portal, () => document.getElementById('flow-newkind').innerText + ' | ' + document.getElementById('flow-types').innerText);
    expect(/Bootcamp Test/.test(btns) && /Other/.test(btns), 'the new type is not offered on the Pipeline: ' + btns);
  });
  await check('a workgroup prospect starts its sponsorship, filled in', async () => {
    await toFlow(); await portal.click('[data-ftype="workgroup"]'); await portal.waitForTimeout(200);
    /* a Pipeline row opens the company; its See the Prospect button opens the prospect inside the card */
    await portal.click('#flow-body tr[data-fid="lead-t-wg"] td:first-child'); await portal.waitForTimeout(500);
    expect(await portal.isVisible('#co-panel.on'), 'a Pipeline row did not open the company');
    await portal.click('#co-panel [data-fkind="lead"][data-fid="lead-t-wg"][data-direct]'); await portal.waitForTimeout(500);
    await portal.click('#ld-start'); await portal.waitForTimeout(500);
    const vals = await P(portal, () => ({co: document.getElementById('bx-company').value, wg: document.getElementById('bx-workgroup').value, amt: document.getElementById('bx-amountDue').value}));
    expect(vals.co === 'Litware Group' && vals.wg === 'API Community of Practice' && +vals.amt === 5000, 'the new workgroup sponsorship is not filled in: ' + JSON.stringify(vals));
    await portal.click('#bd-save'); await portal.waitForTimeout(1800);
    const wg = Object.values((await fileOf('workgroups')).docs).find(r => r.fromLead === 'lead-t-wg');
    expect(wg, 'the workgroup sponsorship was not saved');
    const l = (await fileOf('leads')).docs['lead-t-wg'];
    expect(l.status === 'Converted to Sponsorship' && l.linkedBillNo === wg.no, 'the prospect was not marked: ' + l.status);
  });
  await check('emails to mismosponsor@ land on the right sponsor or prospect', async () => {
    const tps = Object.values((await fileOf('touchpoints')).docs);
    const nw = tps.find(t => t.coName === 'Northwind Lending');
    expect(nw && /badge artwork is attached/.test(nw.summary) && nw.by === 'Jonna Critchley', 'the forwarded email is not on Northwind: ' + JSON.stringify(nw));
    const leads = Object.values((await fileOf('leads')).docs);
    const made = leads.find(l => l.company === 'Newco Lending Test');
    expect(made && made.source === 'Email to mismosponsor@' && made.contactEmail === 'pat@newco-lending.test', 'no prospect was made from the unmatched email');
    const mail = (await fileOf('mailin')).docs;
    expect(mail['m-t-3'].st === 'need' && (mail['m-t-3'].cands || []).length > 1, 'an email several sponsors share is not waiting to be picked');
    expect(!mail['m-t-1'].html, 'a logged email\'s HTML was kept in the mailbox file');
    /* a logo attached to the email becomes the company's logo, so the website picks it up (November 24, 2026) */
    const cos = (await fileOf('companies')).docs || {};
    const ck = Object.keys(cos).find(k => cos[k] && cos[k].logo && cos[k].logo.via === 'mismosponsor');
    const lf = ck ? await P(portal, k => window.__practice.file('logo-co-' + k), ck) : null;
    expect(ck && lf && lf.name === 'Northwind 2027 Logo.png' && lf.data && mail['m-t-1'].logoSaved === 'Northwind 2027 Logo.png',
      'the logo emailed to mismosponsor@ did not become Northwind\'s logo: ' + JSON.stringify({ck, name: lf && lf.name, saved: mail['m-t-1'].logoSaved}));
    await toTodo(); await portal.click('[data-awt="mail"]'); await portal.waitForTimeout(200);
    await portal.click('[data-mailpick="m-t-3"][data-name="Contoso Mortgage"]'); await portal.waitForTimeout(1500);
    const m3 = (await fileOf('mailin')).docs['m-t-3'];
    expect(m3.st === 'logged' && m3.coName === 'Contoso Mortgage', 'picking a company did not log it: ' + m3.st);
    await openRec('app-t-paid'); await portal.waitForTimeout(500);
    const dr = await P(portal, () => document.getElementById('drawer').innerText);
    expect(/Badge artwork/.test(dr), 'the sponsor\'s record does not show its emails');
    await P(portal, () => document.getElementById('d-close').click());
  });

  /* ---- companies, like Member 360 (November 18, 2026) ---- */
  /* Sponsors and Prospects, the Member 360 way (November 19, 2026) */
  const toCos = async (life) => {
    await P(portal, () => { ['d-close','bd-close','ld-close','co-close'].forEach(id => { const c = document.getElementById(id); if (c && c.offsetParent) c.click(); }); });
    await portal.click('.tab[data-view="spm"]'); await portal.waitForTimeout(300);
    await portal.click('#spm-life [data-spmlife="' + (life === undefined ? 'Sponsor' : life) + '"]'); await portal.waitForTimeout(200);
    await P(portal, () => { const o = document.getElementById('spm-owes'); if (o && o.classList.contains('on')) o.click(); });
    await portal.selectOption('#spm-what', ''); await portal.selectOption('#spm-stage', ''); await portal.selectOption('#spm-owner', ''); await portal.waitForTimeout(150);
  };
  await check('Home shows the day and the season at a glance', async () => {
    await P(portal, () => { ['d-close','bd-close','ld-close','co-close'].forEach(id => { const c = document.getElementById(id); if (c && c.offsetParent) c.click(); }); });
    await portal.click('.tab[data-view="home"]'); await portal.waitForTimeout(300);
    const t = await P(portal, () => document.getElementById('view-home').innerText);
    expect(/Good (morning|afternoon|evening)/.test(t) && !/On Your Plate/i.test(t) && /Sales Pipeline/i.test(t) && !/Team Activity/i.test(t), 'Home is missing its parts, or still has Team Activity or On Your Plate');
    /* a new application is the first thing on Home (Jonna, November 20, 2026) */
    const came = await P(portal, () => { const x = document.querySelector('#home-hero .hm-in'); return x ? x.innerText : ''; });
    expect(/Just Came In/i.test(came) && /To Review/i.test(came) && /applications? waiting for review/.test(came), 'an application waiting for review is not under Just Came In: ' + came.slice(0, 200));
    expect(/through the prospectus in/.test(came) && /Fabrikam Title/.test(came) && !/New Prospect/i.test(came), 'Just Came In should list this month\'s prospectus sponsors and no prospects: ' + came.slice(0, 300));
    expect(await P(portal, () => document.querySelector('#home-hero').firstElementChild.classList.contains('hm-in')), 'Just Came In is not at the top of Home');
  });
  /* the Outreach Planner: To Do, the Member 360 way (November 19, 2026) */
  await check('choosing a page in the menu opens it at the top', async () => {
    await portal.click('.tab[data-view="spm"]'); await portal.waitForTimeout(300);
    await P(portal, () => window.scrollTo(0, 2000)); await portal.waitForTimeout(150);
    await portal.click('.tab[data-view="flow"]'); await portal.waitForTimeout(400);
    const y = await P(portal, () => window.scrollY);
    expect(y === 0, 'the Pipeline opened ' + y + 'px down the page');
  });
  await check('the Outreach Planner works like Member 360: board, Up Next, drag, done, undo, plan', async () => {
    await toTodo();
    await portal.click('[data-opwho=""]'); await portal.click('[data-opwhen="0"]'); await portal.waitForTimeout(250);
    const t = await P(portal, () => document.getElementById('view-todo').innerText);
    expect(/Outreach Planner/.test(t) && /Up Next/i.test(t) && /Who to Touch/.test(t) && /All Follow-Ups/.test(t), 'the planner is missing its parts');
    expect(/Communicated This Week/i.test(t) && /Follow-Ups Due/i.test(t) && /Applications to Review/i.test(t), 'the number boxes are missing');
    const board = await P(portal, () => document.getElementById('op-board').innerText);
    expect(/Northwind Lending/.test(board), 'a touch planned for today is not on the board');
    expect(/Past Due/.test(board) && /Contoso Mortgage/.test(board), 'a planned touch from last week is not under Past Due');
    const awApps = await P(portal, () => (document.getElementById('aw-apps') || {}).innerText || '');
    expect(/Applications to Review/.test(t) && /Review and approve/.test(awApps), 'an application waiting for review is not under Also Waiting: ' + awApps.slice(0, 200));
    expect(/Emails to mismosponsor@/i.test(t), 'the mismosponsor@ emails are not on the planner');
    await P(portal, () => { document.getElementById('op-fu').open = true; });
    const fu = await P(portal, () => document.getElementById('op-fu-rows').innerText);
    expect(/Wingtip Servicing/.test(fu) && /Coho Lending Test/.test(fu) && /invoice copy/.test(fu), 'All Follow-Ups is missing a prospect follow-up or a touchpoint next step: ' + fu.slice(0, 200));
    /* drag Northwind's planned touch to another day, then undo */
    const T = await P(portal, () => { const d = new Date(), m = d.getMonth() + 1, x = d.getDate(); return d.getFullYear() + '-' + (m < 10 ? '0' : '') + m + '-' + (x < 10 ? '0' : '') + x; });
    const other = await P(portal, T => { const d = [...document.querySelectorAll('#op-board .op-day[data-opday]')].map(x => x.getAttribute('data-opday')).filter(x => x && x !== T); return d[0] || ''; }, T);
    if (other) {
      /* both rows on screen first: a drop row below the window doesn't take the drop (Monday, November 23, 2026) */
      await P(portal, () => document.getElementById('op-board').scrollIntoView({ block: 'start' })); await portal.waitForTimeout(200);
      await portal.dragAndDrop('#op-board .op-card[data-opid="pl-t-1"]', '#op-board .op-day[data-opday="' + other + '"]'); await portal.waitForTimeout(1200);
      let pl = (await fileOf('plans')).docs['pl-t-1'];
      expect(pl.day === other, 'dragging a card onto a day did not move it: ' + pl.day + ' vs ' + other);
      await portal.click('#op-undo'); await portal.waitForTimeout(1200);
      pl = (await fileOf('plans')).docs['pl-t-1'];
      expect(pl.day === T, 'Undo did not put the card back: ' + pl.day);
    }
    /* tick the past-due plan done */
    await portal.click('#op-board .op-card[data-opid="pl-t-late"] input[data-opdone]'); await portal.waitForTimeout(1200);
    expect(((await fileOf('plans')).docs['pl-t-late'] || {}).done === T, 'ticking a card did not mark it done');
    /* a prospect's follow-up marked done, then undone */
    await portal.click('#op-fu-rows .op-card[data-opk="lead"][data-opid="lead-t-1"] input[data-opdone]'); await portal.waitForTimeout(1200);
    let wl = (await fileOf('leads')).docs['lead-t-1'];
    expect(!wl.nextFollowUpDate && wl.lastFollowUp && wl.lastFollowUp.done === T, 'marking a prospect follow-up done did not save: ' + JSON.stringify(wl.lastFollowUp));
    await portal.click('#op-undo'); await portal.waitForTimeout(1200);
    wl = (await fileOf('leads')).docs['lead-t-1'];
    expect(wl.nextFollowUpDate && !wl.lastFollowUp, 'Undo did not reopen the prospect follow-up');
    /* plan someone from Who to Touch */
    expect(await P(portal, () => !document.getElementById('op-whosect').open), 'Who to Touch is not collapsed to start');
    await portal.click('#op-whosect > summary'); await portal.waitForTimeout(200);
    const sel = await P(portal, () => { const s = document.querySelector('#op-lanes select[data-opplan]'); if (!s) return null; const o = [...s.options].find(o => o.value); return o ? {key: s.getAttribute('data-opplan'), v: o.value} : null; });
    expect(sel, 'Who to Touch has nobody to plan');
    if (sel) {
      await portal.selectOption('#op-lanes select[data-opplan="' + sel.key + '"]', sel.v); await portal.waitForTimeout(1200);
      const made = Object.values((await fileOf('plans')).docs).find(p => p.co === sel.key && p.day === sel.v);
      expect(made && made.lane, 'Plan for... did not add a planned touch');
    }
    /* Past Due chip */
    await portal.click('[data-opwhen="due"]'); await portal.waitForTimeout(250);
    const due = await P(portal, () => document.getElementById('op-board').innerText);
    expect(!/Contoso Mortgage/.test(due), 'a done card is still past due');
    await portal.click('[data-opwhen="0"]'); await portal.waitForTimeout(150);
  });
  /* the logo is a file to download on the company card (Jonna, November 20, 2026) */
  await check('the logo the sponsor sent can be downloaded from the company card and the record', async () => {
    await toCos('');
    await P(portal, () => { document.querySelector('#spm-q').value = 'Relecloud'; document.querySelector('#spm-q').dispatchEvent(new Event('input', {bubbles: true})); });
    await portal.waitForTimeout(250);
    await portal.click('#spm-rows .m-row'); await portal.waitForTimeout(500);
    expect(await portal.isVisible('#co-panel [data-logodl="co"]'), 'the company card has no Download Logo button');
    const [dl1] = await Promise.all([portal.waitForEvent('download', { timeout: 8000 }), portal.click('#co-panel [data-logodl="co"]')]);
    expect(dl1.suggestedFilename() === 'MS27-T0008 - Relecloud Tier Test.png', 'the logo downloaded with the wrong name: ' + dl1.suggestedFilename());
    /* Add a Logo keeps a file on the company, and that one is then the download */
    await portal.setInputFiles('#cp-logofile', { name: 'relecloud-new.png', mimeType: 'image/png', buffer: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64') });
    await portal.waitForTimeout(1200);
    const [dl2] = await Promise.all([portal.waitForEvent('download', { timeout: 8000 }), portal.click('#co-panel [data-logodl="co"]')]);
    expect(dl2.suggestedFilename() === 'relecloud-new.png', 'an added logo is not the one downloaded: ' + dl2.suggestedFilename());
    await P(portal, () => { const d = document.getElementById('co-close'); if (d) d.click(); });
    await openRec('app-ms27-t0008'); await portal.waitForTimeout(400);
    const [dl3] = await Promise.all([portal.waitForEvent('download', { timeout: 8000 }), portal.click('#drawer [data-logodl="app"]')]);
    expect(/Relecloud/.test(dl3.suggestedFilename()), 'the application record has no logo download: ' + dl3.suggestedFilename());
    await P(portal, () => document.getElementById('d-close').click());
    await P(portal, () => { const q = document.querySelector('#spm-q'); q.value = ''; q.dispatchEvent(new Event('input', {bubbles: true})); });
  });
  /* November 21, 2026: every record opens in its company's card; new sponsors by any period; prospects by summit */
  await check('a sponsorship opens inside its company card, and Back returns to the card', async () => {
    await P(portal, () => { ['d-close','bd-close','ld-close','co-close'].forEach(id => { const c = document.getElementById(id); if (c) c.click(); }); });
    await portal.click('.tab[data-view="pipeline"]'); await portal.waitForTimeout(300);
    await portal.click('#view-pipeline tr[data-open="app-t-paid"]'); await portal.waitForTimeout(600);
    const st = await P(portal, () => ({dock: document.getElementById('co-panel').classList.contains('docking'), inCard: document.getElementById('drawer').parentNode.id, back: document.getElementById('cp-dockback').textContent}));
    expect(st.dock && st.inCard === 'cp-dock' && /Back to Northwind Lending/.test(st.back), 'the application did not open inside its company card: ' + JSON.stringify(st));
    await portal.click('#cp-dockback'); await portal.waitForTimeout(400);
    const back = await P(portal, () => ({dock: document.getElementById('co-panel').classList.contains('docking'), on: document.getElementById('co-panel').classList.contains('on'), card: document.getElementById('cp-body').innerText.slice(0, 200)}));
    expect(!back.dock && back.on && /Northwind Lending/.test(back.card), 'Back did not return to the company card');
    await P(portal, () => document.getElementById('co-close').click());
  });
  await check('new sponsors can be listed for this month, any month or any dates', async () => {
    await toCos('Sponsor');
    await portal.click('#spm-newp [data-npp="year"]'); await portal.waitForTimeout(250);
    let t = await P(portal, () => document.getElementById('spm-newp').innerText);
    expect(/new sponsorship/i.test(t) && /This Year/.test(t), 'the New Sponsors panel is missing: ' + t.slice(0, 200));
    await portal.click('#spm-newp [data-npp="custom"]'); await portal.waitForTimeout(200);
    await portal.fill('#np-from', '2020-01-01'); await P(portal, () => document.getElementById('np-from').dispatchEvent(new Event('change', {bubbles: true})));
    await portal.fill('#np-to', '2030-12-31'); await P(portal, () => document.getElementById('np-to').dispatchEvent(new Event('change', {bubbles: true})));
    await portal.waitForTimeout(250);
    t = await P(portal, () => document.getElementById('spm-newp').innerText);
    expect(/Northwind Lending/.test(t) && /Contoso Mortgage/.test(t), 'a custom period does not list the sponsors in it: ' + t.slice(0, 300));
    await portal.click('#spm-newp [data-npk="workgroup"]'); await portal.waitForTimeout(200);
    t = await P(portal, () => document.getElementById('spm-newp').innerText);
    expect(!/Northwind Lending/.test(t), 'the Workgroup filter still lists summit sponsors');
    await portal.click('#spm-newp [data-npk=""]'); await portal.click('#spm-newp [data-npp="this"]');
  });
  await check('New Prospects on the Pipeline lists the prospects added in a period', async () => {
    await P(portal, () => { ['d-close','bd-close','ld-close','co-close'].forEach(id => { const c = document.getElementById(id); if (c && c.offsetParent) c.click(); }); });
    await portal.click('.tab[data-view="flow"]'); await portal.waitForTimeout(300);
    expect(await P(portal, () => !!document.querySelector('#view-flow #pl-newp') && !!document.querySelector('#view-flow #flow-band')), 'New Prospects and the prospects band are not on the Pipeline');
    await portal.click('#pl-newp [data-npk=""]'); await portal.waitForTimeout(200);
    await portal.click('#pl-newp [data-npp="custom"]'); await portal.waitForTimeout(200);
    await portal.fill('#pnp-from', '2020-01-01'); await P(portal, () => document.getElementById('pnp-from').dispatchEvent(new Event('change', {bubbles: true})));
    await portal.fill('#pnp-to', '2030-12-31'); await P(portal, () => document.getElementById('pnp-to').dispatchEvent(new Event('change', {bubbles: true})));
    await portal.waitForTimeout(250);
    let t = await P(portal, () => document.getElementById('pl-newp').innerText);
    expect(/New Prospects/.test(t) && /new prospects/i.test(t) && /Wingtip Servicing/.test(t) && /Litware Group/.test(t), 'New Prospects does not list the prospects added: ' + t.slice(0, 300));
    expect(!/Northwind Lending/.test(t), 'New Prospects lists a sponsor whose application made its prospect record: ' + t.slice(0, 300));
    await portal.click('#pl-newp [data-npk="workgroup"]'); await portal.waitForTimeout(200);
    t = await P(portal, () => document.getElementById('pl-newp').innerText);
    expect(/Litware Group/.test(t) && !/Wingtip Servicing/.test(t), 'the Workgroup filter is wrong on New Prospects: ' + t.slice(0, 300));
    const sp = await P(portal, () => document.getElementById('spm-newp').innerText);
    expect(/New Sponsors/.test(sp) && !/Wingtip/.test(sp), 'New Prospects changed the New Sponsors panel');
    await portal.click('#pl-newp [data-npk=""]'); await portal.click('#pl-newp [data-npp="this"]');
  });
  await check('prospects can be narrowed to a summit, and a summit prospect says which summit', async () => {
    await P(portal, () => { ['d-close','bd-close','ld-close','co-close'].forEach(id => { const c = document.getElementById(id); if (c) c.click(); }); });
    await portal.click('.tab[data-view="flow"]'); await portal.waitForTimeout(300);
    await portal.click('[data-ftype="summit"]'); await portal.click('[data-fgroup="prospects"]'); await portal.waitForTimeout(250);
    if (await P(portal, () => document.getElementById('flow-mine').classList.contains('on'))) await portal.click('#flow-mine');
    await portal.selectOption('#flow-owner', ''); await portal.waitForTimeout(200);
    expect(!(await P(portal, () => !!document.querySelector('#flow-body select'))), 'the list still has a picker in a row');
    /* set on the prospect in its company card */
    await portal.click('#flow-body tr[data-fid="lead-t-1"]'); await portal.waitForTimeout(500);
    const cpick = '#co-panel select[data-leadsummit="lead-t-1"]';
    expect(await portal.isVisible(cpick), 'the company card has no Which Summit for the prospect');
    const opt = await P(portal, s => [...document.querySelector(s).options].map(o => o.value).find(v => /Spring/.test(v)), cpick);
    await portal.selectOption(cpick, opt); await portal.waitForTimeout(1200);
    expect(((await fileOf('leads')).docs['lead-t-1'] || {}).summit === opt, 'the summit was not saved on the prospect');
    await P(portal, () => { ['ld-close','co-close'].forEach(id => { const c = document.getElementById(id); if (c && c.offsetParent) c.click(); }); });
    await portal.click('.tab[data-view="flow"]'); await portal.waitForTimeout(300);
    const listed = await P(portal, () => (document.querySelector('#flow-body tr[data-fid="lead-t-1"]') || {}).innerText || '');
    expect(listed.indexOf(opt.replace(/ Summit$/, '')) >= 0, 'the list does not show the summit set on the card: ' + listed);
    await portal.selectOption('#flow-what', opt); await portal.waitForTimeout(250);
    let rows = await P(portal, () => document.getElementById('flow-body').innerText);
    expect(/Wingtip Servicing/.test(rows) && !/Newco Lending Test/.test(rows) && !/Litware Group/.test(rows), 'the summit filter is wrong: ' + rows.slice(0, 300));
    const band = await P(portal, () => document.getElementById('flow-band').innerText);
    expect(/Forecast/i.test(band) && /Prospects by Summit/i.test(band) && /Follow-Ups/i.test(band), 'the prospects band is missing parts: ' + band.slice(0, 200));
    await portal.selectOption('#flow-what', '');
    /* a follow-up bucket narrows the list to those prospects */
    await portal.click('#flow-band [data-ffu="none"]'); await portal.waitForTimeout(250);
    rows = await P(portal, () => [...document.querySelectorAll('#flow-body tr[data-fid]')].map(r => r.getAttribute('data-fid')));
    expect(rows.length && rows.indexOf('lead-t-1') < 0, 'No Follow-Up Set lists a prospect that has one: ' + rows.join(', '));
    await portal.click('#flow-groups [data-ffu=""]'); await portal.waitForTimeout(200);
    /* the old Prospects address opens the Pipeline on its prospects */
    await P(portal, () => { const t = document.querySelector('.tab[data-view="spm"]'); if (t) t.click(); });
    await P(portal, () => { const a = document.createElement('a'); a.className = 'hm-em'; a.setAttribute('data-go', 'plist'); document.body.appendChild(a); a.click(); a.remove(); });
    await portal.waitForTimeout(300);
    expect(await P(portal, () => document.getElementById('view-flow').classList.contains('on')), 'going to Prospects did not open the Pipeline');
    await portal.click('[data-fgroup="open"]');
  });
  await check('Sponsors and Prospects works like Member 360: tabs, filters, outstanding by summit', async () => {
    await toCos('Sponsor');
    let rows = await P(portal, () => document.getElementById('spm-rows').innerText);
    expect(/Northwind Lending/.test(rows) && !/Wingtip Servicing/.test(rows), 'the Current tab is not just sponsors');
    await toCos('');
    rows = await P(portal, () => document.getElementById('spm-rows').innerText);
    expect(!/Wingtip Servicing/.test(rows) && /Northwind Lending/.test(rows), 'the Sponsors page lists prospects (they belong on Prospects)');
    expect(!(await P(portal, () => !!document.querySelector('#spm-life [data-spmlife="Prospect"]'))), 'the Sponsors page still has a Prospect tab');
    /* a summit filter: Winter 2027 sponsors, a 2027 Series one included */
    await toCos('Sponsor'); await portal.selectOption('#spm-what', 'Winter 2027'); await portal.waitForTimeout(200);
    rows = await P(portal, () => document.getElementById('spm-rows').innerText);
    expect(/Northwind Lending/.test(rows) && /Contoso Mortgage/.test(rows), 'the Winter 2027 filter is wrong: ' + rows.slice(0, 200));
    /* outstanding, by summit: Fall 2027 has Coho Lending invoiced from the Registration Desk */
    const band = await P(portal, () => document.getElementById('spm-band').innerText);
    expect(/Outstanding/i.test(band), 'the band does not show what is outstanding');
    await portal.click('[data-spmowe="Fall 2027"]'); await portal.waitForTimeout(250);
    rows = await P(portal, () => document.getElementById('spm-rows').innerText);
    expect(/Coho Lending Test/.test(rows) && /\$7,500/.test(rows) && !/Northwind Lending/.test(rows), 'Fall 2027 outstanding is wrong: ' + rows.slice(0, 300));
    /* the AI Webinar Series' outstanding */
    await portal.click('[data-spmowe="type:ai-webinar"]'); await portal.waitForTimeout(250);
    rows = await P(portal, () => document.getElementById('spm-rows').innerText);
    expect(/Fourth Coffee Test/.test(rows), 'the AI Webinar Series outstanding does not list Fourth Coffee');
    await toCos('Sponsor');
  });
  await check('MISMO Media ticks the LinkedIn post and the Mic\'d Up invitation it has done', async () => {
    const t = await P(portal, () => { document.querySelector('.tab[data-view="benefits"]').click(); return new Promise(r => setTimeout(() => r(document.getElementById('view-benefits').innerText), 600)); });
    const rec = await P(portal, () => document.body.innerText.length);
    await openRec('app-t-paid'); await portal.waitForTimeout(400);
    const dr = await P(portal, () => document.getElementById('drawer').innerText);
    expect(/posted on LinkedIn[^)]*MISMO Media/.test(dr), 'the LinkedIn post MISMO Media recorded is not ticked on Northwind: ' + (dr.match(/LinkedIn[^\n]*\n[^\n]*\n[^\n]*/) || [''])[0]);
    expect(/invited to Mic.d Up[^)]*MISMO Media/.test(dr), 'the Mic\'d Up invitation MISMO Media recorded is not ticked');
    await P(portal, () => { ['d-close','co-close'].forEach(id => { const c = document.getElementById(id); if (c) c.click(); }); });
  });
  await check('searching a company opens its company card, once per company, even by its contact', async () => {
    const find = async (q) => {
      await P(portal, (q) => { const b = document.getElementById('nav-search'); b.value = q; b.dispatchEvent(new Event('input', {bubbles:true})); }, q);
      await portal.waitForTimeout(400);
      return P(portal, () => [...document.querySelectorAll('#nav-hits .rh')].map(b => b.querySelector('b').textContent + ' | ' + ((b.querySelector('i') || {}).textContent || '')));
    };
    const nw = await find('northwind');
    expect(nw.filter(h => /^Northwind Lending/.test(h)).length === 1, 'Northwind is not listed exactly once: ' + JSON.stringify(nw));
    const byContact = await find('avery test');
    expect(byContact.some(h => /^Northwind Lending .*contact Avery Test/.test(h)), 'searching the contact does not find the company: ' + JSON.stringify(byContact));
    await P(portal, () => document.querySelector('#nav-hits .rh').click()); await portal.waitForTimeout(500);
    const st = await P(portal, () => ({panel:document.getElementById('co-panel').classList.contains('on'),
      name:(document.querySelector('#cp-body .cp-band') || {}).innerText || '',
      docked:!!document.querySelector('#co-panel .drawer.docked'),
      drawer:['drawer','lead-drawer','bill-drawer'].some(id => document.getElementById(id).classList.contains('on'))}));
    expect(st.panel && /Northwind Lending/.test(st.name), 'the company card did not open: ' + JSON.stringify(st).slice(0, 200));
    expect(!st.docked && !st.drawer, 'a sponsorship record opened instead of just the company card');
    await P(portal, () => { const b = document.getElementById('nav-search'); b.value = ''; b.dispatchEvent(new Event('input', {bubbles:true})); document.getElementById('co-close').click(); });
  });
  /* 'a summit prospect can be tied to a summit' (the retired Summit-first page) is covered by the Prospects check above (November 21, 2026) */
  await check('a company record shows its emails and sponsorships, and takes a note and an owner', async () => {
    await toCos('Sponsor');
    await portal.click('#spm-rows [data-spco="northwindlending"]'); await portal.waitForTimeout(500);
    const band = await P(portal, () => document.querySelector('#cp-body .cp-band').innerText);
    expect(/Northwind Lending/.test(band) && /\$15,000/.test(band), 'the company band is wrong: ' + band.slice(0, 200));
    await portal.click('[data-cotab="activity"]');
    const act = await P(portal, () => document.querySelector('#cp-body .cp-panel').innerText);
    expect(/Badge artwork/.test(act), 'the email to mismosponsor@ is not in the company\'s activity');
    /* Log a Touchpoint: a call about the summit, with a follow-up date (Northwind has no open prospect, so it stays on the touchpoint) */
    await portal.click('[data-conote]');
    await portal.selectOption('#cp-tptype', 'Call'); await portal.selectOption('#cp-tpabout', 'summit');
    await portal.fill('#cp-note', 'Called about Spring, automated check');
    await portal.fill('#cp-tpnext', 'Send the Spring options'); await portal.fill('#cp-tpdue', await P(portal, () => { const d = new Date(); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); }));
    await portal.click('[data-conotesave]'); await portal.waitForTimeout(1500);
    const notes = Object.entries((await fileOf('touchpoints')).docs).map(([id, t]) => Object.assign({id}, t)).filter(t => t.co === 'northwindlending' && t.type === 'Call');
    const tp = notes.find(t => /automated check/.test(t.summary));
    expect(tp && tp.about === 'summit' && tp.next && tp.next.text === 'Send the Spring options', 'the touchpoint was not saved with what it is about and its follow-up');
    await portal.click('[data-cotab="overview"]');
    const ov = await P(portal, () => document.querySelector('#cp-body .cp-panel').innerText);
    expect(/Follow-Ups/i.test(ov) && /Send the Spring options/.test(ov), 'the follow-up is not on the company');
    await P(portal, () => document.getElementById('co-close').click());
    await toFlow(); await portal.click('[data-fdrill="due"]'); await portal.waitForTimeout(250);
    const due = await P(portal, () => document.getElementById('flow-drill').innerText);
    expect(/Northwind Lending/.test(due), 'the follow-up is not in Follow-Ups Due on the Pipeline');
    await portal.click('#flow-drill [data-fdrill=""]');
    await toCos('Sponsor'); await portal.click('#spm-rows [data-spco="northwindlending"]'); await portal.waitForTimeout(400);
    await portal.click('[data-cotab="overview"]');
    await portal.click('#cp-body [data-tpdone="' + tp.id + '"]'); await portal.waitForTimeout(1200);
    const after = (await fileOf('touchpoints')).docs[tp.id];
    expect(after && after.next && after.next.done, 'Done did not clear the follow-up');
    await portal.selectOption('[data-coowner="northwindlending"]', 'Kelly Bradshaw'); await portal.waitForTimeout(1500);
    const co = ((await fileOf('companies')) || {docs:{}}).docs.northwindlending || {};
    expect(co.owner === 'Kelly Bradshaw', 'the company owner was not saved');
    await P(portal, () => document.getElementById('co-close').click());
  });

  await check('Home\'s Forwarded Emails tile lists only the emails that still need a company, and opens them', async () => {
    await P(portal, () => { ['d-close','bd-close','ld-close','co-close'].forEach(id => { const c = document.getElementById(id); if (c && c.offsetParent) c.click(); }); });
    await portal.click('.tab[data-view="home"]'); await portal.waitForTimeout(400);
    const tile = await P(portal, () => (document.querySelector('#home-grid .hm-fwd') || {}).innerText || '');
    const need = await P(portal, () => Object.values(window.__practice.file('mailin').docs).filter(d => d.st === 'need').length);
    expect(/Forwarded Emails/i.test(tile) && new RegExp('\\b' + need + '\\s+needs? a company').test(tile), 'the tile does not count the emails needing a company (' + need + '): ' + tile.replace(/\n/g, ' | '));
    expect(!/logged this week/i.test(tile), 'the tile still counts emails logged this week');
    if (need) expect(/Pick a company/i.test(tile) && /Question/.test(tile), 'the email needing a company is not on the tile: ' + tile);
    await portal.click('#home-grid .hm-fwd'); await portal.waitForTimeout(600);
    const on = await P(portal, () => ({view: document.querySelector('#view-todo.on') ? 'todo' : '', tab: (document.querySelector('#aw-tabs .aw-tab.on') || {}).getAttribute ? document.querySelector('#aw-tabs .aw-tab.on').getAttribute('data-awt') : ''}));
    expect(on.view === 'todo' && on.tab === 'mail', 'the tile did not open the emails to pick: ' + JSON.stringify(on));
  });
  await check('Activity lists what the team did, with Member 360\'s boxes, band and filters', async () => {
    await portal.click('.tab[data-view="activity"]'); await portal.waitForTimeout(1200);
    const v = await P(portal, () => ({tiles: document.getElementById('act-tiles').innerText, band: document.getElementById('act-band').innerText, list: document.getElementById('act-list').innerText}));
    expect(/Changes Saved/.test(v.tiles) && /Touchpoints/.test(v.tiles) && /Forwarded Emails/.test(v.tiles) && /People Active/.test(v.tiles), 'the Activity boxes are missing: ' + v.tiles.slice(0, 200));
    expect(/Last 14 Days/i.test(v.band) && /Who Did What/i.test(v.band) && /Kind of Work/i.test(v.band), 'the Activity band is missing parts');
    expect(/You\s+logged a call/.test(v.list) && /Northwind Lending/.test(v.list), 'the touchpoint logged in these checks is not on Activity: ' + v.list.slice(0, 300));
    expect(!/^(Sponsorship Portal|Online prospectus|system)\b/m.test(v.list.replace(/^\d+:\d+ [AP]M\s*/gm, '')), 'Activity lists things the portal did on its own');
    await portal.click('#act-tiles [data-actk="tp"]'); await portal.waitForTimeout(300);
    const tp = await P(portal, () => ({what: document.getElementById('act-what').value, list: document.getElementById('act-list').innerText}));
    expect(tp.what === 'tp' && /logged a call/.test(tp.list) && !/queued to email/.test(tp.list), 'the Touchpoints box did not filter the list');
    await portal.selectOption('#act-what', '');
  });
  await check('System Health checks the feeds, the email flow, saves and the rule checks, and keeps the result', async () => {
    expect(await P(portal, () => !document.getElementById('tab-health').hidden), 'System Health is not in the menu for an admin');
    await portal.click('.tab[data-view="health"]'); await portal.waitForTimeout(300);
    await portal.click('#hl-now'); await portal.waitForFunction(() => !document.getElementById('hl-now').disabled, null, {timeout: 20000});
    const v = await P(portal, () => ({feeds: document.getElementById('hl-feeds').innerText, email: document.getElementById('hl-email').innerText, saves: document.getElementById('hl-saves').innerText, checks: document.getElementById('hl-checks').innerText, rules: document.getElementById('hl-rules').innerText}));
    expect(/MISMO Money Payments/.test(v.feeds) && /Prospectus Applications/.test(v.feeds) && /mismosponsor@ Mailbox/.test(v.feeds) && /Registration Desk/.test(v.feeds) && /MISMO Media Benefits/.test(v.feeds) && /Member 360 Sponsorship List/.test(v.feeds), 'a feed is missing from System Health: ' + v.feeds.slice(0, 300));
    expect(/Team Emails Flow/.test(v.email) && /Failed Emails/.test(v.email), 'the email checks are missing');
    expect(/Failed Saves/.test(v.saves) && /[1-9][0-9]* failed saves?/.test(v.saves), 'the failed save from these checks is not on System Health: ' + v.saves.slice(0, 200));
    expect(/Rule Checks/.test(v.rules) && /All \d+ pass/.test(v.rules), 'a rule check is failing: ' + v.rules.slice(0, 600));
    expect(/Background Work/.test(v.checks) && /This Page/.test(v.checks), 'the robot or the version is missing from Checks');
    const main = (((await fileOf('health')) || {docs: {}}).docs || {}).main;
    expect(main && main.checkedAt && main.checkedBy, 'the shared check was not kept in data/health.json');
  });
  await check('payment reminders start only from the record, with the invoice attached, and can be stopped', async () => {
    let ob = ((await fileOf('outbox')) || {docs: {}}).docs || {};
    expect(!Object.keys(ob).some(id => /^(bpd|wgpd)-/.test(id)), 'a payment reminder went out before anyone pressed Start');
    await openRec('wg-t-late');
    let sect = await P(portal, () => document.getElementById('bill-drawer').innerText);
    expect(/Payment Follow-Ups/i.test(sect) && /Add the invoice PDF first/.test(sect), 'the record does not ask for the invoice PDF first: ' + (sect.match(/Payment Follow-Ups[\s\S]{0,300}/i) || [''])[0]);
    expect(await P(portal, () => { const b = document.querySelector('#bill-drawer [data-wgchase="on"]'); return !!b && b.disabled; }), 'Start is not held back until there is an invoice PDF');
    const pdf = Buffer.from('%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF\n');
    await portal.setInputFiles('#bill-drawer input[data-invpdf]', {name: 'Invoice 7000123.pdf', mimeType: 'application/pdf', buffer: pdf});
    await portal.waitForTimeout(1500);
    const inv = await fileOf('invoice-wg-t-late');
    expect(inv && inv.name === 'Invoice 7000123.pdf' && inv.data, 'the invoice PDF was not kept');
    await portal.click('#bill-drawer [data-wgchase="on"]'); await portal.waitForTimeout(3500);
    ob = ((await fileOf('outbox')) || {docs: {}}).docs || {};
    const mine = Object.entries(ob).filter(([id]) => /^bpd-/.test(id));
    expect(mine.length === 1 && mine[0][0] === 'bpd-wg-t-late-1', 'expected one reminder after Start: ' + JSON.stringify(mine.map(x => x[0])));
    const o = mine.length ? mine[0][1] : {};
    expect(o.to === 'jamie@alpine-ski.test' && /jcritchley@mismo\.org/.test(o.cc) && /amoses/.test(o.cc) && /kbradshaw/.test(o.cc), 'the reminder is not to the contact with Jonna, Amy and Kelly copied: ' + o.to + ' / ' + o.cc);
    expect(/Friendly Reminder/.test(o.subject) && /7000123/.test(o.subject), 'the subject is wrong: ' + o.subject);
    expect(o.fromBox === 'mismosponsor@mismo.org', 'the reminder is not sent from mismosponsor@: ' + o.fromBox);
    expect(/friendly reminder/.test(o.bodyText) && /attached the invoice/.test(o.bodyText) && /\$6,000/.test(o.bodyText) && /<br>/.test(o.bodyHtml), 'the message is not the friendly reminder with the invoice');
    expect((o.attachments && o.attachments[0] && o.attachments[0].Name === 'Invoice 7000123.pdf' && o.attachments[0].ContentBytes) || o.attachmentsSent, 'the invoice is not attached');
    const r = ((await fileOf('workgroups')).docs || {})['wg-t-late'] || {};
    expect(r.chaseOn === true && r.chaseBy && r.followUpCount === 1 && (r.followUps || []).length === 1, 'Start and the reminder are not recorded on the sponsorship');
    sect = await P(portal, () => document.getElementById('bill-drawer').innerText);
    expect(/Follow-ups are on/.test(sect) && /Reminder 1 emailed to jamie@alpine-ski\.test/.test(sect) && /Next one:/.test(sect), 'the record does not show the reminders: ' + (sect.match(/Payment Follow-Ups[\s\S]{0,400}/i) || [''])[0]);
    expect(await P(portal, () => [...document.querySelectorAll('#bill-drawer label')].some(l => /Billing Contact Email/i.test(l.textContent))), 'there is no Billing Contact Email on the record');
    await portal.click('#bill-drawer [data-wgchase="off"]'); await portal.waitForTimeout(1200);
    expect(((((await fileOf('workgroups')).docs || {})['wg-t-late']) || {}).chaseOn === false, 'Stop Follow-Ups was not saved');
    await P(portal, () => { ['bd-close','co-close'].forEach(id => { const c = document.getElementById(id); if (c && c.offsetParent) c.click(); }); });
    const after = Object.keys(((await fileOf('outbox')) || {docs: {}}).docs || {}).filter(id => /^bpd-/.test(id));
    expect(after.length === 1, 'a second reminder went out before 10 business days: ' + after.join(', '));
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
        /* once submitted, the page's PDF carries what was signed (Guidehouse's PDF had no signature, November 23, 2026) */
        await page.emulateMedia({ media: 'print' });
        const signed = await P(page, () => { const b = document.getElementById('signed-print');
          return { shown: !!b && getComputedStyle(b).display !== 'none', txt: b ? b.innerText : '', btn: !!document.getElementById('signed-pdf-btn') }; });
        await page.emulateMedia({ media: 'screen' });
        expect(signed.shown && /Pat Check/.test(signed.txt) && /VP/.test(signed.txt) && /2027-v1/.test(signed.txt), 'the PDF after submitting has no signature: "' + signed.txt.slice(0, 120) + '"');
        expect(signed.btn, 'the confirmation has no Save a Signed Copy (PDF) button');
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

      const pdf = await open(pg.url + '?practice', { wait: 1200 });
      await check(pg.name + ': Download PDF leaves out the form and says where to apply', async () => {
        expect(await pdf.isVisible('#pdf-btn'), 'there is no Download PDF button');
        await pdf.evaluate(() => window.dispatchEvent(new Event('beforeprint')));
        await pdf.emulateMedia({ media: 'print' });
        const st = await P(pdf, () => ({
          reserve: getComputedStyle(document.getElementById('reserve')).display,
          agree: getComputedStyle(document.querySelector('.agree-block')).display,
          note: document.getElementById('print-note').innerText,
          noteShown: getComputedStyle(document.getElementById('print-note')).display }));
        expect(st.reserve === 'none' && st.agree === 'none', 'the application form or signing would be in the PDF');
        expect(st.noteShown !== 'none' && /apply online at/.test(st.note) && /20\d\d/.test(st.note), 'the PDF does not say the date and where to apply: ' + st.note);
        const bytes = (await pdf.pdf({ preferCSSPageSize: true, printBackground: true })).length;
        expect(bytes > 50000, 'the PDF came out empty');
      });
      await pdf.ctx.close();

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
