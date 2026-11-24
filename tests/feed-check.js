/* Checks of the Member 360 list (tools/member360-feed.js, CN-016), on the made-up records in
   fixtures/feed/. No browser needed:  node feed-check.js
   checks.js runs these too, so GitHub runs them after every change. */
'use strict';
const fs = require('fs'), os = require('os'), path = require('path');
const F = require('../tools/member360-feed');
const FIX = path.join(__dirname, 'fixtures', 'feed');
const NOW = new Date('2026-11-20T12:00:00Z');

/* a constant from index.html, read as the page itself would */
function pageConst(src, name) {
  const m = new RegExp('var ' + name + ' = ([\\[{][\\s\\S]*?[\\]}]);').exec(src);
  if (!m) throw new Error('index.html has no var ' + name + ' any more');
  return new Function('return ' + m[1])();
}

async function run(check, expect) {
  const src = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
  await check('Member 360 list: its copy of the company rules still matches the portal', async () => {
    for (const k of ['CO_NOISE', 'LEAD_LEGACY', 'LEAD_CLOSED', 'PIPE_STAGES', 'OTHER_TYPES_BASE']) {
      const a = JSON.stringify(pageConst(src, k)), b = JSON.stringify(F.CONSTANTS[k]);
      expect(a === b, k + ' differs between index.html and tools/member360-feed.js; copy it across');
    }
    const fn = /function companyKey\(s\)\{([\s\S]*?)\n  \}/.exec(src);
    expect(fn && /replace\(\/&\/g, " and "\)\.split\(\/\[\^a-z0-9\]\+\/\)/.test(fn[1]), 'companyKey in index.html changed; change it in tools/member360-feed.js too');
  });

  const feed = F.buildFromFolder(FIX, NOW);
  const by = n => feed.companies.find(c => c.name === n);
  await check('Member 360 list: the shape Member 360 reads, for every company', async () => {
    expect(feed.updated === NOW.toISOString() && Array.isArray(feed.companies) && feed.count === feed.companies.length, 'updated, count or companies is wrong');
    for (const c of feed.companies) {
      for (const k of ['cid', 'name', 'prospect', 'sponsorships', 'lastEvent']) expect(k in c, c.name + ' has no ' + k);
      for (const k of ['stage', 'owner', 'lastTouch', 'nextStep']) expect(k in c.prospect, c.name + ' prospect has no ' + k);
      for (const s of c.sponsorships) for (const k of ['event', 'package', 'amount', 'status', 'invoiceSent', 'paid']) expect(k in s, c.name + ' sponsorship has no ' + k);
      expect('date' in c.lastEvent && 'what' in c.lastEvent, c.name + ' lastEvent is incomplete');
      expect(!/@/.test(JSON.stringify(c)), c.name + ' carries an email address');
    }
  });
  await check('Member 360 list: every company once, prospects and touchpoint-only companies included', async () => {
    const names = feed.companies.map(c => c.name);
    expect(JSON.stringify(names) === JSON.stringify(['Acme Lending, Inc.', 'Bluebird Title', 'Cobalt Mortgage LLC', 'Dune Data', 'Evergreen Servicing']), 'got ' + names.join(', '));
  });
  await check('Member 360 list: sponsorships, Aptify Company ID and amounts', async () => {
    const a = by('Acme Lending, Inc.');
    expect(a.cid === '111111', 'Acme should get the workgroup record\'s Aptify ID, got ' + a.cid);
    expect(a.sponsorships.length === 2, 'Acme should have its summit and workgroup sponsorships');
    const s = a.sponsorships.find(x => x.event === 'Winter 2027');
    expect(s && s.package === 'Gold Workshop Sponsor' && s.amount === 15000 && s.status === 'Pending Payment' && s.invoiceSent === '2026-10-05' && s.paid === '', 'Acme Winter 2027 is wrong: ' + JSON.stringify(s));
    expect(a.prospect.stage === '' && a.prospect.open === false && a.prospect.owner === 'Sam Owner', 'a converted prospect is not an open one, but keeps its owner');
    const b = by('Bluebird Title');
    expect(b.cid === '222222', 'Bluebird should get its ID through MISMO Money\'s paid order, got ' + b.cid);
    const f = b.sponsorships.find(x => x.event === 'Fall 2026');
    expect(f.package === 'Silver Coffee Break Sponsor — Tuesday' && f.paid === '2026-07-01', 'Bluebird Fall 2026 is wrong: ' + JSON.stringify(f));
    expect(b.sponsorships.some(x => x.event === 'AI Webinar Series' && x.package === 'An Example Webinar'), 'the other sponsorship is missing');
    expect(b.lastEvent.date === '2026-11-01', 'an archived touchpoint should not count: ' + JSON.stringify(b.lastEvent));
  });
  await check('Member 360 list: prospect stage, owner, last touch, next step and last event', async () => {
    const c = by('Cobalt Mortgage LLC');
    expect(c.cid === '' && c.sponsorships.length === 0, 'Cobalt has no ID and no sponsorship');
    expect(c.prospect.stage === 'Proposal', 'an old stage name is read as the new one, got ' + c.prospect.stage);
    expect(c.prospect.owner === 'Robin Owner' && c.prospect.nextStep === 'Send the Spring prospectus' && c.prospect.nextDate === '2027-01-05', 'Cobalt prospect is wrong: ' + JSON.stringify(c.prospect));
    expect(c.prospect.lastTouch === '2026-11-14', 'last touch should be the newest touchpoint, got ' + c.prospect.lastTouch);
    expect(c.lastEvent.date === '2026-11-14' && /^Call: /.test(c.lastEvent.what), 'a future date must not be the last event: ' + JSON.stringify(c.lastEvent));
    expect(by('Dune Data').prospect.stage === '', 'a lost prospect is not open');
    const e = by('Evergreen Servicing');
    expect(e.prospect.nextStep === 'Call back in December' && e.lastEvent.what === 'Email: Hello from MISMO', 'a touchpoint\'s next step should show: ' + JSON.stringify(e));
  });
  await check('Member 360 list: written when something changed or daily, otherwise left alone', async () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'feed-'));
    fs.mkdirSync(path.join(tmp, 'data'));
    for (const f of fs.readdirSync(path.join(FIX, 'data'))) fs.copyFileSync(path.join(FIX, 'data', f), path.join(tmp, 'data', f));
    const r1 = F.writeFeed(tmp, NOW);
    const r2 = F.writeFeed(tmp, new Date(NOW.getTime() + 3600e3));
    const r3 = F.writeFeed(tmp, new Date(NOW.getTime() + 21 * 3600e3));
    const leads = JSON.parse(fs.readFileSync(path.join(tmp, 'data', 'leads.json')));
    leads.docs['lead-pt00003'].status = 'Contacted';
    fs.writeFileSync(path.join(tmp, 'data', 'leads.json'), JSON.stringify(leads));
    const r4 = F.writeFeed(tmp, new Date(NOW.getTime() + 22 * 3600e3));
    const out = JSON.parse(fs.readFileSync(path.join(tmp, 'data', 'feed-member360.json')));
    fs.rmSync(tmp, { recursive: true, force: true });
    expect(r1.wrote && !r2.wrote && r3.wrote && r4.wrote, 'wrote: ' + [r1, r2, r3, r4].map(r => r.wrote).join(', '));
    expect(out.companies.find(c => c.name === 'Dune Data').prospect.stage === 'Contacted', 'the change did not reach the file');
  });
}
module.exports = { run };

if (require.main === module) {
  let bad = 0;
  const check = async (name, fn) => { try { await fn(); console.log('  ✓ ' + name); } catch (e) { bad++; console.log('  ✗ ' + name + '\n      ' + (e && e.message || e)); } };
  const expect = (c, m) => { if (!c) throw new Error(m); };
  run(check, expect).then(() => process.exit(bad ? 1 : 0));
}
