# sponsorship

MISMO Sponsorship Portal, at resources.mismo.org/sponsorship/. Its records live in the private
sponsorship-data repo and are reached only through MISMO's save relay (project key "sponsorship").
The public prospectuses that feed it are in the Sponsorship-Prospectus repo.

| File | What it is |
| --- | --- |
| `index.html` | The portal. |
| `practice.js` | The practice copy. Without `?practice` in the address it does nothing. |
| `practice-data.json` | Made-up test data for the practice copy and the checks. Every company and person in it is fictional. |
| `tests/checks.js` | Automated checks of the portal and all three prospectuses. |
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
