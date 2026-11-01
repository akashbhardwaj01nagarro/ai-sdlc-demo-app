# Project conventions for AI agents

Invoice approval demo app: ASP.NET Core 8 Web API with a small static web UI.

## Layout

- `backend/src/InvoiceApp.Domain`: business rules, no web or storage code. `ApprovalService` owns the invoice lifecycle (Draft, PendingApproval, Approved, Rejected).
- `backend/src/InvoiceApp.Api`: controllers, sign-in (`Auth/`), in-memory repository, and the web UI under `wwwroot/`.
- `backend/tests/InvoiceApp.Tests`: xUnit tests, one test class per class under test, named `<ClassUnderTest>Tests`.
- `e2e`: Playwright end-to-end tests (`tests/`) and page objects (`pages/`).
- `docs/use-cases`: short briefs for features we may build.
- `specs/`: Spec Kit specifications; a spec is the source of truth for the feature it describes.

## Approval rules (spec 001, `specs/001-approval-limits/`)

Who may approve depends on the approver's role and the invoice amount. Limits are inclusive and exact decimals: never round or truncate an amount before comparing.

| Rule | Invoice amount | Approval needed |
| --- | --- | --- |
| FR-001 | up to 50,000.00 | one Manager or one Director |
| FR-002 | 50,000.01 to 500,000.00 | one Director |
| FR-003 | above 500,000.00 | two different users: the first a Manager or a Director, the second a Director |

- FR-003: the first approval is recorded on the invoice (`FirstApprovedBy`, `FirstApprovedAt`) and the invoice stays `PendingApproval`. Only the second approval sets `Approved`, `DecidedBy` and `DecidedAt`.
- FR-004: the same user never counts as both approvers on one invoice. A user is the signed-in username, compared trimmed and case-insensitively. This covers repeat clicks and concurrent requests: read, decide and write must happen as one step.
- FR-005: a refused approval attempt returns a clear reason (the invoice and the rule that applied, with its facts: the role, the limit or the first approver) and changes nothing: every invoice field keeps its value and the repository's `Update` is not called. A refused attempt is not a rejection; it never sets `Rejected`.
- Only Manager and Director can approve. Admin and any unknown role are refused (fail closed); Admin may still reject and delete.
- Rejecting an invoice is not limited by role or amount.
- Repositories hand out live objects. Check every rule first, then write. A field written before a refusal leaks into the store even without `Update`.

## Layering

- Domain decides. `ApprovalPolicy` holds the rules as a pure function of values (it never receives or writes an `Invoice`); `ApprovalService` loads the invoice, asks the policy, and only then writes. The limits live in one place, `ApprovalLimits`.
- Api adapts. Controllers build the approver from the signed-in session, never from a request body, and map service exceptions to HTTP: not found 404, wrong state 409, bad input 400, refused approval 403 with `{ error, code }`.
- `wwwroot` only displays. No limits or role checks in JavaScript; show the server's `error` text.

## Conventions

- Controllers live in `Controllers/`, one per resource, route `api/[controller]`. Request bodies are `record` types declared inside the controller.
- Controllers inherit `ApiControllerBase` and use `Handle(...)` so service errors map to status codes as described under Layering.
- Every endpoint is behind sign-in. Restrict actions with `[RequireRole("...")]`: destructive actions are Admin only. Approval authority is decided in Domain, not by the role gate.
- Business rules go in the Domain project, never in controllers.
- Register services in `Program.cs`. Repositories are interfaces in Domain with an in-memory implementation in Api.
- Every new rule or endpoint needs tests. Use `FakeInvoiceRepository` in tests.
- Use clear names; no one-letter variables or `flag` parameters.
- End-to-end tests use page objects and role-based locators (`getByRole`, `getByLabel`), never CSS or XPath selectors.

## Tests

- Every rule has an at-limit, an over-limit and a negative test, tagged `[Trait("Rule", "FR-00x")]` so one rule can be run on its own.
- Boundary tests use literal amounts (`50000.00m`, `50000.01m`, `500000.00m`, `500000.01m`), never the `ApprovalLimits` constants: a test that reads the constant still passes when the constant is wrong.
- A refusal test asserts three things: the exception type and reason code, a full snapshot of the invoice taken before the attempt (a copy, not a second reference), and that `Update` was not called.
- Never weaken, skip or delete an assertion to make a test pass. Fix the code, or stop and ask.

## Commands

- Windows without a system .NET SDK: start each shell with `source scripts/dev-env.sh` (Git Bash) or `. .\scripts\dev-env.ps1` (PowerShell) to put the user-local SDK in `~/.dotnet` first on PATH.
- Run the app: `dotnet run --project backend/src/InvoiceApp.Api` then open http://localhost:5000
- Build: `dotnet build backend/InvoiceApp.sln`
- Run the tests: `dotnet test backend/InvoiceApp.sln`; one rule only: `dotnet test backend/InvoiceApp.sln --filter Rule=FR-004`
- Run end-to-end tests: `cd e2e && npm install && npx playwright install chromium && npm test`
- Mutation testing: `dotnet tool restore`, then from `backend/tests/InvoiceApp.Tests` run `dotnet stryker -m "**/Approv*.cs"` (approval code) or `dotnet stryker` (whole Domain project). Stryker.NET is pinned to 4.13.0 because newer releases need a later .NET runtime; the global equivalent is `dotnet tool install -g dotnet-stryker --version 4.13.0`. Recorded scores are in `docs/mutation/`.
- Test the hooks and log scripts: `node --test ".claude/hooks/tests/*.test.mjs" ".githooks/tests/*.test.mjs" "scripts/ai-log/tests/*.test.mjs"`

## AI workflow

- Hand an agent one scoped step at a time (one user story, one finding), never a whole feature in one prompt.
- Subagents in `.claude/agents/`:
  - test-author writes tests, and domain-implementer writes production code.
  - test-critic reviews tests, and e2e-author writes Playwright tests.
  - mutation-analyst triages Stryker survivors.
  - pr-reviewer reviews a pull request through review-rules, review-tests and review-security.
  - log-auditor checks the AI log for secrets.

  The reviewing agents end with a JSON report that a hook validates.
- Skills in `.claude/skills/`: approval-rules, verify-change, mutation-testing, e2e-playwright, pr-review, commit-conventions, ai-interaction-log.
- Hooks in `.claude/settings.json` log every prompt, tool call, subagent run and final answer to `ai-logs/ai-interactions.jsonl`, one JSON line per event in a single schema, with secrets redacted. Never edit the log by hand. Regenerate the readable `ai-logs/AI-INTERACTIONS.md` with `node scripts/ai-log/render-log.mjs`.
- Commit messages read `type(scope): what changed`, followed by a `What:` paragraph and a `Why:` paragraph. `.githooks/commit-msg` enforces this once `git config core.hooksPath .githooks` is set.
- Work happens on the fork. Push only to `origin`, and open pull requests and issues with `--repo <fork>`. A hook blocks anything aimed at the upstream workshop repository.

## Review expectations

Reviewers, human or agent, check in this order:

1. Each rule FR-001 to FR-005 holds, including the exact limits and the +0.01 boundaries.
2. No path lets one user count as both approvers: repeats, case or whitespace variants, concurrent requests.
3. Every refused path leaves every invoice field unchanged and skips `Update`, and its reason names the invoice and the rule that applied, with its facts (role, limit or first approver).
4. Rules live in Domain only; controllers adapt; JavaScript displays.
5. For each rule, a plausible wrong implementation would fail at least one test.
6. Approver identity comes from the session; no secrets or personal data are committed.
7. The conventions in this file.

Each finding has a severity (blocker, major, minor or nit) and a `file:line`. In the pull request description every finding gets exactly one verdict:

- fixed: link the commit that fixes it;
- dismissed: give the reason and the evidence, such as a test name or a spec clause;
- deferred: give the reason and link a follow-up issue.

An agent may propose a verdict; a human decides. A finding about FR-004 or FR-005 can only be dismissed with a test that proves it wrong.

## Definition of done

- Build and unit tests pass at every commit, not only at the end.
- New behaviour is covered by the tests described under Tests; UI-visible behaviour also by Playwright.
- The spec's task list is up to date.
- Each commit message says what changed and why.

## Demo accounts (not real credentials)

- `demo.approver` / `ChangeMe123!` (role Approver)
- `demo.admin` / `ChangeMe123!` (role Admin)

## Never

- Commit real credentials, tokens or customer data.
- Add business logic to `Program.cs` or controllers.
- Take an approver's name or role from a request body.
- Change a field of an invoice before every approval rule has passed.
