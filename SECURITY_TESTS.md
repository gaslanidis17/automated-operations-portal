# Tenant-isolation acceptance tests

These tests focus on the highest-risk requirement: one company must never receive another company's courier rows.

## Test data

Use the 200 synthetic rows created by `setupPortal_`. The courier ID prefixes make accidental cross-company results easy to spot:

- Northstar: `CR-N-`
- Blue Harbor: `CR-B-`
- Cedar Route: `CR-C-`

## Required tests

| Test | Action | Expected result |
|---|---|---|
| Portfolio notice | Open the login page | A prominent notice states that every record and organisation is fictional |
| Northstar baseline | Log in with the Northstar demo code | 67 records appear and every courier ID starts with `CR-N-` |
| Cross-tenant search | While logged in as Northstar, search for `CR-B-0052` | Zero records |
| Blue Harbor baseline | Log out and use the Blue Harbor demo code | 67 records appear and every courier ID starts with `CR-B-` |
| Filter bypass attempt | Change search, status, termination, and date filters | Every returned ID still begins `CR-B-` |
| Cedar Route baseline | Log out and use the Cedar Route demo code | 66 records appear and every courier ID starts with `CR-C-` |
| Invalid code | Enter a random invalid code | Generic invalid-code error; no company information |
| Deactivated stakeholder | Set a demo stakeholder's `active` value to `FALSE`, then log in | Login is rejected |
| Rotated access | Rotate a demo stakeholder code | Old code fails; new code succeeds |
| Expired session | Clear Apps Script cache or wait for expiry | Next data request returns to the login page |
| Sheet isolation | Open the sheet link as a stakeholder | Access is denied because the sheet is Restricted |

## Code-level invariant

In `readCompanyRecords_`, the exact `company_id` comparison must remain before all client-provided filtering. No public server function may accept a company ID from the browser.
