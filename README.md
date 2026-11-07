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

## The price list

`Sponsorship-Prospectus/catalog.json` is the one place tiers, prices, registrations, slot counts
and days are set. The portal reads it when it opens and uses it for Inventory and for the price
check: every application from a prospectus is charged the price list's price, whatever the page
sent, and anything that doesn't fit (a wrong price, an opportunity sold at the wrong tier) is
flagged on the record until it is approved.

To change a price or a slot count: edit `catalog.json`, run `node tests/apply-catalog.js` to carry
it onto the three prospectuses and the portal, run the checks, and publish every changed file.
The checks fail if any page disagrees with the price list.

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
