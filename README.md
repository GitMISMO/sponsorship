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
| `tools/member360-feed.js` | Makes the read-only list Member 360 reads (see below). Checked by `tests/feed-check.js` (part of the checks). |

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

## The list Member 360 reads (CN-016, November 23, 2026)

Approved by Jonna (Nov 24, 2026 notice): Member 360 shows each company's sponsorship activity in a Sponsorship section
on its record. It reads `data/feed-member360.json` in sponsorship-data through the save relay
(`/sponsorship/data/feed-member360`) with its own users' sign-in, matches by Aptify Company ID (the company name when
there is none) and never writes here. Shape (add fields, never rename or remove):
`{updated, count, companies:[{cid, name, prospect:{stage, owner, lastTouch, nextStep, open, nextDate, kind, season,
interestedIn, leadNo, createdDate}, sponsorships:[{event, package, amount, status, invoiceSent, paid, kind, no,
invoiceNumber, amountPaid, ...}], lastEvent:{date, what}, key, aka}]}`. Every company the portal knows
(`companies()`: prospects, applications, workgroup and other sponsorships, touchpoints), one per `companyKey`. `cid`
comes from a record's `aptifyCustomerId`, else MISMO Money's paid order for its invoice number, else blank.
`prospect.stage` is the newest open prospect's stage (blank when none); owner and last touch follow `coFill`.

`tools/member360-feed.js` builds it from the data files with the portal's own rules (its copied constants are compared
with `index.html` by `tests/feed-check.js`, so change both together). The sponsorship-data workflow **Member 360 Feed**
(`.github/workflows/member360-feed.yml`) runs it on every push that changes the records, every morning (10:23 UTC) and
by hand, with that repository's own `GITHUB_TOKEN`; it rewrites the file only when a company changed or the copy is
over 20 hours old. System Health shows it as Member 360 Sponsorship List (late after a day and a half, red after 3).

## Sponsors and Prospects, the Member 360 way (November 19, 2026)

Jonna: "make it similar" to Member 360, in how it works. **Home** opens first. **Sponsors and Prospects**
(`view-spm`, `renderSpm`) follows Member 360's Members and Prospects: tiles by relationship (`LIFE`), a band
(current sponsors by top tier, **Outstanding** by summit and kind via `coOwed`, summit first, and the sponsor
pipeline), New Prospects This Week, the relationship tabs, summit/kind (`spmWhatMatch`), stage and owner filters,
Outstanding Only, the A to Z bar and 50 rows at a time; choices are kept in `sponsorship:spm`. The company
record's Overview follows Member 360's: stage bar per deal, Money / Benefits Used / Open Deal, Key Contacts,
Recent Activity, Company Details; its band reads Tier, Sponsor Since, Sponsorship Ends, this season, Last Touch.
The summit-first page (`view-spx`) stays in the page, unlinked.

## The logo as a file (November 20, 2026)

Download Logo works without a SharePoint sign-in. The online prospectus sends the logo (`logoBase64`) and its file
name (`logoFileName`, `<reference> - <company>.<ext>`). The Sponsorship Intake flow saves it to Sponsor Logos on
the MISMO Summits site as before and, in its last step (**Save Logo**, after the sponsor's confirmation email, run
even if that email fails), also PUTs it to the relay as `data/logo-<reference in lower case>.json`
(`{reference, name, type, data, at}`). `fromProspectus` keeps the file name on the record as `logoFile`; older records
find it on their request in `data/inbox.json` (`logoFileOf`).

`logoOf(apps, companyKey)` picks, in order: a logo added on the company card (`data/logo-co-<key>.json`, noted on
`companies/<key>.logo`), the newest application's `data/logo-<reference>.json`, then the website's logo from the
sponsor feed. The file is read once on click (`db.once`, never polled) and handed over as a download with its own
name; if the relay has no copy (a request from before November 20, or a logo too big for the relay's 6 MB limit), it
falls back to SharePoint's `_layouts/15/download.aspx` link. **+ Add a Logo** / **Replace Logo** on the company card
saves a file of up to 4 MB with `db.putOnce`. Download Logo is on the company card and under Company Details, and
Download the Logo is on the application.

## Payment follow-ups for workgroup and other sponsorships (November 21-22, 2026)

Jonna asked for automatic past-due follow-ups for workgroup sponsorships (Nov 21), then that they start only "when amy or
we trigger the automated follow up button", as a friendly nudge with the invoice attached, for the AI Webinar sponsorships
too (Nov 22). On a workgroup or other record that is Pending Payment, the **Payment Follow-Ups** section (`chaseSection`)
takes the invoice PDF (stored as `data/invoice-<record id>.json`, {name, type, data, at, by, recordNo}, up to 2 MB; the
record keeps `invoiceFile`) and has **Start Automated Follow-Ups** (needs the invoice date, the PDF, and
`billingContactEmail` or `contactEmail`). Start sets `chaseOn`, `chaseBy`, `chaseAt`; Stop sets `chaseOn:false`,
`chaseStoppedBy`, `chaseStoppedAt`. `wgChaseRun` (after the records load, every 30 minutes, each robot run, and right
after Start) queues an outbox email for each record that is on and due: the first at once, then every `CHASE_BDAYS` (10)
business days after `lastFollowUpDate`, until Paid; weekdays 8 am to 6 pm Eastern only (`wgChaseHours`). Kind
`wg-pastdue` (workgroup) or `os-reminder` (other); id `bpd-<record id>-<n>`; To the billing contact (else the sponsor
contact); Cc the sponsor contact, `BILL_CC` (Jonna, Amy, Kelly); MBA is not
copied (Nov 22, 2026); `attachments: [{Name, ContentBytes}]` with the invoice. The Team Emails flow's Default case sends To, Cc,
Subject, bodyHtml and Attachments; a request with `fromBox` (the payment reminders, since Nov 25, 2026) goes from that shared mailbox, mismosponsor@mismo.org, so replies are logged on the company, and any other from Jonna's mailbox. Once `outbox-sent` lists it, `chaseTrim` takes the invoice bytes
off the outbox entry. The record keeps `followUpCount`, `lastFollowUpDate`, `followUps`; the history says "payment
reminder n emailed automatically ... invoice attached". Billing Contact Name and Email are on every workgroup and other
record. System Health has a Payment Follow-Ups row.

## Activity, System Health, Forwarded Emails (November 21, 2026)

Asked for by Jonna ("create an activity tab like member 360 and a system health tab ... to make this a rock solid program").

- **Activity** (`view-activity`, `renderActivity`, under Records): rows from the activity log (`log/main` plus the monthly
  `log-YYYY-MM` files, read with `db.readLog` for the period picked), touchpoints (not the ones made from mismosponsor@
  emails), `mailin` (each forwarded email, with its status) and `plans`. Entries by the portal itself, the robot, the
  online prospectus, the Registration Desk and the like (`ACT_AUTO`) are left out. Four boxes (Changes Saved,
  Touchpoints, Forwarded Emails, People Active), the band (Last 14 Days, Who Did What, Kind of Work) and the filters
  (search, Who, What, When) work as Member 360's; a company name opens its card.
- **System Health** (`view-health`, `hlCheck`, `hlPaint`; the menu button `#tab-health` shows for the admin role only,
  with a red count in `#pip-health`). Rows: MISMO Money Payments (late after 2 days, red after 4), Prospectus
  Applications (`inbox`), Applications Taken In (inbox references with no record and not in `inbox-taken`), the
  mismosponsor@ mailbox, Forwarded Emails Without a Company, the Registration Desk, the Summit HQ agenda and MISMO Media
  (read through the relay with the viewer's sign-in; "Your sign-in can't read it" is not a fault), the price list, the
  Sponsorship Requests list check (`listSync`), the Team Emails flow (anything queued over 20 minutes and not in
  `outbox-sent`), failed emails in 7 days, failed saves in 7 days, storage (biggest data file against the relay's 1 MB
  limit, admin only, every 6 hours), the hourly robot (`robotAt`) and **Rule Checks** (`hlRuleChecks`: made-up examples
  through `companyKey`, `sharesOf`, `leadStage`, `coTypeOf`, `prospectusRef`, `appLive`, and data checks for duplicate
  application, prospect and prospectus numbers, applications with no company and prospects for an unknown summit).
- Every open copy checks 45 seconds after opening and every 30 minutes; the result is kept in `data/health.json` as
  `health/main` (at most every 30 minutes unless the red list changes; the robot's runs set `robotAt`). `saveFailed`
  also keeps each failed save as `health/e…` (the same message once an hour per browser). Nothing is emailed from it;
  the GitHub health check (`tests/health.js`, 8 am ET) still emails Jonna when it fails.
- **Version notice**: the page fingerprints itself (`verRead`) and checks every 15 minutes; when a newer one is
  published, `#ver-bar` asks to reload. The version shows under Checks on System Health.
- **Numbers never given twice**: `nextAppNo` and `nextLeadNo` remember the highest number this page has handed out
  (`givenNo`). The rule check found two prospects with the same number in practice when a re-read arrived between two
  new prospects.
- **Forwarded Emails tile** on Home (`.hm-fwd`, `data-hmfwd`), as Member 360's: the count of emails to mismosponsor@
  that still need a company, the newest two, and what else is waiting; selecting it opens the Outreach Planner's Also
  Waiting on the mismosponsor@ list. When everything matched it says so and there is nothing to do.
- Outreach Planner: the week is rows (`.op-week .op-day` is a grid: the day on the left, the cards across), and Who to
  Touch is a closed `<details>` (`#op-whosect`) with its count. Menu pages open at the top.

## Sponsors, Prospects, Also Waiting, MISMO Media (November 21, 2026)

- **Sponsors** (`view-spm`, nav label Sponsors) lists only companies that sponsor now, applied or sponsored before
  (`SPM_LIFE`); its band's third column is Sponsors by Summit (`data-spmpick` sets the summit filter); New Sponsors
  only (no prospects). Prospects live on **Prospects** (`view-plist`).
- **Pipeline**: `#flow-types` (Summit / Workgroup / Other) sits above the band in `.flowkinds`, with `#flow-kindnote`.
- **Also Waiting** (`#op-also`): number boxes (`data-awt`: apps, late, inv, mail, newp) and one pane at a time
  (`.aw-pane`, `opState.aw`); the mismosponsor@ box (`#flow-mailbox`) and New Prospects (`#flow-newbox`) are panes.
- **MISMO Media**: `loadMediaFeed` reads `/marketing-hq/data/feed-sponsor-benefits` (read only, every 10 minutes);
  `mediaDone(a, summit, "linkedin"|"micdup")` makes those two benefits show done. Shape in the Connections Map:
  `{updatedAt, entries:{<id>:{appNo, company, summit, benefit, status, on, url, by, at}}}`; matched on appNo, else
  company name; no summit = every summit; draft/planned/cancelled ignored. Nothing is written to the records.

## Back to kinds, one company card (November 21, 2026)

Nav: Home, Outreach Planner, Pipeline, Prospects (`view-plist`), Sponsors and Prospects (`view-spm`), Benefits;
Sponsorships: Summit (`view-pipeline`), Workgroup, Other; Records: Inventory, Money, Prospectuses.

- **Pipeline** (`renderFlow`): `flowState.type` is `summit` (default), `workgroup` or `other` (`FLOW_KINDS`,
  `flowKindOk` with `coTypeOf`); the whole page (headline, funnel, drill lists, rows) is that kind only.
- **One company card**: `openDrawer`, `openBill` and `openLeadDrawer` are wrapped so a record with a company opens
  docked inside `#co-panel` (`dockRec`: the drawer element moves into `#cp-dock`, class `docked`, the card body hides,
  `#cp-dockback` says Back to the company). Closing the record (Back, Cancel, ×, Escape) undocks it and shows the card
  again (`undockEl`); closing the company closes a docked record first. A new record with no company opens on its own.
- **New Sponsors / New Prospects** (`paintNewIn`, `newInRows`, `npRange` on the Sponsors and Prospects page): a
  sponsor is new on its application's `approvedDate` (else `dateSubmitted`) for Approved/Pending Payment/Paid/In
  Kind/Written Off, or a workgroup/other sponsorship's `periodStart`/`invoiceDate`; a prospect on `createdDate`.
  Periods: this month, last month, this year, any of the last 24 months, or custom dates; kinds via `coTypeOf`.
  State in `sponsorship:spm` (`np`).
- **Prospects**: Summit / Workgroup / Other buttons (`coTypeOf`), `#pl-summit` (a Series counts for its year's
  summits; "Summit Not Picked Yet"), and a Which Summit picker in each summit row (`data-leadsummit`).
- **Outreach Planner**: Past Due is a strip (`.op-catch`) above `.op-week` (five columns, each only as tall as its
  cards); empty Who to Touch cards are left out.
- Home no longer has Team Activity; `.wrap` bottom padding is 24px.

## When a save fails (November 20, 2026)

Amy approved Guidehouse: the screen said Approved, the invoice request went to Bernie and the list was
updated, but the save to `applications.json` never landed (it failed silently), and a save moments later made
from the screen's unsaved copy wrote only `updatedAt`, so nothing looked wrong. Now `saveApp`, `saveLead` and
`saveBill` call `saveFailed()` on any failure: a **Not Saved** message, the panel says Not saved, and the file is
read again (`db.reload`) so the screen shows what is saved; the promise rejects. `doSave` queues its emails
(`doSaveAlerts`), writes its history line and shows "Saved" only after the save resolves; the list update in the
`saveApp` wrapper and the Payment Made emails from MISMO Money and the Registration Desk wait the same way. A 409
now retries up to seven times with a short random wait. Practice: `__practice.failNext(file, n)` makes the next n
saves of a file fail.

## Just Came In (November 20, 2026)

Home's hero starts with **Just Came In** (`.hm-in`, built in `renderHome`): every application still Submitted
(first), then every application that came in through a prospectus (`prospectusRef`) this calendar month, whatever its
status now (not Declined), newest first; no prospects (Jonna, November 21, 2026). Up to eight cards (two on a phone),
each opening the record itself (`data-fkind`/`data-fid`/`data-direct`). The headline sentence also counts the
applications to review.

## Outreach Planner (November 19, 2026)

To Do now looks and works like Member 360's Outreach Planner (`view-todo`, `renderTodo`, nav label Outreach Planner).
Items come from `opItems()`: open prospects' `nextFollowUpDate` (kind `lead`), a prospect follow-up marked done
(`lastFollowUp` on the lead, kind `leaddone`, so it shows as done and can be reopened), touchpoint next steps no open
prospect carries (`touches[].next`, kind `touch`), and planned touches in **`data/plans.json`** (kind `plan`:
`{co, coName, day, owner, lane, by, at, done, doneBy}`). The page: the navy headline (`#op-top`, where to start and
five number boxes), Everyone / one person and This Week / Next Week / Past Due chips (`sponsorship:planner`), Up Next
(Email, Log a Touchpoint, Move to…, Mark Done, Show the next one), the week board (Past Due plus Monday to Friday;
weekend dates sit on Friday), Communicated This Week, Who to Touch (`OP_LANES` / `opLanes`: prospects with no next
date, prospects gone quiet 30+ days, current sponsors not in for the next summit, benefits due in 30 days, sponsors
gone quiet 60+ days, past sponsors to win back; anyone touched in the last 7 days or with an open item through next
week is left out), Also Waiting (applications to review, payments past due, waiting on an invoice, the mismosponsor@
emails, New Prospects) and All Follow-Ups. Dragging a card (`dragstart`/`drop` on `.op-day[data-opday]`) moves a plan's
day, a touchpoint's `next.due` or a prospect's `nextFollowUpDate`; `opMove`, `opDone`, `opAddPlan` and `opDropPlan`
each push onto the Undo stack.

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

## Prospects on the Pipeline (November 24, 2026)

Amy: "it's about where the prospects are in the pipeline". The Prospects menu item is gone (showView("plist") opens the Pipeline with flowState.group = "prospects"); view-plist stays in the page, unlinked. Under the Pipeline's stage boxes: #flow-band (paintFlowBand: Forecast, Prospects by Summit/Workgroup/Type, Follow-Ups from flowFuOf: late, week, later, none), then New Prospects (#pl-newp, paintNewBox("pr"), starting on the kind picked). The list adds #flow-what (flowWhatChoices / flowWhatOk: a summit key or summit:-, wg:<name> or wg:-, type:<key>), flowState.fu, and #flow-mine (owner = whoAmI()). A summit prospect's What says its summit, or that none is picked yet.

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
(`settings/main.otherTypes`): name, what each one is called, MISMO's share, and the partner if
the money is shared. MBA is no longer sent a past-due notice; MISMO follows up with the sponsor itself
(Payment Follow-Ups, Nov 22, 2026). The AI webinar records were copied into `others.json` under the
same ids and numbers the first time an editor opened the portal; `data/webinars.json` is kept as it
was.

## The mismosponsor@ mailbox

Logos (November 24, 2026): the flow (includeAttachments on) keeps each image attachment whose name says logo, or any non-inline image when the subject says logo, up to 3 MB (Filter logos), PUTs it to data/maillogo-<received yyMMddHHmmss>-<base64 length>.json as {name, type, data, from}, and lists them on the email as logos:[{name, type, store}]. mailLogo() saves the first (one named logo, if any) as the matched company's data/logo-co-<key>.json and companies/<key>.logo (via: "mismosponsor"), the same as + Add a Logo; the Summit Sponsor Feed copies it to the website within a few minutes (CN-022 signal). The email gets logoSaved.

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
`sponsors/build-sponsors.mjs`) puts every approved sponsor on the website, with its
logo, within a few minutes of a save (see The Website Sponsor Signal below; its hourly run is the backup). The portal reads the feed's published list (`/sponsors/<summit>-2027.json`) and ticks the logo
from it. The only time it shows as a to-do is when the website lists a sponsor with its name but
no logo file; then the file is saved once in the site repo as `sponsors/logos/<company-name>.png`.
The checks use a made-up copy of that list in `tests/fixtures/sponsors/`.

## The Website Sponsor Signal (CN-022, November 24, 2026)

Whenever a save changes `data/applications.json` (a sponsor record or a status change) or a `data/logo-*.json`
copy, the sponsorship-data workflow **Website Sponsor Signal** (`.github/workflows/website-sponsor-signal.yml`)
sends `repository_dispatch` `sponsor-data-changed` to GitMISMO.github.io, which starts its Summit Sponsor Feed, so
the website shows the change within a few minutes. The feed's hourly run stays as the backup. The workflow runs after
the save is on GitHub, so it never blocks or undoes a save. It uses the sponsorship-data repository secret
`WEBSITE_DISPATCH_TOKEN` (a fine-grained token for GitMISMO/GitMISMO.github.io only, Contents: Read and write). Until
that secret is set, each run passes with a note in its summary; a token that has expired or can't reach the site makes
the run fail, which the Failure Watcher reports.

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
