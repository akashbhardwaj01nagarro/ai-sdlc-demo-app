# Specification Analysis Report (speckit-analyze, 2026-11-01)

Read-only cross-check of spec.md, plan.md and tasks.md against the constitution, run after
`/speckit-tasks`. Saved here as evidence; the remediation section records what was changed afterwards.

| ID | Category | Severity | Location(s) | Summary | Recommendation |
| --- | --- | --- | --- | --- | --- |
| U1 | Underspecification | MEDIUM | spec.md FR-005; contracts/approvals-api.md | FR-005 says every reason names the rule, the role, the limit and the invoice, but `RoleCannotApprove` names neither a limit nor the invoice, `TwoApproversRequired` does not name the role, and `SameApproverTwice` names no role or limit. A literal test of FR-005 would fail on correct code. | Make every refusal message name the invoice; reword FR-005 to "names the invoice and the rule that applied, with the facts it applied to (role, limit or first approver)". |
| U2 | Underspecification | LOW | contracts/approvals-api.md (`TwoApproversRequired`) | SC-004 asks that a refusal says who must approve instead; the story-1-only message says two approvers are "not supported yet" without saying that nobody can approve until then. | Accept as an interim message (removed in US2), or say "no one can approve it until two-approver support exists". |
| I1 | Inconsistency | LOW | plan.md Summary, research.md R1 vs tasks.md T014 | The plan shows the end-state signature `Decide(invoiceId, amount, firstApprovedBy, approver)`; T014 (US1) uses `Decide(invoiceId, amount, approver)` and T028 adds `firstApprovedBy`. | State in the plan that the four-argument signature is the US2 end state. |
| I2 | Terminology | LOW | spec.md FR-009 ("approval screen") vs UI ("Approvals" tab) | Same thing, two names. | Mention once that the approval screen is the Approvals tab. |
| A1 | Ambiguity | LOW | spec.md Edge Cases (roles matched exactly) vs FR-004 (usernames case-insensitive) | Two different comparison rules can be mixed up by an implementer. | Keep both; T007 tests `manager` (refused) and T025 tests `DEMO.Director` (same user). |
| C1 | Coverage | LOW | spec.md SC-005 | No task targets "same number of steps"; it holds because the approve flow is unchanged. | Covered by quickstart scenario 2; no task needed. |

## Coverage Summary

| Requirement Key | Has Task? | Task IDs | Notes |
| --- | --- | --- | --- |
| FR-001 Manager limit | Yes | T007, T008, T014, T015, T023 | |
| FR-002 Director limit | Yes | T007, T014, T015 | |
| FR-003 Two approvers above 500,000 | Yes | T025–T029 | |
| FR-004 Same user never both | Yes | T025, T026, T029 | includes concurrency |
| FR-005 Refusal: reason, no change | Yes | T008, T013, T014, T016, T023 | see U1 |
| FR-006 Only Manager/Director approve | Yes | T007, T014, T017, T018 | |
| FR-007 Reject unaffected | Yes | T026, T029 | |
| FR-008 Awaiting second approval visible | Yes | T031 | |
| FR-009 Approve offered, reason shown | Yes | T023 | UI already behaves so |
| SC-001 Boundaries | Yes | T007 | |
| SC-002 Invoice identical after refusal | Yes | T008, T026 | |
| SC-003 No single-person approval above 500,000 | Yes | T026, T029 | |
| SC-004 Message tells who must approve | Yes | T007 | see U2 |

**Constitution Alignment Issues**: none. Principles I–V are each reflected in plan.md's Constitution
Check and in tasks (Domain-only rule code, write-after-decide, tests first with snapshot and
`UpdateCount`, one story per commit, FR traits).

**Unmapped Tasks**: T001–T004 (setup already committed) and T036–T038 (process: per-commit check,
review, log) map to the constitution's workflow gates rather than to a requirement; intentional.

**Metrics**

- Total requirements: 13 (9 functional, 4 buildable success criteria; SC-005 is an outcome, not build work)
- Total tasks: 38
- Coverage: 100% of requirements have at least one task
- Ambiguity count: 1 (A1)
- Duplication count: 0
- Critical issues: 0

## Next Actions

No CRITICAL issues: implementation may start. Recommended before US1: apply U1 (it changes the
expected messages, so tests written from the contract would otherwise assert the wrong text) and I1.
U2, I2, A1 and C1 can stay as documented.

## Remediation applied

The product owner chose to fix U1 and I1 before US1 (2026-11-01):

- U1: FR-005 now reads "names the invoice and the rule that applied, with the facts it applied to (the
  approver's role, the limit or the first approver)"; the `RoleCannotApprove` message in
  contracts/approvals-api.md now names the invoice; the same wording was aligned in AGENTS.md, the
  constitution (Principle II, before ratification), and the approval-rules and pr-review skills.
- I1: plan.md states that `Decide` takes `(invoiceId, amount, approver)` in US1 and gains
  `firstApprovedBy` in US2.
- U2, I2, A1, C1: left as documented above.
