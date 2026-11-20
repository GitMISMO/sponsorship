# sponsorship

MISMO Sponsorship Portal, at resources.mismo.org/sponsorship/. Its records live in the private
sponsorship-data repo and are reached only through MISMO's save relay (project key "sponsorship").
The public prospectuses that feed it are in the Sponsorship-Prospectus repo.

| File | What it is |
| --- | --- |
| `index.html` | The portal. |
| `practice.js` | The practice copy. Without `?practice` in the address it does nothing. |
| `practice-data.json` | Made-up test data for the practice copy and the checks. Every company and person in it is fictional. |
| `tests/checks.js` | Automated checks of the portal and all the prospectuses. |
| `tests/fixtures/` | Made-up copies of other systems' files the checks read (the website's sponsor list). |
| `tests/apply-catalog.js` | Carries the price list onto every page (see below). |
| `.github/workflows/checks.yml` | Runs the checks on GitHub after every change and every Monday. |
| `tests/background.js` | Opens the portal every hour, so its background work happens without anyone opening it (see below). |

## The price list

`Sponsorship-Prospectus/catalog.json` is the one place tiers, prices, registrations, slot counts
and days are set. The portal reads it when it opens and uses it for Inventory and for the price
check: every application from a prospectus is charged the price list's price, whatever the page
sent, and anything that doesn't fit (a wrong price, an opportunity sold at the wrong tier) is
flagged on the record until it is approved.

To change a price or a slot count: edit `catalog.json`, run `node tests/apply-catalog.js` to carry
it onto the prospectus template, the pages and the portal, run `python3 tools/build.py` in the
Sponsorship-Prospectus repo, run the checks, and publish every changed file.

New prospectuses are made from one template; see the Sponsorship-Prospectus README.
The checks fail if any page disagrees with the price list.

## The Sponsorship Requests list

The portal is the one true record; the SharePoint list is a copy the Team Emails flow keeps so
the prospectuses can count sold slots. Every time the portal opens (the robot opens it hourly) it
reads the list through the Availability flow and compares it with the records. A record the list
has wrong or missing is sent to it again (at most once a day each), and a sold slot the list holds
that no record accounts for is shown on Inventory to be cleared in SharePoint.

## To Do and Sponsors & Prospects (November 19, 2026)

From Amy's feedback ("easy to see who is a sponsor for what and who is a prospect for what", summit first, and
what needs to be done as the first thing seen). **To Do** (`view-todo`, `renderTodo`) is the default view: follow-ups
due (open prospects' `nextFollowUpDate` and `touchFollowUps`), applications to review, payments past due, coming up
this week, prospects with no follow-up date, waiting on an invoice, and the moved mismosponsor@ and New Prospects
boxes; My Work / Everyone is kept in `sponsorship:todo`. **Sponsors & Prospects** (`view-spx`, `renderSpx`): one
button per upcoming summit (`spxUpcoming`), Workgroups and each other type; sponsors are applications whose
`sharesOf` include that summit (or active workgroup/other records), prospects are open leads of that kind; a summit
lead carries `summit` (a summit key or "<year> Series"), and leads without one are listed under each summit of their
season with a picker (`data-leadsummit`). The old Home is **At a Glance** and the Pipeline sit under Records; the
Sponsors and Prospects list views (`companies`, `plist`) stay in the page, unlinked.

## Companies (November 18, 2026)

It's about the company, not the sponsorship, the way Member 360 works. A company is every record
with the same `companyKey` (prospects, summit applications, workgroup and other sponsorships, and the
emails and notes in `data/touchpoints.json`), put together each time by `companies()`; nothing is
stored twice. The only company-level data is `data/companies.json` (`companies/<key>.owner`).
**Home** (the first tab) is the day and the season at a glance; **Sponsors** lists every sponsoring,
applied or past-sponsor company once (`SPONSOR_RELS`); **Prospects** (`view-plist`, `renderProspectList`,
since Nov 19, 2026 at Amy's request) lists every prospect, one row each, with type buttons, My Prospects /
Everyone and Open / Hold / Lost kept in this browser (`sponsorship:plist`); the
**company record** (`openCompany`) has its band, journey, open opportunities with a stage bar, all its
sponsorships, one Activity timeline, contacts and money. Pipeline rows open the company; a company's
own buttons open the record itself (`data-direct`). Every number in the Pipeline headline and each stage box has `data-fdrill` (open, worth, due, late, new, newweek, duenow, `stage:<name>`); selecting one fills `#flow-drill` under the headline from `drillOf()`. Log a Touchpoint saves to `touchpoints.json` with
`type` (Call, Email, Meeting, Event Conversation, Note, Other), `about` (`summit`, `workgroup`, an
Other Sponsorship type key, or empty for General), `contact`, `summary`, and an optional
`next: {text, due, onLead, done, doneBy}`. When the company has an open prospect of that kind, its
Next Step, follow-up date and last contact date are set on the prospect too (`onLead`), so the
follow-up isn't counted twice; otherwise the touchpoint's own follow-up shows on Home, under Due Now
on the Pipeline and in the company's Follow-Ups until marked Done. Emails get the same About picker. The look follows Member 360's (navy gradient tiles, squared tags).

## The Pipeline (November 18, 2026)

One list of every sponsorship, from first contact to paid, the way Member 360 works its prospects:
summit sponsorships, workgroup sponsorships and every Other Sponsorship type, prospects included.
Nothing is stored twice; each row is read from the record it lives in and shown on one scale
(`PIPE_STAGES`): Lead, Contacted, Meeting Scheduled, Proposal, Verbal Commitment (a prospect's
stages, in `leads.json`), then Application In, Approved, Pending Payment and Paid (the summit
application, workgroup or other sponsorship's own status, through `APP_TO_PIPE` and `BILL_TO_PIPE`),
plus Hold and Lost. Older prospect stage names are read as the new ones (`LEAD_LEGACY`).

A prospect has a type (`stype`: summit, workgroup or an Other type key), and a workgroup prospect
names its group. **Start the Sponsorship** on a workgroup or other prospect opens the new record
filled in (`fromLead`); saving it marks the prospect Converted to Sponsorship (`linkedBillNo`).
The old Prospects tab is folded into the Pipeline (its view and code are still there, with no tab).
So are Summit Sponsorships (`view-pipeline`, the summit board), Workgroups (`view-workgroup`) and
Other Sponsorships (`view-other`), since November 18, 2026: no tabs, views and code kept so the
record panels work as before. In their place on the Pipeline: the type buttons, **All**
(`pipeItems(true)`: every record however old, archived included), **New Sponsorship…**
(`#flow-newkind`: summit application, workgroup, any other type, or a new type into `#otype-form`),
and **waiting on a next step** (`todo`: an application's first `tasksFor` task, or a draft
workgroup or other sponsorship), which joins Due Now and the Pipeline's menu count.

## Other Sponsorships and types

Any sponsorship that isn't a summit or a workgroup is an Other Sponsorship (`data/others.json`),
with its type on each record (`otype`). Types are `OTHER_TYPES_BASE` (the AI Webinar Series, split
50/50 with MBA) plus the ones added with **New Sponsorship… → A New Sponsorship Type** on the Pipeline, kept in `data/settings.json`
(`settings/main.otherTypes`): name, what each one is called, MISMO's share, and for a partner
series who gets the past-due notice. The AI webinar records were copied into `others.json` under the
same ids and numbers the first time an editor opened the portal; `data/webinars.json` is kept as it
was.

## The mismosponsor@ mailbox

Forward, Cc or Bcc an email to mismosponsor@mismo.org and it is logged on the sponsor or prospect it
is about, the way 360@ works for Member 360. The Power Automate flow **Sponsorship - mismosponsor
Mailbox** (Jonna's account) adds each email to `data/mailin.json` as `{docs:{<id>:{from, to, cc,
subject, received, html, mid, at, src}}}`. Any screen that can save (and the robot, hourly) takes
each new one (`db.claim`, so two screens never take the same email), finds the company by a known
contact email, then by email domain, and:

- one company: writes the email to `data/touchpoints.json` (`co` = `companyKey`, subject, from,
  a short summary, who forwarded it) and its whole text to `data/mailtext-YYYY-MM.json`
- several: marks it `need`, listed on the Pipeline under Emails to mismosponsor@ to pick one
- none, and a real company address: makes a prospect (`source: "Email to mismosponsor@"`), logs
  the email there, and lists it with Looks Right

The email's HTML is blanked once it is read, and a logged entry is trimmed from `mailin.json` after
60 days (its email stays on the timeline), so the file stays small. A first line `sponsor: Name` or
`[sponsor: Name]` in the subject picks the company. Free mail, automated senders and tools never
make a prospect. Every record's panel shows its company's Emails.

## Sponsor benefits

Every sponsor that is Approved, Pending Payment, Paid, In Kind or Written Off gets a checklist
for each of its summits, from its tier: registrations (comp code), logo, the LinkedIn post,
attendee lists, the opportunity itself, and the tier's extras (chair drop, giveaway, Mic'd Up,
main-stage recognition). Each item has an owner and a due date counted from the summit's opening
day (`BENEFIT_TASKS` in index.html). The Benefits page lists them by summit and owner; each record
shows its own. Ticks are saved as one field per item (`bf:<summit>:<item>`), so two people never
overwrite each other. Items another system already does tick themselves:

- **Registrations:** from the comp code on the record.
- **Agenda:** never a to-do; approved sponsors go onto the website's agenda automatically (the
  Summit Sponsor Feed). Where Summit HQ has the sponsor marked on the agenda (read only: the person
  record on People for that summit's venue, or the sponsor card's Mark on Agenda), it says so. The
  venue for each summit is `hq` in `SUMMITS`.
- **Weekly registration list:** never a to-do; the "Registration List to Sponsors" flow sends it
  every Monday from seven weeks out.
- **Logo:** see below.

The Benefits page's To Do holds only what is late or due in the next 45 days (`BENEFIT_WINDOW`);
the rest is folded under Coming Later. Rosalyn works from Summit HQ only, so she is not an owner here.

The logo is not a task: the site's Summit Sponsor Feed (GitMISMO.github.io,
`sponsors/build-sponsors.mjs`) puts every approved sponsor on the website within the hour, with its
logo. The portal reads the feed's published list (`/sponsors/<summit>-2027.json`) and ticks the logo
from it. The only time it shows as a to-do is when the website lists a sponsor with its name but
no logo file; then the file is saved once in the site repo as `sponsors/logos/<company-name>.png`.
The checks use a made-up copy of that list in `tests/fixtures/sponsors/`.

## Activity history

`data/log.json` keeps the latest 300 entries; every entry is also kept for good in that month's
file, `data/log-YYYY-MM.json`, which nothing trims. Each record's History shows its entries, and
Show Full History reads the monthly files back to the month it was submitted.

## Likely spam

The Intake flow's address is in the public page, so anything can post to it. An application
that looks automated (the prospectus's hidden spam box filled in, sent within five seconds of
the page opening, no company or valid email, a web address in a name, the contract not agreed,
or a fourth application from one email in a day) is not made into a record. It is listed at the
top of the Pipeline with why it was held, for someone to **Take It In** or mark **Not a Sponsor**.
Nothing is deleted.

## The Registration Desk (Summit HQ, November 19, 2026)

Bernie works summit sponsorships from his Registration Desk in Summit HQ
(resources.mismo.org/summit-hq/?desk) and doesn't open the portal. The Desk reads
`data/applications.json` with the viewer's own sign-in (so Bernie, Amy and Kelly need view access to
the portal) and never writes to sponsorship-data. What he enters is kept in Summit HQ's data, in
`feed-desk-sponsor` (`{updatedAt, entries:{<application id>:{appNo, invoiceNumber, invoiceDate,
compCode, numComps, codeSentAt, codeSentTo, codeSentBy, followUps:[{on,by,at}], paymentReceivedDate,
amountPaid, by, at}}}`).
`applyDesk()` reads it (`/summit-hq/data/feed-desk-sponsor`, read only) and applies it: matched on
the id, then `appNo`; a missing field leaves the record alone; the order ID goes through
`applyRules` (Approved → Pending Payment); `codeSentAt` ticks `bf:<summit>:comps`; each follow-up not
seen before (its `at`, kept in `deskChases`) adds one to `followUpCount` and sets `lastFollowUpDate`
to the latest `on`; `paymentReceivedDate` (and `amountPaid` if given), for a payment MISMO Money never
sees (an MBA ACH payment, a credit memo), marks the record Paid the same as entering Payment Received
here, with the usual Payment Made email, and never touches a record already Paid. An entry is applied only when its newest `at` is later than `deskAppliedAt` on the
record, so it never overwrites a later edit made here. The history line starts "From the
Registration Desk". It runs whenever someone who can edit has the portal open (the feed is read
again every five minutes) and in the hourly background work, which reads the feed from
GitMISMO/summit-hq-data with `SUMMIT_HQ_DATA_TOKEN` or else the data key; a key that can't read it
just leaves the entries for the next person who opens the portal, and the run summary says so.

**The Desk reads these field names; if one ever changes, tell Jonna:** event, status, company,
contactName, contactEmail, opportunity, amountDue, invoiceNumber, invoiceDate, compCode, numComps,
lastFollowUpDate, paymentReceivedDate, inKind.

## Background work

New applications from the prospectuses, MISMO Money payments and prospects returning to the list
are all handled by the portal's own code when someone with edit access opens it. GitHub opens it
every hour, about 7 am to 7 pm Eastern, as "Sponsorship Robot", so these happen even on a day
nobody opens it. The schedule lives in the site repo (GitMISMO.github.io,
`.github/workflows/sponsorship-background.yml`), because that is where the data key is: it uses
`SPONSOR_DATA_TOKEN`, the same secret the Summit Sponsor Feed uses, and that key needs
Contents: Read and write on GitMISMO/sponsorship-data. Each run's summary (Actions tab,
"Sponsorship Background Work") says what it did.

The 8 am Eastern run also runs `tests/health.js`: the Availability and Intake flows answer, every
email the portal queued has been sent by the Team Emails flow, MISMO Money's payments are recent,
and the pages load. If anything has stopped, the run fails and GitHub emails Jonna.

## Practice copy

Add `?practice` to the address to try anything on test data, with nothing saved to the real
records and nobody emailed:

- resources.mismo.org/sponsorship/?practice
- resources.mismo.org/Sponsorship-Prospectus/?practice (and `spring-2027/?practice`, `fall-2027/?practice`)

An application submitted on a prospectus in practice shows up in the practice portal, so the
whole round trip can be tried. The orange bar at the top says what would have gone out, and
"Reset Test Data" starts over.

## Before publishing a change (people and Claude sessions)

1. Start from the current `index.html` on GitHub, never an older copy (see the note at the top
   of `index.html`).
2. Run the checks. They need Node and Playwright:

   ```
   cd tests
   npm install && npx playwright install chromium   # first time only
   node checks.js /path/to/Sponsorship-Prospectus
   ```

   Every check must pass. A check that fails says in plain words what broke.
3. Open the changed page with `?practice` and try the change by hand.
4. Publish. GitHub runs the same checks again; a red X on the commit means one failed, and
   GitHub emails whoever made the change.

When you change how the portal or a prospectus behaves, add a check for it in `tests/checks.js`
so the next change can't quietly undo it.
