# Data Model: Approval Limits by Role

## Invoice (existing, extended in US2)

| Field | Type | Notes |
| --- | --- | --- |
| Id | string | `INV-####` |
| CustomerName | string | |
| Amount | decimal | compared exactly against the limits |
| Status | Draft, PendingApproval, Approved, Rejected | unchanged lifecycle |
| CreatedAt | DateTime (UTC) | |
| FirstApprovedBy | string? | **US2.** Username of the first approval of an invoice above 500,000.00 |
| FirstApprovedAt | DateTime? (UTC) | **US2.** Time of the first approval |
| DecidedBy | string? | final approver, or the user who rejected |
| DecidedAt | DateTime? (UTC) | time of the final decision |
| DecisionNote | string? | rejection reason |

Validation: a refused approval leaves every field above unchanged (FR-005).

### State transitions for an approval attempt

```text
PendingApproval, amount <= 500,000.00
  └─ allowed approver ............................ → Approved (DecidedBy, DecidedAt)
PendingApproval, amount > 500,000.00, FirstApprovedBy = null
  └─ Manager or Director ......................... → PendingApproval (FirstApprovedBy, FirstApprovedAt)   [US2]
PendingApproval, amount > 500,000.00, FirstApprovedBy set
  └─ a different user who is a Director .......... → Approved (DecidedBy, DecidedAt; first approval kept) [US2]
Any refused attempt .............................. → no change
Reject (any role allowed by the gate) ............ → Rejected (first approval kept)
```

In US1 every attempt above 500,000.00 is refused (`TwoApproversRequired`).

## Approver (new, value object)

| Field | Type | Notes |
| --- | --- | --- |
| Username | string | from the signed-in session, never from a request body |
| Role | string | `Manager`, `Director`, or any other value (refused) |

Identity comparison: `Trim()` + case-insensitive.

## ApprovalLimits (new, constants)

| Role | Approves alone up to |
| --- | --- |
| Manager | 50,000.00 |
| Director | 500,000.00 |

## ApprovalRefusal (new, codes)

| Code | When | Story |
| --- | --- | --- |
| RoleCannotApprove | role is not Manager or Director | US1 |
| TwoApproversRequired | amount above 500,000.00 before US2 exists | US1 only |
| AmountAboveRoleLimit | Manager and 50,000.00 < amount ≤ 500,000.00 | US1 |
| SameApproverTwice | second approval by the first approver | US2 |
| DirectorRequired | second approval by a non-Director | US2 |

## ApprovalOutcome (new)

`Approved` (final decision recorded) and, in US2, `FirstApprovalRecorded` (invoice stays pending).
