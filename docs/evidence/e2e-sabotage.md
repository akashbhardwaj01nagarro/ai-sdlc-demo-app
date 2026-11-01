# Does the Playwright test fail for the right reasons?

`e2e/tests/approval-limits.spec.ts` was run against three versions of the app (2026-11-01, Chromium,
fresh `dotnet run` each time). Each sabotage was a temporary local edit, reverted with `git checkout`.

| Run | Change to the app | Result | Where it failed |
| --- | --- | --- | --- |
| 1 | none | 1 passed | — |
| 2 | `ApprovalLimits.ManagerLimit = 100_000m` (wrong limit) | 1 failed | line 32: `expect(response.status()).toBe(403)`, received 200 |
| 3 | `invoice.DecidedBy = approver.Username;` moved above `ApprovalPolicy.Decide(...)` in `ApprovalService.Approve` (write before deciding) | 1 failed | line 39: the invoice after reload differs from the one before the attempt: `"decidedBy": null` expected, `"demo.manager"` received |
| 4 | reverted | 1 passed | — |

Run 3 is the bug the assignment warns about: the server still answers 403 with the right reason and
the page shows it, so a test that only checks the response and the screen passes. The refused attempt
nevertheless changed the stored invoice, because the repository hands out the live object. Comparing
every field the server returns, after a reload, is what catches it.
