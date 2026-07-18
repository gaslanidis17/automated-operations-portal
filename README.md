# Fleet Courier Stakeholder Portal

A multi-tenant, read-only stakeholder portal built with Google Sheets and Google Apps Script. Each public demo access code is mapped to exactly one fictional fleet company, and every data request is filtered on the server before results reach the browser.

> **Portfolio data notice:** Every organisation, courier ID, ticket, action, date, market, handler label, and note in this project is fully fabricated. This is an independent portfolio reconstruction. It contains no employer or delivery-platform data, source code, credentials, screenshots, documentation, or confidential business logic.

## Live demo

**[Open the deployed stakeholder portal](https://script.google.com/macros/s/AKfycbwSK9PBaw3DLnOlor96ypVvqmmHzVU_HGvUqyQGWZerXgIjTzcNsvBUtsu5YAnM0VEsIQ/exec)**

The login codes below are intentionally public because they unlock only synthetic portfolio data.

| Fictional fleet | Public demo code | Expected courier IDs | Records |
|---|---|---|---:|
| Northstar Logistics | `Northstar-Demo-7K4Q` | `CR-N-*` only | 67 |
| Blue Harbor Fleet | `BlueHarbor-Demo-8M2P` | `CR-B-*` only | 67 |
| Cedar Route Partners | `CedarRoute-Demo-5R9X` | `CR-C-*` only | 66 |

The same accounts are displayed on the live login page as one-click demo options.

## What this project demonstrates

- Tenant isolation in a lightweight Google Workspace application.
- Server-controlled stakeholder-to-company mapping.
- Hashed access codes rather than readable codes in the database sheet.
- Random, expiring server-side sessions.
- Rate-limited login attempts.
- Read-only stakeholder access with no browser-side write endpoint.
- Search, status, termination, and date filters applied after tenant isolation.
- Audit logging for successful logins and record views.
- Safe browser rendering with `textContent` instead of HTML injection.

## Security model

```text
Public access code
        |
        v
Apps Script login endpoint
        |
        +-- HMAC-SHA-256 comparison against the Stakeholders sheet
        |
        v
Random six-hour session token
        |
        v
Server reads session company_id
        |
        +-- Filters CourierActions by exact company_id first
        +-- Applies visitor filters second
        |
        v
Company-scoped records returned to the browser
```

The browser never supplies or chooses a `company_id`. The company identity always comes from the authenticated server-side session. The spreadsheet itself remains Restricted; visitors receive only the deployed web-app URL.

Hiding the `Stakeholders` and `AuditLog` tabs is a convenience, not a security control.

## Synthetic dataset

Running `setupPortal_` creates 200 fictional courier-action records:

- 67 Northstar Logistics records.
- 67 Blue Harbor Fleet records.
- 66 Cedar Route Partners records.
- Fictional courier and ticket identifiers.
- Varied actions, statuses, termination outcomes, dates, and markets.
- Explicit notes stating that records are synthetic.

No names, phone numbers, email addresses, home addresses, payment details, or other personal data are included.

## Repository files

| File | Purpose |
|---|---|
| `Code.gs` | Apps Script backend, authentication, tenant filtering, setup, and audit logging |
| `Index.html` | Responsive login and stakeholder dashboard |
| `appsscript.json` | Apps Script runtime and OAuth scopes |
| `SECURITY_TESTS.md` | Tenant-isolation acceptance tests |
| `.gitignore` | Prevents local Apps Script and environment files from being committed |

## Install your own copy

1. Create a Google Sheet and keep it Restricted.
2. Open **Extensions -> Apps Script**.
3. Replace the default `Code.gs` with this repository's `Code.gs`.
4. Add an HTML file named `Index` and paste in `Index.html`.
5. Enable the manifest file in Apps Script Project Settings and replace it with `appsscript.json`.
6. Save the project.
7. Run `setupPortal_` once and approve the requested spreadsheet permissions.
8. Return to the spreadsheet and reload it.
9. Deploy the script as a web app, executing as the owner and allowing the intended visitor audience.
10. Test every demo account before sharing the URL.

Setup is idempotent. It creates missing tabs and seeds data only when those tabs are empty. If an existing tab has unexpected headers, setup stops without overwriting it.

## Sheets created

- `CourierActions`: the synthetic ticket-handling database.
- `CompanyDirectory`: the stable fictional company IDs and display names.
- `Stakeholders`: stakeholder-to-company mappings and access-code hashes.
- `AuditLog`: append-only login and record-view events.

`Stakeholders` and `AuditLog` are hidden after setup. The spreadsheet must still remain Restricted.

## Demo versus production

The three published codes are demo credentials and must never be reused for real stakeholders. For a non-demo deployment:

- Create a separate code for every human stakeholder.
- Deliver credentials through an approved secure channel.
- Rotate or deactivate credentials when access changes.
- Minimise personal data and define a retention policy.
- Complete the required privacy and security reviews.
- Prefer a managed identity provider and database for higher volumes or sensitive data.

Google Sheets and Apps Script are appropriate for this controlled portfolio prototype and modest internal workflows, not as a substitute for a fully managed identity and data platform.
