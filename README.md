# Fleet Courier Stakeholder Portal

A small multi-tenant ops portal I built with Google Sheets and Google Apps Script.

The setup is pretty simple: a Sheet works as the database, each fleet gets its own access code, and the backend returns only the rows assigned to that fleet. The company filter happens on the server, so this is actual tenant isolation—not a front-end table with some rows hidden.

> **Quick data disclaimer:** everything here is fake. Company names, courier IDs, tickets, actions, dates, markets, handler labels and notes are all fabricated for this portfolio project. There is no employer data, internal code, real operational information or confidential material in this repo.

## Try it live

**[Open the live demo](https://script.google.com/macros/s/AKfycbwSK9PBaw3DLnOlor96ypVvqmmHzVU_HGvUqyQGWZerXgIjTzcNsvBUtsu5YAnM0VEsIQ/exec)**

These passwords are public on purpose. They only unlock synthetic demo data.

| Fictional fleet | Demo password | What you should see | Records |
|---|---|---|---:|
| Northstar Logistics | `Northstar-Demo-7K4Q` | `CR-N-*` courier IDs | 67 |
| Blue Harbor Fleet | `BlueHarbor-Demo-8M2P` | `CR-B-*` courier IDs | 67 |
| Cedar Route Partners | `CedarRoute-Demo-5R9X` | `CR-C-*` courier IDs | 66 |

You can also pick an account directly from the login page.

## What I wanted to solve

The original idea came from a common ops problem: the data already exists somewhere, but every stakeholder needs a different slice of it.

Instead of creating separate files or manually sending updates, I wanted one source of truth with a very strict rule:

> Log in as Fleet A and you only get Fleet A's courier records. No company selector, no client-side workaround, no access to Fleet B.

The demo includes:

- Stakeholder authentication with hashed access codes.
- Server-side company mapping and tenant filtering.
- Random, expiring session tokens, so the password is not sent with every request.
- Login rate limiting.
- Search plus status, termination and date filters.
- A read-only stakeholder UI with no browser-side write endpoint.
- Audit events for successful logins and record views.
- Safe rendering through `textContent` instead of injecting raw HTML.

## How the isolation works

```text
demo password
      |
      v
Apps Script verifies the HMAC-SHA-256 hash
      |
      v
server creates a six-hour session token
      |
      v
session resolves to one company_id
      |
      v
CourierActions is filtered by company_id
      |
      v
visitor filters are applied to that smaller result
      |
      v
company-scoped rows go back to the browser
```

The browser never sends or chooses a `company_id`. It only sends the session token and optional filters. Company identity always comes from the authenticated server-side session.

The passwords themselves do not expire after six hours. Only the session does; the same password can be used to log in again.

The spreadsheet stays Restricted. Visitors only receive access to the deployed web app. Hiding the `Stakeholders` and `AuditLog` tabs is useful for organisation, but it is not treated as a security boundary.

## Synthetic data

Running `setupPortal_` creates 200 courier-action records:

- 67 for Northstar Logistics.
- 67 for Blue Harbor Fleet.
- 66 for Cedar Route Partners.
- Mixed tickets, actions, statuses, dates, markets and termination outcomes.
- Explicit synthetic-data notes in the generated records.

There are no names, phone numbers, email addresses, home addresses, payment details or other personal data.

## Repo layout

| File | What it does |
|---|---|
| `Code.gs` | Authentication, sessions, tenant filtering, setup and audit logging |
| `Index.html` | Login page and responsive stakeholder dashboard |
| `appsscript.json` | Apps Script runtime and OAuth scopes |
| `SECURITY_TESTS.md` | Tenant-isolation acceptance tests |
| `.gitignore` | Keeps local Apps Script and environment files out of Git |

## Run your own copy

1. Create a Google Sheet and keep it Restricted.
2. Open **Extensions → Apps Script**.
3. Replace the default `Code.gs` with the version in this repo.
4. Add an HTML file called `Index` and paste in `Index.html`.
5. Enable the manifest in Apps Script Project Settings and use `appsscript.json`.
6. Run `setupPortal_` once and approve the spreadsheet permissions.
7. Reload the Sheet.
8. Deploy the script as a web app, running as the owner.
9. Test all three accounts before sharing the URL.

Setup is idempotent: it creates missing tabs and seeds only empty ones. If it finds an existing tab with unexpected headers, it stops instead of overwriting it.

The setup creates four tabs:

- `CourierActions` — the synthetic ticket-handling database.
- `CompanyDirectory` — stable fictional company IDs and display names.
- `Stakeholders` — company mappings and access-code hashes.
- `AuditLog` — append-only login and record-view events.

## Populating the Sheet in a real setup

If someone adapts this for their own company, I would not recommend maintaining the Sheet by hand. The cleaner setup is to keep the ticket platform—Jira, monday.com or whatever the team already uses—as the source of truth and populate `CourierActions` through an automated sync.

```text
Jira / monday.com / ticket platform
                |
                v
official API, webhook or scheduled automation
                |
                v
field mapping + validation + deduplication
                |
                v
CourierActions sheet
```

The sync should use stable ticket IDs and upserts, so rerunning it updates existing rows instead of creating duplicates. It should also use a least-privilege integration account and export only the fields stakeholders are actually allowed to see.

This repository does not include a production Jira or monday.com connector. Authentication, field mappings, retry handling, data retention and access rules need to be configured and reviewed by each organisation before real data is connected.

## A note on production use

This is a portfolio prototype, not a claim that Sheets should replace a proper identity and data platform.

For a real deployment I would use individual stakeholder accounts, secure credential delivery, rotation and deactivation rules, a defined data-retention policy, and the required privacy/security reviews. At larger scale or with sensitive data, I would move authentication to a managed identity provider and the records to a proper database.
