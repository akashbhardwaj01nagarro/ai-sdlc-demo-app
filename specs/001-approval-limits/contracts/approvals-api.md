# Contract: Approvals API

All endpoints require `Authorization: Bearer <token>` from `POST /api/auth/login`. The approver is
always the signed-in user; no request body field identifies the approver.

## POST /api/approvals/{invoiceId}/approve

Role gate: Manager, Director, Admin (Admin passes the gate so it gets the Domain's clear refusal).

| Situation | Status | Body |
| --- | --- | --- |
| Approved (final) | 200 | Invoice JSON, `status: "Approved"`, `decidedBy`, `decidedAt` |
| First of two approvals recorded (US2) | 200 | Invoice JSON, `status: "PendingApproval"`, `firstApprovedBy`, `firstApprovedAt` |
| Invoice not found | 404 | `{ "error": "Invoice INV-x was not found." }` |
| Invoice not pending | 409 | `{ "error": "Invoice INV-x is Approved; only pending invoices can be decided." }` |
| Refused by an approval rule | 403 | `{ "error": "Approval refused: …", "code": "<ApprovalRefusal>" }` |
| Role not allowed by the gate | 403 | `{ "error": "Your role (…) cannot do this. Allowed roles: …" }` |
| Not signed in | 401 | empty |

Refusal messages (amounts in invariant culture with thousands separators and two decimals, more when the
amount has more, never rounded: `60,000.00`, `50,000.001`):

- `RoleCannotApprove`: `Approval refused: invoice {id} cannot be approved by the {role} role. Only Managers and Directors can approve invoices.`
- `TwoApproversRequired` (US1 only): `Approval refused: invoice {id} is {amount}. Invoices above 500,000.00 need two approvers, which are not supported yet.`
- `AmountAboveRoleLimit`: `Approval refused: invoice {id} is {amount}, above the {limit} limit for the {role} role. A Director must approve it.`
- `SameApproverTwice` (US2): `Approval refused: you gave the first approval for invoice {id}, so the second approval must come from a different Director.`
- `DirectorRequired` (US2): `Approval refused: invoice {id} is above 500,000.00, so its second approval must come from a Director. Your role is {role}.`

## POST /api/approvals/{invoiceId}/reject

Unchanged behaviour: body `{ "reason": "…" }`, 200 with the rejected invoice, 400 without a reason,
404/409 as above. Not limited by role or amount; a recorded first approval is kept.

## Invoice JSON (US2 additions)

`firstApprovedBy` (string or null) and `firstApprovedAt` (ISO date-time or null) are added to every
invoice returned by `/api/invoices` and `/api/approvals/*`.
