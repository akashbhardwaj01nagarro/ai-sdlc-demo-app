# Implementation Plan: Approval Limits by Role

**Branch**: `001-approval-limits` | **Date**: 2026-11-01 | **Spec**: [spec.md](spec.md)

**Input**: Feature specification from `specs/001-approval-limits/spec.md`

## Summary

Approval authority depends on the approver's role and the invoice amount: a Manager approves up to
50,000.00, a Director up to 500,000.00, and anything above 500,000.00 needs two different approvers,
the second a Director. A refused attempt returns a clear reason and changes nothing. The rules are a
pure function in the Domain project (`ApprovalPolicy`); `ApprovalService` loads the invoice, asks the
policy, and writes only after every check has passed. The API maps a refusal to HTTP 403 with
`{ error, code }`; the web UI keeps showing the server's message. `ApprovalPolicy.Decide` takes `(invoiceId, amount, approver)` in US1 and gains `firstApprovedBy`
in US2; the four-argument form in research.md is the US2 end state. Delivery is two independently
releasable steps: single-approver limits first (amounts above 500,000.00 refused for everyone), then
the two-approver rule.

## Technical Context

**Language/Version**: C# 12 on .NET 8 (SDK 8.0.4xx); TypeScript for Playwright tests

**Primary Dependencies**: ASP.NET Core 8 (existing); xUnit 2.9; Playwright Test 1.63 (lockfile)

**Storage**: Existing in-memory repository (`InMemoryInvoiceRepository`); no database

**Testing**: xUnit unit tests (`backend/tests/InvoiceApp.Tests`), Playwright end-to-end tests (`e2e/`),
Stryker.NET 4.13.0 mutation testing on `Approv*.cs`

**Target Platform**: Local web app on http://localhost:5000 (Windows dev machine, Linux CI)

**Project Type**: Web service with a static web UI (existing brownfield app)

**Performance Goals**: No change from today; one approval decision is a constant-time check

**Constraints**: Rules only in Domain; every rule checked before any write (repositories return live
objects); no new runtime dependencies; reasons formatted independent of culture

**Scale/Scope**: Demo app; 2 user stories, about 10 production files touched, 2 test classes

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| Principle | How this plan complies | Status |
| --- | --- | --- |
| I. Rules Live in the Domain | Limits, roles and the two-approver rule live in `ApprovalPolicy`/`ApprovalLimits`; controllers only build the `Approver` from the session and map exceptions; `app.js` only displays the server's `error`. | Pass |
| II. Refuse Safely | `ApprovalPolicy.Decide` receives values, not the `Invoice`, so it cannot write; `ApprovalService` writes only after `Decide` returns; unknown roles are refused. | Pass |
| III. Test-First Rules | Test author writes the story's tests before the implementer runs; literal boundaries; refusal tests assert snapshot + `UpdateCount == 0`; one Playwright test for the refused over-limit approval. | Pass |
| IV. Small, Reviewed Steps | Story 1 and story 2 are separate commits and separate agent prompts; test-critic reviews every test; PR findings get verdicts. | Pass |
| V. Traceability | Tests carry `[Trait("Rule","FR-00x")]`; commits and findings cite FR IDs; hooks log every AI interaction. | Pass |

Post-design re-check (after Phase 1): unchanged, all Pass. No violations, so Complexity Tracking is empty.

## Project Structure

### Documentation (this feature)

```text
specs/001-approval-limits/
├── plan.md              # This file
├── research.md          # Phase 0 decisions
├── data-model.md        # Phase 1 entities and state
├── quickstart.md        # Phase 1 validation guide
├── contracts/
│   └── approvals-api.md # Phase 1 HTTP contract for approve/reject
├── checklists/
│   └── requirements.md  # Spec quality checklist
└── tasks.md             # Phase 2 output (/speckit-tasks)
```

### Source Code (repository root)

```text
backend/
├── src/InvoiceApp.Domain/
│   ├── ApprovalLimits.cs            # new: 50,000.00 / 500,000.00
│   ├── ApprovalRoles.cs             # new: Manager, Director, Admin
│   ├── Approver.cs                  # new: record (Username, Role)
│   ├── ApprovalOutcome.cs           # new: Approved, FirstApprovalRecorded (US2)
│   ├── ApprovalRefusal.cs           # new: refusal codes
│   ├── ApprovalRefusedException.cs  # new: Exception with Reason
│   ├── ApprovalPolicy.cs            # new: pure decision function
│   ├── ApprovalService.cs           # changed: Approve(invoiceId, Approver); lock + TimeProvider (US2)
│   └── Invoice.cs                   # changed (US2): FirstApprovedBy, FirstApprovedAt
├── src/InvoiceApp.Api/
│   ├── Controllers/ApiControllerBase.cs     # 403 { error, code } for refusals
│   ├── Controllers/ApprovalsController.cs   # gate + Approver from session
│   ├── Auth/RequireRoleAttribute.cs         # JSON { error } on 403
│   ├── appsettings.json                     # demo users per role
│   ├── InMemoryInvoiceRepository.cs         # seed tweaks
│   ├── Program.cs                           # TimeProvider registration (US2)
│   └── wwwroot/app.js                       # "Awaiting second approval" note (US2)
└── tests/InvoiceApp.Tests/
    ├── ApprovalPolicyTests.cs       # new
    ├── ApprovalServiceTests.cs      # extended
    ├── FakeInvoiceRepository.cs     # UpdateCount
    └── InvoiceSnapshot.cs           # new helper

e2e/
├── pages/LoginPage.ts, InvoicesPage.ts, ApprovalsPage.ts   # new page objects
├── tests/approval-limits.spec.ts                           # new: refused over-limit approval
└── playwright.config.ts                                    # server reuse opt-in
```

**Structure Decision**: Keep the existing three-project layout (Domain, Api, Tests) plus `e2e/`. New
rule code is named `Approv*.cs` so the mutation scope `-m "**/Approv*.cs"` covers it automatically.

## Delivery steps

1. **US1, single-approver limits** (FR-001, FR-002, FR-005, FR-006, FR-009): policy, exception, service
   signature, API mapping, demo users, tests. Above 500,000.00 every approval is refused with
   `TwoApproversRequired`. Its own commit.
2. **Playwright test** for the refused over-limit approval (valid in both steps). Its own commit.
3. **US2, two approvers** (FR-003, FR-004, FR-007, FR-008): first-approval fields, policy branch,
   decision lock, TimeProvider, UI note, `demo.director2`, tests. `TwoApproversRequired` disappears;
   the compiler points at every test that must change. Its own commit.
4. **Hardening** from the Stryker run; then review fixes.

## Complexity Tracking

No constitution violations; nothing to justify.
