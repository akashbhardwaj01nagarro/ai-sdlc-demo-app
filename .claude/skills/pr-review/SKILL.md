---
name: pr-review
description: The review prompt for pull requests in this repo, the JSON findings format, and how verdicts (fixed, dismissed, deferred) are decided and written into the PR description. Use when reviewing a pull request or diff, triaging review findings, or writing the findings table.
---

# Pull request review

The workshop's own review prompt was not available, so this prompt stands in for it. It is built from the review expectations in AGENTS.md; say so wherever review results are published.

## The review prompt

> Review pull request `<PR>` on `<fork>`. Get the diff with `gh pr diff <PR> --repo <fork>` (or `git diff main...HEAD`). Review what the diff changes and the code it calls. Skip generated or recorded files: `.specify/`, `.claude/skills/speckit-*/`, `ai-logs/`, `docs/mutation/`, lock files.
>
> Read AGENTS.md and `specs/001-approval-limits/spec.md` first. Then check, in this order:
>
> 1. **Rules.** Does each of FR-001 to FR-005 hold, including the exact limits (50,000.00 and 500,000.00, inclusive) and the +0.01 cases?
> 2. **Same user twice (FR-004).** Can one user count as both approvers by any path: approving twice, a case or whitespace variant of the name, a Manager approving first and again later, two requests at the same time? Is the second approver's Director role checked when the second approval happens?
> 3. **Refused attempts (FR-005).** Does every refused path leave every invoice field unchanged and skip `Update`? Look for any field written before a check that can still throw: the repositories hand out live objects, so such a write persists even without `Update`. Is the reason specific (rule, role, limit, invoice)? Can a refusal set `Rejected`?
> 4. **Layering.** Are the rules only in Domain? Does the controller only adapt (session to `Approver`, exception to status code)? Does JavaScript only display?
> 5. **Tests.** For each rule, name a plausible wrong implementation and say whether a test would fail. Flag second references used as snapshots, boundaries read from constants, over-limit tests that use small amounts, and assertions that only check the exception type.
> 6. **Security.** Approver identity only from the session; role checks fail closed; nothing trusts the request body; no secrets, tokens or personal data committed.
> 7. **State and concurrency.** What happens on double clicks, retries or two approvers at once?
> 8. **Conventions.** The rules in AGENTS.md: naming, one test class per class, page objects with role-based locators, no business logic in controllers or `Program.cs`.
>
> Report only real problems, each with evidence from the code (`file:line` and the reasoning). No style comments unless they break an AGENTS.md convention. For every finding propose a verdict (fix, dismiss or defer) with a reason; a human makes the final call.

## Findings format

End the review with one fenced `json` block (a hook rejects anything else):

```json
{
  "reviewer": "review-rules",
  "scope": "PR #1, 14 files",
  "findings": [
    {
      "id": "R-01",
      "severity": "major",
      "rule": "FR-004",
      "file": "backend/src/InvoiceApp.Domain/ApprovalService.cs",
      "line": 42,
      "title": "Same user can count twice",
      "evidence": "what the code does and why that breaks the rule",
      "suggested_fix": "the smallest change that fixes it",
      "proposed_verdict": "fix",
      "proposed_reason": "why this verdict"
    }
  ]
}
```

Severity: `blocker` (a rule is broken or data is corrupted), `major` (a rule can break under realistic use, or a test gap lets a rule break silently), `minor` (correct but fragile or unclear), `nit` (cosmetic). `rule`: `FR-001` to `FR-005`, `layering`, `tests`, `security`, `conventions` or `other`.

## Verdicts in the PR description

Every finding appears exactly once in the PR description table:

| ID | Severity | Location | Finding | Agent proposed | Verdict | Reason / commit |
| --- | --- | --- | --- | --- | --- | --- |

- **fixed**: link the commit that fixes it (`fix(review): R-03 ...`).
- **dismissed**: the reason and the evidence (a test name or a spec clause). A finding about FR-004 or FR-005 can only be dismissed with a test that proves it wrong.
- **deferred**: the reason and a follow-up issue on the fork.

The agent proposes; the human decides and the table records the human's verdict. Do not invent findings to fill a category, and do not drop findings: the number of rows equals the number of findings raised.
