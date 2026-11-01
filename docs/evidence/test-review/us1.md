# Test review: User Story 1 (task T021)

- **Reviewer**: `test-critic` subagent, read-only, asked for each test which wrong implementation it
  catches. Raw report: [us1-critic.json](us1-critic.json) (27 test methods, 6 missing cases). It
  validates against the `test-critique` schema with 0 problems.
- **Decisions**: made by the orchestrating session on the human's behalf, following AGENTS.md (the
  agent proposes, the decision is recorded with its reason). Fixes were made by `test-author` (tests)
  and `domain-implementer` (production code), each in a separate scoped prompt.
- **Result**: 41 test cases before the review, 60 after; all pass.

## Verdicts on existing tests

| Test | Critic verdict | Decision | What changed |
| --- | --- | --- | --- |
| `Submit_RejectsInvoiceThatIsNotADraft` | strengthen | accepted | Theory over PendingApproval, Approved, Rejected; snapshot equal and `UpdateCount == 0` |
| `Approve_SetsStatusApproverAndTimestamp` | replace (strict subset) | accepted | Removed; row Director at 50,000.01 added to the success theory |
| `Approve_RejectsInvoiceThatIsStillADraft` | replace (type-only) | accepted | Removed; row Manager at 50,000.00 on a Draft added to the wrong-state theory, which now asserts the 409 message |
| `Approve_ThrowsWhenInvoiceDoesNotExist` | delete (duplicate) | accepted | Removed |
| `Approve_ReportsNotFoundBeforeCheckingTheApprover` | strengthen | accepted | Seeds INV-2001, approves INV-404 as Admin, asserts the exact 404 message, the INV-2001 snapshot and `UpdateCount == 0` |
| `Reject_RecordsReasonAndApprover` | strengthen | accepted | Asserts `DecidedBy`; the retired `demo.approver` name replaced |
| `Reject_RequiresAReason` | strengthen | accepted | Asserts `ParamName == "reason"`, snapshot equal, `UpdateCount == 0` |
| 20 other tests | keep | kept | — |

## Missing cases

| Rule | Missing case (critic) | Decision | Outcome |
| --- | --- | --- | --- |
| FR-001 | Sub-cent amount above the Manager limit (50,000.001): rounding to cents before comparing passed the whole suite | accepted | `Decide_RefusesManagerASubCentAboveTheManagerLimit`; plus a production change: reasons show the exact amount (`50,000.001`), because N2 printed "50,000.00, above the 50,000.00 limit" |
| FR-002 | Sub-cent amount above the two-approver threshold (500,000.001) | accepted | `Decide_RefusesDirectorASubCentAboveTheDirectorLimit` and an exact-message row |
| FR-005 | After a refusal, someone allowed can still approve | accepted | `Approve_RefusedAttemptLeavesTheInvoiceApprovableByAnAllowedApprover` |
| FR-005 | API maps a refusal to 403 `{ error, code }` (the test project references Domain only) | deferred | Covered by the Playwright test (T023), which asserts the 403 and `code`; the Admin path was checked by a manual API smoke test |
| FR-005 | Guard that `InvoiceSnapshot` captures every property | accepted | `InvoiceSnapshotTests.Of_CoversEveryPublicPropertyOfInvoice` |
| FR-007 | Rejecting is not limited by amount | accepted | `Reject_IsNotLimitedByAmount` |

## Further gaps found while fixing (test-author)

| Gap | Outcome |
| --- | --- |
| A snapshot that ignores values or follows the live invoice would let every refusal test pass vacuously | `Of_CopiesTheValueOfEveryProperty`, `Of_ChangesWhenAnyOnePropertyChanges` (one row per property) |
| A formatter that prints every stored decimal (`50,000.0100`) | Row 50000.0100m expects `50,000.01` |
| Sub-cent amounts formatted in the current culture | de-DE row 250000.001m expects `250,000.001` |

Each new test was checked against hand-made wrong implementations in a scratch copy of the code:
37 for the first round and 16 + 7 for the follow-ups, every one caught.

## Note on the report-format hook

The critic's report was not checked by the `SubagentStop` hook in its frontmatter. In this harness a
subagent returns its report through a `SubagentHandback` tool call, so the final message the hook
reads is empty, and no block happened. The report was validated after the fact (0 problems), and the
check now also runs as a `PreToolUse` hook on `SubagentHandback` in `.claude/settings.json`, which
denies a malformed hand-back with the reason and records a `ReportCheck` event in the AI log.
