# Research: Approval Limits by Role

All open questions were resolved during planning (design review by four independent design agents
and a critic, plus the product owner's answers). This file records each decision.

## R1. Where the rules live and how they avoid side effects

- **Decision**: A pure static `ApprovalPolicy.Decide(invoiceId, amount, firstApprovedBy, approver)` in
  Domain returns an `ApprovalOutcome` or throws `ApprovalRefusedException`. `ApprovalService` calls it
  after loading the invoice and before writing any field.
- **Rationale**: Both repositories hand out live objects, so any field assigned before a refusal leaks
  into the store even without `Update`. A policy that never receives the `Invoice` cannot write to it.
- **Alternatives considered**: Validation inside `ApprovalService.Approve` with careful ordering
  (fragile; one reordering reintroduces the bug); cloning the invoice before deciding (hides the bug
  instead of preventing it).

## R2. Representing roles and limits

- **Decision**: Roles stay strings (`ApprovalRoles.Manager`, `Director`, `Admin`) matched exactly;
  limits are `decimal` constants in `ApprovalLimits` (50,000.00 and 500,000.00), compared inclusively.
- **Rationale**: Sessions already carry the role as a string; exact matching fails closed for
  `manager`, `Approver` or anything unknown; `decimal` avoids rounding.
- **Alternatives considered**: An enum parsed in the controller (puts a rule-ish mapping in the API
  layer); a configurable limits table (not required, more surface to test).

## R3. Refusal contract

- **Decision**: `ApprovalRefusedException : Exception` with an `ApprovalRefusal` code; the API maps it
  to HTTP 403 with `{ error, code }`. `RequireRoleAttribute` also returns `{ error }` with its 403.
- **Rationale**: 409 already means "the invoice's state blocks everyone" (not pending); 403 means
  "this user may not, someone else could". Deriving from `InvalidOperationException` would silently
  turn refusals into 409. `Forbid()` throws without an authentication scheme (500).
- **Alternatives considered**: 409 (conflates two meanings), 422 (approve has no request body).

## R4. Order of checks and wording

- **Decision**: not found (404) → not pending (409) → role cannot approve → two approvers required
  (US1 only) → amount above role limit → same approver twice → director required. Messages start with
  "Approval refused:" and name the invoice, amount, limit and role; amounts use the invariant
  culture with thousands separators, two decimals, and every further significant decimal
  (`#,##0.00` plus optional digits), so a sub-cent amount is never rounded into the limit it exceeds.
- **Rationale**: state before identity; identity before amount; the same-user reason before the role
  reason because no change of role can fix it. Invariant formatting avoids "6,00,000.00" on en-IN.

## R5. First approver above 500,000

- **Decision**: A Manager or a Director may give the first approval; the second must be a different
  Director (product owner, planning). The check that would require a Director first is one commented
  line in `ApprovalPolicy`; tests that depend on this choice carry `[Trait("Clarification","Q1")]`.

## R6. Identity and concurrency

- **Decision**: Identity is the session username compared with `Trim()` and
  `StringComparison.OrdinalIgnoreCase`. In US2 the read-decide-write sequence of Submit, Approve and
  Reject runs under one static decision lock; time comes from an injected `TimeProvider`.
- **Rationale**: Treating two spellings of one user as different would break dual control; treating
  two users as one only asks for another Director, the safe mistake. Without the lock, two concurrent
  requests can leave one user as both `FirstApprovedBy` and `DecidedBy`. `TimeProvider` gives a seam
  to make the concurrency test deterministic and timestamps exact.
- **Alternatives considered**: Optimistic concurrency with a version field (right for a real
  database, more change than an in-memory demo needs; noted for the review).

## R7. Two-step delivery

- **Decision**: US1 ships first and refuses every approval above 500,000.00 with
  `TwoApproversRequired`; US2 replaces that refusal with the two-approver flow.
- **Rationale**: each commit is safe on its own; no window where one Director can approve
  600,000 alone.

## R8. Tests and mutation testing

- **Decision**: `FakeInvoiceRepository.UpdateCount`; `InvoiceSnapshot.Of` copies every property by
  reflection; literal boundary amounts; traits per rule; one Playwright test with page objects that
  asserts the 403 response, the alert text and the unchanged invoice after a reload. Stryker.NET
  4.13.0 runs on `Approv*.cs` before, after the feature and after hardening.
- **Rationale**: these are exactly the checks that catch the plausible-but-wrong implementations
  listed in the approval-rules skill (`<` vs `<=`, mutate-then-throw, comparing roles instead of
  users, case-sensitive identity, unchecked second approver).
