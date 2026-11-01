# Test review: User Story 2 (task T033)

User Story 2 ran as one workflow:

1. `test-author` wrote the tests first.
2. `domain-implementer` made them pass.
3. Two read-only reviewers then ran in parallel:
   - `test-critic` (tests): [us2-critic.json](us2-critic.json), 32 tests, 28 keep, 4 strengthen, 5 missing cases.
   - `review-rules` (an adversarial attempt to break FR-003, FR-004 and FR-005): [us2-rules-review.md](us2-rules-review.md), 0 findings.

Both reports validate against their schemas with 0 problems.

The orchestrating session made the decisions below on the human's behalf, following AGENTS.md. The agent proposes, and the decision is recorded with its reason. The fixes ran as a second workflow: `test-author` on the unit tests and `e2e-author` on a new Playwright test, in parallel.

Unit tests: 60 at the end of US1, 81 after US2, 97 after the review. All pass.

## review-rules: what the adversarial reviewer tried

It traced every path at 50,000.00, 50,000.01, 500,000.00 and 500,000.01 for Manager, Director and Admin, and then attacked the running API:

- **Same user, 25 approvals at once:** exactly one counted; the other 24 were refused with SameApproverTwice.
- **Mixed users, 40 rounds:** each round sent 27 simultaneous approvals from both Directors, the Manager and the Admin. Every invoice ended Approved by two different users with a Director second.
- **Reject racing approvals, 20 rounds:** exactly one decision succeeded each time, and the first approval was kept.

It found no defect.

## test-critic: verdicts and decisions

| Item | Critic | Decision | Outcome |
| --- | --- | --- | --- |
| `Approve_RefusedAttemptGivesTheReasonAndChangesNothing`: no refused *first* approval above 500,000 (a service that records the first approval before the policy refuses would leave `demo.admin` as first approver, and one Director could finish alone) | strengthen | accepted | Rows added: Admin at 600,000.00 and `manager` at 500,000.01 with no first approval; Admin against a seeded first approval; `DEMO.Director` and ` demo.director ` against a seeded `demo.director`. Each row asserts the exact message, a full snapshot and `UpdateCount == 0`. |
| `Decide_RefusesTheRoleBeforeCheckingTheAmount`: only Admin tries a first approval | strengthen | accepted | Role × amount theory: Admin, Approver, `manager`, `Director ` and the empty role, each at 500,000.01 and 600,000.00 |
| `Decide_RefusesTheFirstApproverAsTheSecondApprover`: case folding could depend on the culture | strengthen | accepted | New `Decide_RecognisesTheFirstApproverIndependentOfTheCurrentCulture` runs under tr-TR (`DEMO.DIRECTOR` vs `demo.director`), with a guard |
| `Decide_DirectorApprovesExactlyTheDirectorLimit`: `--filter Rule=FR-003` had no at-limit case | strengthen | accepted | FR-003 trait added here and on `Decide_RefusesManagerAtTheDirectorLimit` |
| Missing: Reject racing a final approval (FR-007) | missing | accepted | `Reject_WaitsForAConcurrentFinalApprovalAndFindsTheInvoiceApproved` |
| Missing: the "Awaiting second approval" note (FR-008) has no Playwright test, although AGENTS.md asks for one for UI-visible behaviour | missing | accepted | `e2e/tests/two-approvers.spec.ts` |
| The other 28 tests | keep | kept | — |

`test-author` checked each new row against a hand-made wrong implementation in a scratch copy of the code:

- Every wrong implementation that the old 81 tests let through now fails at least one of the 97.
- The correct alternative `ToLowerInvariant()` still passes.
- Earlier, while writing the US2 tests, 34 of 35 wrong implementations failed at least one test.
- The one survivor was Submit outside the gate, which cannot break a rule.

## Sabotage runs on the real code

| Change, applied temporarily and reverted | Result |
| --- | --- |
| The decision gate made private to each request (`_decisionGate = new object()`), so there is no shared gate | 3 of 3 concurrency tests fail. The main message: "demo.director counted as both the first and the second approver of INV-2001." All pass again after the revert. |
| Without any gate (test-author, 20 runs) | 20 of 20 fail; with the gate, 20 of 20 pass |

## Two-approver Playwright test (`e2e/tests/two-approvers.spec.ts`)

1. `demo.director` creates and submits its own 640,000 invoice.
2. Its approval records the first approval (status 200, still PendingApproval).
3. The Approvals tab shows "Awaiting second approval (first: demo.director)".
4. A repeat approval by `demo.director` gets 403 SameApproverTwice with the exact alert text, and after a reload the invoice is unchanged in every field.
5. `demo.director2` completes the approval, and both names are kept.

The test uses role and label locators only.

e2e-author noted an accessibility gap, left for the PR review: the note is not linked to the Approve button (`aria-describedby`).
