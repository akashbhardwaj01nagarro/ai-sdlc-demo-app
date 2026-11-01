---
name: e2e-playwright
description: Conventions and commands for the Playwright end-to-end tests of the invoice app (page objects, role-based locators, isolated data, server-truth assertions). Use when writing, fixing or running e2e tests under e2e/.
---

# Playwright end-to-end tests

- Page objects live in `e2e/pages/` (`LoginPage`, `InvoicesPage`, `ApprovalsPage`); specs in `e2e/tests/`. Specs call page-object methods; they do not build locators themselves.
- Locate by role and label only: `getByRole`, `getByLabel`. Never CSS or XPath. Use `exact: true` for names that can prefix each other (`INV-1006` vs `INV-10060`).
- Create the data the test needs through the UI with a unique customer name (for example with `Date.now()`), and read the generated invoice id from its table row. Never depend on seeded invoices or on the next id.
- Assert server truth, not just the DOM: wait for the API response (`page.waitForResponse`) and check its status and JSON body, then `page.reload()` and check the state again.
- No fixed sleeps; rely on web-first assertions (`expect(locator).toHaveText(...)`).
- Demo accounts and password come from AGENTS.md; they are not real credentials.

## Running

From a shell that ran `source scripts/dev-env.sh` (the web server is started with `dotnet run`):

```
cd e2e
npm ci
npx playwright install chromium
npx playwright test                         # headless
PW_SLOWMO=400 npx playwright test --headed  # for a demo
npx playwright show-report
```

Playwright starts the app itself. Stop any running `InvoiceApp.Api` first: a stale server serves old code. Set `PW_REUSE_SERVER=1` only when you deliberately want to reuse a running app.
