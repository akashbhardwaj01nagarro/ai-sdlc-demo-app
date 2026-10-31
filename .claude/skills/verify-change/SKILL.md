---
name: verify-change
description: The definition-of-done checks for this repo and how to report them. Use before saying a change is finished, before committing, or when asked to verify, build or test the invoice app.
---

# Verify a change

Run from the repository root in Git Bash. On this machine the .NET SDK is user-local, so start every shell with `source scripts/dev-env.sh` (PowerShell: `. .\scripts\dev-env.ps1`). Stop a running app first (`Get-Process InvoiceApp.Api | Stop-Process` in PowerShell): it locks `bin/` and breaks the build.

| Check | Command |
| --- | --- |
| Build | `dotnet build backend/InvoiceApp.sln` |
| Unit tests | `dotnet test backend/InvoiceApp.sln` |
| One rule | `dotnet test backend/InvoiceApp.sln --filter Rule=FR-004` |
| End-to-end | `cd e2e && npm ci && npx playwright install chromium && npx playwright test` |
| Mutation (approval code) | `dotnet tool restore && cd backend/tests/InvoiceApp.Tests && dotnet stryker -m "**/Approv*.cs"` |
| Hook and log scripts | `node --test ".claude/hooks/tests/*.test.mjs" ".githooks/tests/*.test.mjs" "scripts/ai-log/tests/*.test.mjs"` |

Run the rows that the change can affect; build and unit tests always.

Report the result as a table with one row per check: check, command, result (`pass`, `fail` or `not run`), and the key numbers (tests passed/failed, mutation score). Quote the first failure verbatim. Never report a check as passing that you did not run.
