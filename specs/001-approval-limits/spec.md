# Feature Specification: Approval Limits by Role

**Feature Branch**: `001-approval-limits`

**Created**: 2026-11-01

**Status**: Draft

**Input**: User description: "Approval limits by role for the invoice approval service (short name: approval-limits). A Manager may approve invoices up to 50,000. A Director may approve invoices up to 500,000. Anything above 500,000 needs two distinct approvers, and the second approver must be a Director. The same user may never count as both approvers on one invoice. A rejected approval attempt returns a clear reason, and nothing about the invoice changes. Use these requirement IDs: FR-001 Manager limit; FR-002 Director limit; FR-003 two approvers above 500,000 with a Director as the second; FR-004 the same user never counts as both approvers; FR-005 a refused attempt returns a clear reason and changes nothing. User story 1 (P1): single-approver limits (FR-001, FR-002, FR-005), where amounts above 500,000 are safely refused until story 2 exists. User story 2 (P2): the two-approver rule above 500,000 (FR-003, FR-004). Decisions already taken with the product owner: limits are inclusive; the first of the two approvals may come from a Manager or a Director; the approver is identified by the signed-in username, compared trimmed and case-insensitively; only Manager and Director can approve, Admin and unknown roles are refused; rejecting an invoice is not limited by role; a refused attempt is not a rejection and never sets the invoice to Rejected."

## Clarifications

### Session 2026-11-01

- Q: For an invoice above 500,000, who may give the first of the two approvals? → A: A Manager or a Director; the second must be a different user who is a Director (answered by the product owner during planning; applied in FR-003).
- Q: Which roles may approve invoices? → A: Only Manager and Director; Admin and unknown roles are refused, and Admin keeps rejecting and deleting (accepted by the product owner with the implementation plan; applied in FR-006).
- Q: Are the limits inclusive? → A: Yes; 50,000.00 and 500,000.00 are within the limit and amounts are compared exactly (accepted with the implementation plan; applied in FR-001, FR-002 and Edge Cases).
- Q: How is "the same user" decided? → A: By the signed-in username, ignoring letter case and surrounding spaces (accepted with the implementation plan; applied in FR-004).
- Q: Is rejecting an invoice limited by role or amount? → A: No; rejection works as today (accepted with the implementation plan; applied in FR-007).
- Q: Should a Manager still see the Approve button on invoices above 50,000? → A: Yes; every approver sees Approve on every pending invoice, the system refuses an over-limit attempt and the page shows the reason (asked in this clarification session; applied in FR-009 and User Story 1).

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Approve within my authority (Priority: P1)

As a Manager or a Director I approve pending invoices up to my own limit in one step, and when an invoice is above my limit the system refuses my approval, tells me exactly why and who has to approve it instead, and leaves the invoice exactly as it was.

**Why this priority**: Today any approver can approve any amount. Limits by role are the control the finance team needs first; without them the two-approver rule has nothing to build on. Refusing safely (no partial change) is part of the same control.

**Independent Test**: Sign in as a Manager and as a Director, approve invoices at and just above each limit, and check that permitted approvals complete and refused ones show a reason while the invoice stays pending and unchanged. Invoices above 500,000 are refused for everyone until User Story 2 exists, so this story is safe to release on its own.

**Acceptance Scenarios**:

1. **Given** a pending invoice of 50,000.00, **When** a Manager approves it, **Then** it is approved and records the Manager as the approver and the time of approval. *(FR-001)*
2. **Given** a pending invoice of 50,000.01, **When** a Manager approves it, **Then** the approval is refused with a reason naming the Manager limit of 50,000.00, the invoice and its amount, and that a Director must approve it; the reason is shown on the approval screen, and the invoice is unchanged and still offered for approval. *(FR-001, FR-005, FR-009)*
3. **Given** a pending invoice of 500,000.00, **When** a Director approves it, **Then** it is approved by that Director. *(FR-002)*
4. **Given** a pending invoice of 50,000.01, **When** a Director approves it, **Then** it is approved by that Director. *(FR-002)*
5. **Given** a pending invoice of any amount, **When** a user whose role is neither Manager nor Director (for example Admin) approves it, **Then** the approval is refused with a reason saying that role cannot approve invoices, and the invoice is unchanged. *(FR-005, FR-006)*
6. **Given** a pending invoice of 500,000.01 and only User Story 1 in place, **When** a Manager or a Director approves it, **Then** the approval is refused with a reason saying the invoice needs two approvers, and the invoice is unchanged. *(FR-005)*

---

### User Story 2 - Two approvers above 500,000 (Priority: P2)

As a finance organisation we require two different people to approve any invoice above 500,000, the second of whom must be a Director, so that no single person can release a very large payment.

**Why this priority**: It completes the control for the largest invoices. It builds on User Story 1's limits and refusal behaviour.

**Independent Test**: With a pending invoice of 500,000.01, give a first approval as a Manager or a Director and check that the invoice stays pending and shows who gave the first approval; try a second approval as the same user, as a Manager and as a different Director, and check that only the different Director completes the approval.

**Acceptance Scenarios**:

1. **Given** a pending invoice of 500,000.01 with no approvals, **When** a Manager or a Director approves it, **Then** the first approval is recorded with that user and time, and the invoice stays pending. *(FR-003)*
2. **Given** an invoice of 600,000 with a first approval by one user, **When** a different user who is a Director approves it, **Then** the invoice is approved, keeps the record of the first approval, and records the Director as the final approver. *(FR-003)*
3. **Given** an invoice of 600,000 with a first approval by a Director, **When** a Manager approves it, **Then** the approval is refused with a reason saying the second approval must come from a Director, and the invoice, including its first approval, is unchanged. *(FR-003, FR-005)*
4. **Given** an invoice of 600,000 with a first approval by `demo.director`, **When** the same user approves it again, including as `DEMO.Director` or ` demo.director ` (case or surrounding spaces changed), **Then** the approval is refused with a reason saying the second approval must come from a different Director, and the invoice is unchanged. *(FR-004, FR-005)*
5. **Given** an invoice of 600,000 awaiting its second approval, **When** two approvals by the same user arrive at the same moment, **Then** at most one of them is recorded and the invoice is never approved with that user as both approvers. *(FR-004)*
6. **Given** an invoice of 600,000 awaiting its second approval, **When** an approver rejects it with a reason, **Then** it is rejected as today and the record of the first approval is kept. *(FR-007)*

---

### Edge Cases

- Amounts exactly on a limit (50,000.00 and 500,000.00) are within the limit; one cent more (50,000.01 and 500,000.01) is above it. Amounts are compared exactly, never rounded.
- An approval attempt on an invoice that does not exist or is not pending fails as it does today (not found, or wrong state), before any limit is checked.
- A refused attempt never turns into a rejection: the invoice never becomes Rejected because of a refused approval.
- A refused second approval never removes or replaces the existing first approval.
- After a refused attempt the invoice can still be approved by someone who is allowed to.
- Role names are matched exactly; a role spelled differently (for example `manager`) is not a Manager.
- Amounts in reasons are shown with two decimals and thousands separators, independent of the reader's regional settings.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: The system MUST allow a Manager to approve, on their own, a pending invoice of up to 50,000.00 inclusive, and MUST refuse a Manager's approval of a larger invoice.
- **FR-002**: The system MUST allow a Director to approve, on their own, a pending invoice of up to 500,000.00 inclusive.
- **FR-003**: For a pending invoice above 500,000.00 the system MUST require two approvals from two different users. The first approval MAY come from a Manager or a Director and MUST leave the invoice pending while recording who approved and when. The second approval MUST come from a Director and approves the invoice.
- **FR-004**: The system MUST NOT let the same user count as both approvers of one invoice. A user is identified by the signed-in username, compared ignoring letter case and surrounding spaces. This MUST hold for repeated and for simultaneous attempts.
- **FR-005**: When an approval attempt is refused, the system MUST return a clear reason that names the invoice and the rule that applied, with the facts it applied to (the approver's role, the limit or the first approver), and MUST leave every attribute of the invoice exactly as it was. A refused attempt MUST NOT reject the invoice.
- **FR-006**: Only users with the role Manager or Director MAY approve invoices; every other role, including Admin and unknown roles, MUST be refused under FR-005.
- **FR-007**: Rejecting a pending invoice MUST remain available as today, independent of role and amount; when an invoice awaiting its second approval is rejected, the record of its first approval MUST be kept.
- **FR-008**: Approvers MUST be able to see that an invoice is awaiting a second approval and who gave the first approval.
- **FR-009**: The approval screen MUST offer Approve on every pending invoice to every approver; whether an approval is allowed is decided by the system when it is attempted, and the reason for a refusal MUST be shown to the approver on that screen.

### Key Entities

- **Invoice**: an amount owed by a customer, moving from Draft to Pending Approval to Approved or Rejected. For this feature it additionally records the first approval of a two-approval invoice (who and when) next to the final decision (who and when).
- **Approver**: the signed-in user attempting an approval, identified by username and role (Manager, Director or another role).
- **Approval limit**: the largest amount a role may approve on its own: 50,000.00 for a Manager and 500,000.00 for a Director.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: 100% of approval attempts at the boundary amounts (50,000.00, 50,000.01, 500,000.00, 500,000.01) for each role produce the outcome in the rules above.
- **SC-002**: In 100% of refused attempts, every attribute of the invoice is identical before and after the attempt.
- **SC-003**: Zero invoices above 500,000.00 reach Approved without two different approvers, the second a Director, including when the same user retries or sends two approvals at once.
- **SC-004**: In 100% of refused attempts, the message alone tells the approver which rule applied and who has to approve instead, without consulting anyone.
- **SC-005**: Approving an invoice within one's own limit takes the same number of steps as before the feature.

## Assumptions

- Amounts are in a single currency; currency conversion is out of scope.
- The existing sign-in and sessions are reused; a user has exactly one role. One person holding two accounts is outside what the system can detect.
- Existing demo accounts are adjusted for the new roles: a Manager (`demo.manager`), two Directors (`demo.director`, `demo.director2`) and the Admin (`demo.admin`); the former generic Approver role no longer approves.
- Admin keeps its existing rights to reject and delete invoices but cannot approve.
- Bulk approval (UC-1) and partial approval (UC-2) are out of scope.
- Notifications are out of scope; the state of an invoice is visible in the application.
