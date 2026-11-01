# Quickstart: validate Approval Limits by Role

## Prerequisites

- .NET 8 SDK. On a machine whose `dotnet` has no SDK, first run `source scripts/dev-env.sh`
  (Git Bash) or `. .\scripts\dev-env.ps1` (PowerShell).
- Node.js for the Playwright tests.
- Demo accounts (password `ChangeMe123!`, not real credentials): `demo.manager` (Manager),
  `demo.director` and `demo.director2` (Director), `demo.admin` (Admin).

## Automated checks

| Check | Command | Expected |
| --- | --- | --- |
| Unit tests | `dotnet test backend/InvoiceApp.sln` | all pass |
| One rule | `dotnet test backend/InvoiceApp.sln --filter Rule=FR-005` | refusal tests pass |
| End-to-end | `cd e2e && npm ci && npx playwright install chromium && npx playwright test` | the refused over-limit approval test passes |
| Mutation | `dotnet tool restore`, then in `backend/tests/InvoiceApp.Tests`: `dotnet stryker -m "**/Approv*.cs"` | score recorded in `docs/mutation/` |

## Manual scenarios (http://localhost:5000 after `dotnet run --project backend/src/InvoiceApp.Api`)

1. **FR-001/FR-005**: as `demo.manager`, create and submit an invoice of 60,000, then approve it on
   the Approvals tab. Expect the alert "Approval refused: invoice INV-… is 60,000.00, above the
   50,000.00 limit for the Manager role. A Director must approve it." After a reload, the invoice is
   still Pending Approval.
2. **FR-002**: as `demo.director`, approve the same invoice. Expect Approved, decided by
   `demo.director`.
3. **FR-006**: as `demo.admin`, approve any pending invoice. Expect "the Admin role cannot approve
   invoices".
4. **FR-003 (US2)**: create and submit 640,000; approve as `demo.manager`. Expect it to stay pending
   with "Awaiting second approval (first: demo.manager)".
5. **FR-004 (US2)**: approve the same invoice as `demo.manager` again. Expect "the second approval must
   come from a different Director"; then approve as `demo.director` and expect Approved with both
   names kept.

Contract details: [contracts/approvals-api.md](contracts/approvals-api.md). Data and states:
[data-model.md](data-model.md).
