---

description: "Task list for Approval Limits by Role"
---

# Tasks: Approval Limits by Role

**Input**: Design documents from `specs/001-approval-limits/`

**Prerequisites**: plan.md, spec.md, research.md, data-model.md, contracts/approvals-api.md, quickstart.md

**Tests**: Required. The constitution (Principle III) makes tests first for every rule, and the spec's
acceptance scenarios are written as tests. Within each story, test-author writes the tests first,
domain-implementer makes them pass, then test-critic reviews every test.

**Organization**: One phase per user story; each story phase is one commit that builds and passes on
its own. Agents get one phase per prompt, never the whole feature (`/speckit-implement` is not used).

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies)
- **[Story]**: Which user story this task belongs to (US1, US2)

## Path Conventions

Web app per plan.md: `backend/src/InvoiceApp.Domain`, `backend/src/InvoiceApp.Api`,
`backend/tests/InvoiceApp.Tests`, `e2e/`.

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Tooling and baselines (already committed before this task list).

- [x] T001 Extend AGENTS.md with the approval rules, layering, commands and review expectations in AGENTS.md
- [x] T002 Add subagents, skills and logging/guard hooks in .claude/ and .githooks/
- [x] T003 [P] Pin Stryker.NET 4.13.0 in .config/dotnet-tools.json and configure backend/tests/InvoiceApp.Tests/stryker-config.json
- [x] T004 Record the "before" mutation scores in docs/mutation/01-baseline-approval.md and docs/mutation/01-baseline-whole.md

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Test helpers every rule test needs. Delivered in the US1 commit.

- [x] T005 [P] Add `public int UpdateCount { get; private set; }` incremented by `Update` (still storing nothing) in backend/tests/InvoiceApp.Tests/FakeInvoiceRepository.cs
- [x] T006 [P] Create `InvoiceSnapshot.Of(Invoice)` that copies every public property value by reflection and throws for non-value, non-string properties, in backend/tests/InvoiceApp.Tests/InvoiceSnapshot.cs

**Checkpoint**: helpers compile; existing 7 tests still pass.

---

## Phase 3: User Story 1 - Approve within my authority (Priority: P1) 🎯 MVP

**Goal**: Manager approves alone up to 50,000.00, Director up to 500,000.00; every other role and
every amount above 500,000.00 is refused with a clear reason and no change (FR-001, FR-002, FR-005,
FR-006, FR-009).

**Independent Test**: `dotnet test backend/InvoiceApp.sln --filter "Rule=FR-001|Rule=FR-002|Rule=FR-005"`
passes; manually, demo.manager is refused on 60,000 with the reason shown and the invoice unchanged.

### Tests for User Story 1 (test-author, written first)

- [x] T007 [P] [US1] Write `ApprovalPolicyTests` with literal boundaries: Manager approves 0.01 and 50,000.00, refused at 50,000.01 and 500,000.00 (`AmountAboveRoleLimit`, exact message); Director approves 50,000.01 and 500,000.00; Manager and Director refused at 500,000.01 (`TwoApproversRequired`); Admin, `Approver`, `manager`, `Director ` and empty role refused (`RoleCannotApprove`); amounts formatted invariantly under en-IN and de-DE, sub-cent amounts shown exactly; each test tagged `[Trait("Rule","FR-00x")]`, in backend/tests/InvoiceApp.Tests/ApprovalPolicyTests.cs
- [x] T008 [P] [US1] Extend `ApprovalServiceTests`: existing tests pass an `Approver`; approval within limit sets Status, DecidedBy, DecidedAt and `UpdateCount == 1`; a `[Theory]` of refused attempts (Manager 50,000.01, Admin 100, Director 500,000.01) asserts the exception type, the reason code, an equal `InvoiceSnapshot` and `UpdateCount == 0`; 404 and 409 checked before authority; mutant-killers for `Update` in Submit and Reject, for Reject's DecidedBy/DecidedAt and for Reject on a non-pending invoice, in backend/tests/InvoiceApp.Tests/ApprovalServiceTests.cs

### Implementation for User Story 1 (domain-implementer)

- [x] T009 [P] [US1] Create `ApprovalLimits` (`ManagerLimit = 50_000m`, `DirectorLimit = 500_000m`) in backend/src/InvoiceApp.Domain/ApprovalLimits.cs
- [x] T010 [P] [US1] Create `ApprovalRoles` (Manager, Director, Admin string constants) in backend/src/InvoiceApp.Domain/ApprovalRoles.cs
- [x] T011 [P] [US1] Create `record Approver(string Username, string Role)` in backend/src/InvoiceApp.Domain/Approver.cs
- [x] T012 [P] [US1] Create `ApprovalOutcome { Approved }` in backend/src/InvoiceApp.Domain/ApprovalOutcome.cs and `ApprovalRefusal { RoleCannotApprove, AmountAboveRoleLimit, TwoApproversRequired }` in backend/src/InvoiceApp.Domain/ApprovalRefusal.cs
- [x] T013 [P] [US1] Create `ApprovalRefusedException : Exception` with an `ApprovalRefusal Reason` property in backend/src/InvoiceApp.Domain/ApprovalRefusedException.cs
- [x] T014 [US1] Create static `ApprovalPolicy.Decide(invoiceId, amount, approver)` with the refusal order and messages from contracts/approvals-api.md in backend/src/InvoiceApp.Domain/ApprovalPolicy.cs
- [x] T015 [US1] Change `ApprovalService.Approve(string invoiceId, Approver approver)` to find, ensure pending, decide, then write and `Update` once; remove the old overload, in backend/src/InvoiceApp.Domain/ApprovalService.cs
- [x] T016 [US1] Map `ApprovalRefusedException` to `StatusCode(403, new { error, code })` before the other catches in backend/src/InvoiceApp.Api/Controllers/ApiControllerBase.cs
- [x] T017 [US1] Build the `Approver` from the session; approve has no role gate so every role reaches the Domain (review R-04), and reject is gated to Manager, Director and Admin in backend/src/InvoiceApp.Api/Controllers/ApprovalsController.cs
- [x] T018 [P] [US1] Return a JSON `{ error }` body with the 403 in backend/src/InvoiceApp.Api/Auth/RequireRoleAttribute.cs
- [x] T019 [P] [US1] Replace demo.approver with demo.manager (Manager) and demo.director (Director) in backend/src/InvoiceApp.Api/appsettings.json; set seed INV-1003 `DecidedBy` to demo.manager in backend/src/InvoiceApp.Api/InMemoryInvoiceRepository.cs
- [x] T020 [P] [US1] Update demo accounts in README.md and AGENTS.md

### Review for User Story 1

- [x] T021 [US1] test-critic reviews every US1 test; fix each weakness it confirms; record the review in docs/evidence/test-review/us1.md and us1-critic.json

**Checkpoint**: US1 complete, committed as `feat(approvals): enforce single-approver limits by role`.

---

## Phase 4: End-to-end test for the refused over-limit approval (FR-001, FR-005, FR-009)

**Goal**: One Playwright test proves the refusal through the UI and the server.

**Independent Test**: `cd e2e && npx playwright test` passes against a freshly started app.

- [x] T022 [P] [US1] Create page objects `LoginPage`, `InvoicesPage`, `ApprovalsPage` with role and label locators only, in e2e/pages/
- [x] T023 [US1] Write e2e/tests/approval-limits.spec.ts: demo.manager creates and submits a uniquely named 60,000 invoice, approves it, the test asserts the 403 response with `code: AmountAboveRoleLimit`, the exact alert text, and after `page.reload()` the invoice is still Pending Approval with the same amount and still offered for approval
- [x] T024 [P] [US1] Reuse a running server only when `PW_REUSE_SERVER=1` and add `PW_SLOWMO` for demos in e2e/playwright.config.ts

**Checkpoint**: committed as `test(e2e): refuse an over-limit approval through the UI`.

---

## Phase 5: User Story 2 - Two approvers above 500,000 (Priority: P2)

**Goal**: Above 500,000.00 a first approval (Manager or Director) is recorded and the invoice stays
pending; a different Director completes it; the same user never counts twice, also under
concurrency (FR-003, FR-004, FR-007, FR-008).

**Independent Test**: `dotnet test backend/InvoiceApp.sln --filter "Rule=FR-003|Rule=FR-004"` passes;
manually, the 640,000 scenario in quickstart.md behaves as described.

### Tests for User Story 2 (test-author, written first)

- [x] T025 [P] [US2] Extend `ApprovalPolicyTests`: Manager and Director give the first approval at 500,000.01 (`FirstApprovalRecorded`; Manager case tagged Clarification Q1); a different Director completes it; same user refused (`SameApproverTwice`) including `DEMO.Director` and ` demo.director `, and before the role rule; Manager and Admin refused as second approver (`DirectorRequired`, `RoleCannotApprove`); remove the `TwoApproversRequired` tests, in backend/tests/InvoiceApp.Tests/ApprovalPolicyTests.cs
- [x] T026 [P] [US2] Extend `ApprovalServiceTests`: first approval keeps the invoice pending and sets FirstApprovedBy/At with `UpdateCount == 1`; second Director approves and keeps both names; same Director twice refused with `UpdateCount` unchanged; a refusal does not consume or clear the first approval; Manager first then Director (Q1); Reject while awaiting the second approval keeps the first approval; refused-attempt theory gains same-user and Manager-second rows; a concurrency test with a blocking `TimeProvider` proves the decision lock, in backend/tests/InvoiceApp.Tests/ApprovalServiceTests.cs

### Implementation for User Story 2 (domain-implementer)

- [x] T027 [P] [US2] Add `FirstApprovedBy` (string?) and `FirstApprovedAt` (DateTime?) in backend/src/InvoiceApp.Domain/Invoice.cs
- [x] T028 [US2] Add `FirstApprovalRecorded`, `SameApproverTwice`, `DirectorRequired`; remove `TwoApproversRequired`; add the two-approver branch to `ApprovalPolicy.Decide(invoiceId, amount, firstApprovedBy, approver)` with the commented Q1 line, in backend/src/InvoiceApp.Domain/ApprovalOutcome.cs, ApprovalRefusal.cs and ApprovalPolicy.cs
- [x] T029 [US2] Record the first approval or the final decision after `Decide`; run Submit, Approve and Reject inside one decision gate per repository instance; take time from an injected `TimeProvider` (default `TimeProvider.System`), in backend/src/InvoiceApp.Domain/ApprovalService.cs
- [x] T030 [P] [US2] Register `TimeProvider.System` in backend/src/InvoiceApp.Api/Program.cs
- [x] T031 [P] [US2] Show "Awaiting second approval (first: X)" as a text node for invoices with `firstApprovedBy`, keeping the Approve button and its label, in backend/src/InvoiceApp.Api/wwwroot/app.js
- [x] T032 [P] [US2] Add demo.director2 (Director) and a 640,000 pending seed invoice in backend/src/InvoiceApp.Api/appsettings.json and InMemoryInvoiceRepository.cs; update README.md and AGENTS.md demo accounts

### Review for User Story 2

- [x] T033 [US2] test-critic and review-rules review the US2 change in parallel; fix each confirmed weakness (including a Playwright test of the two-approver flow in e2e/tests/two-approvers.spec.ts); record the review in docs/evidence/test-review/us2.md and us2-critic.json

**Checkpoint**: US2 complete, committed as `feat(approvals): require two distinct approvers above 500,000`.

---

## Phase 6: Polish & Cross-Cutting Concerns

- [x] T034 Run Stryker (`-m "**/Approv*.cs"` and whole project) and save docs/mutation/02-after-feature-*.md
- [x] T035 mutation-analyst triages every surviving approval mutant; add the missing tests; save docs/mutation/03-after-hardening-*.md
- [ ] T036 Run scripts/per-commit-tests.sh and save docs/evidence/per-commit-tests.txt
- [ ] T037 Open the pull request on the fork; pr-reviewer reviews it; save docs/review/round-1.json and .md; record a verdict for every finding in the PR description
- [ ] T038 Backfill, re-redact, render and audit the AI log in ai-logs/; write ASSIGNMENT.md

---

## Dependencies & Execution Order

- Phase 1 → Phase 2 → Phase 3 (US1) → Phase 4 (e2e) → Phase 5 (US2) → Phase 6.
- US2 depends on US1 (it replaces the `TwoApproversRequired` refusal and reuses the policy, exception
  and API mapping). The e2e test depends on US1 only and stays valid after US2.
- Within a story: tests (T007–T008, T025–T026) before implementation; models before policy before
  service before API; review last.

## Parallel Opportunities

- US1: T007 and T008 together (different test files); T009–T013 together (separate new files);
  T018–T020 together.
- e2e: T022 and T024 together.
- US2: T025 and T026 together; T027, T030, T031, T032 together.

## Implementation Strategy

- **MVP**: Phases 2–3 (US1). It is safe on its own because every approval above 500,000.00 is
  refused, so no single person can approve a very large invoice.
- **Increment 2**: the Playwright test (Phase 4).
- **Increment 3**: US2 completes the control.
- Each increment is one commit, prompted separately, verified with build + unit tests (+ e2e where
  UI-visible) before committing.
