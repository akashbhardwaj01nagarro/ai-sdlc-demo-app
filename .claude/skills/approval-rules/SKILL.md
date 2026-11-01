---
name: approval-rules
description: The invoice approval limits by role (FR-001 to FR-005), how the code must apply them, the unit-test matrix and the plausible-but-wrong implementations to guard against. Use when implementing, testing or reviewing ApprovalPolicy, ApprovalService, Approver, approval limits, the two-approver rule, same-user checks or refused approval attempts.
---

# Approval rules

Source of truth: `specs/001-approval-limits/spec.md`, summarised in AGENTS.md.

| Rule | Invoice amount | Approval needed |
| --- | --- | --- |
| FR-001 | up to 50,000.00 | one Manager or one Director |
| FR-002 | 50,000.01 to 500,000.00 | one Director |
| FR-003 | above 500,000.00 | two different users: first a Manager or Director, second a Director |
| FR-004 | any | the same user never counts as both approvers |
| FR-005 | any | a refused attempt gives a clear reason and changes nothing |

Limits are inclusive and exact decimals. Identity is the session username, trimmed and compared case-insensitively. Admin and unknown roles cannot approve. Rejecting an invoice is not limited.

## Shape of the code

- `ApprovalPolicy.Decide(invoiceId, amount, firstApprovedBy, approver)` is a pure function of values. It returns an `ApprovalOutcome` or throws `ApprovalRefusedException` with an `ApprovalRefusal` code. It never sees the `Invoice`, so it cannot change it.
- `ApprovalService.Approve(invoiceId, approver)`: find, ensure pending, decide, then write, then `Update` once. Nothing that can refuse may run after the first write.
- Refusal order (first failure wins): not found (404), not pending (409), role cannot approve, two approvers required (step 1 only), amount above role limit, same approver twice, Director required.
- `ApprovalRefusedException` derives from `Exception`, not `InvalidOperationException`, so it maps to 403 `{ error, code }` and never to 409.
- Amounts in messages: `ToString("N2", CultureInfo.InvariantCulture)`.

## Test helpers

- `FakeInvoiceRepository.UpdateCount` counts `Update` calls.
- `InvoiceSnapshot.Of(invoice)` copies every property value by reflection, so new fields are covered automatically. Compare snapshots, never two references to the same object.
- Boundary amounts are literals: `50000.00m`, `50000.01m`, `500000.00m`, `500000.01m`. Never compute them from `ApprovalLimits`.
- Tag every test `[Trait("Rule", "FR-00x")]`. Tests that depend on the "Manager may give the first approval" clarification also get `[Trait("Clarification", "Q1")]`.

## Minimum matrix

- FR-001: Manager approves 0.01 and 50,000.00; refused at 50,000.01 with the exact reason.
- FR-002: Director approves 50,000.01 and 500,000.00; Manager refused at 500,000.00.
- FR-003: 500,000.01 by a Manager or Director records the first approval and stays pending; a different Director completes it; a Manager or Admin as second approver is refused.
- FR-004: same user twice is refused, including `DEMO.Director` and ` demo.director ` variants; a refusal keeps the existing first approval; two concurrent approvals by one user cannot both count.
- FR-005: every refusal leaves the full snapshot equal and `UpdateCount == 0`; the reason names the invoice and the rule that applied, with its facts (role, limit or first approver); a refusal never sets `Rejected`.
- Roles: Admin, the legacy `Approver`, `manager` (wrong case) and an empty role are refused.

## Traps: wrong code that looks right, and the test that catches it

| Wrong implementation | Caught by |
| --- | --- |
| `amount < 50000m` instead of `<=` | Manager approves exactly 50,000.00 |
| two-approver threshold `>= 500000m` | Director approves exactly 500,000.00 alone |
| rounding or casting the amount before comparing | refusal at 50,000.01 |
| default-allow for unknown roles | Admin and `manager` refused |
| one Director approves above 500,000 alone | first approval leaves the invoice pending |
| same-user check compares roles, or `DecidedBy`, instead of `FirstApprovedBy` | two distinct Directors approve; same Director twice refused |
| case-sensitive or untrimmed username comparison | `DEMO.Director` / ` demo.director ` refused |
| second approver's role not checked | Manager as second approver refused |
| a field written before a check that throws (the repository returns live objects) | snapshot equal after refusal |
| `Update` called on refusal, or skipped on success | `UpdateCount` assertions |
| refusal sets `Rejected` or `DecisionNote` | snapshot equal after refusal |
| refusal mapped through `InvalidOperationException` (409) or `Forbid()` (500) | API status 403 with `code` |
| culture-dependent number formatting | message contains `250,000.00` under `en-IN` |
