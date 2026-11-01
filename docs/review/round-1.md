# Agent review, round 1 (PR #1)

Reviewer: `pr-reviewer` with nested `review-rules`, `review-tests` and `review-security` (Claude Code subagents). Review prompt: the `pr-review` skill, which stands in for the workshop prompt (not available). Raw report: [round-1.json](round-1.json); it validates against the review schema with 0 problems.

Scope: PR #1 on akashbhardwaj01nagarro/ai-sdlc-demo-app (001-approval-limits at ca0ab9b into main), 167 files: feature code (backend/src), tests (backend/tests, e2e), agent tooling (.claude hooks, settings, agents and non-speckit skills, .githooks, scripts), and a secrets and personal-data scan of all 17,003 added lines including .specify/, speckit skills, docs/mutation/, docs/evidence/ and lock files. Merged from review-rules, review-tests and review-security; review prompt from the pr-review skill, standing in for the workshop's prompt, which was not available.

| ID | Severity | Area | Location | Finding | Agent proposed |
| --- | --- | --- | --- | --- | --- |
| R-01 | major | tests | `backend/tests/InvoiceApp.Tests/ApprovalServiceTests.cs:351` | Rounding the amount to cents inside ApprovalService passes every test (FR-001, FR-003) | fix |
| R-02 | major | tests | `backend/src/InvoiceApp.Api/Controllers/ApprovalsController.cs:10` | No test covers Admin passing the approvals role gate (Admin approval refused by the Domain, Admin rejection allowed) | fix |
| R-03 | major | security | `.claude/hooks/guard-git.mjs:147` | guard-git lets common command forms reach the upstream workshop repository | fix |
| R-04 | minor | FR-005 | `backend/src/InvoiceApp.Api/Controllers/ApprovalsController.cs:10` | Roles other than Manager, Director and Admin are refused by the API role gate, not the Domain: no code, no invoice, and Admin listed as allowed | fix |
| R-05 | minor | FR-004 | `backend/src/InvoiceApp.Domain/ApprovalService.cs:30` | FR-004 under simultaneous requests depends on the repository being a DI singleton | defer |
| R-06 | minor | other | `backend/src/InvoiceApp.Api/Controllers/InvoicesController.cs:75` | Delete bypasses the decision gate, so an approval racing a delete answers 200 Approved for an invoice that is not stored | defer |
| R-07 | minor | tests | `backend/src/InvoiceApp.Api/Controllers/ApiControllerBase.cs:20` | No test asserts the 404 and 409 answers, and the new 403 mapping is tested only by Playwright | defer |
| R-08 | minor | security | `.claude/hooks/guard-git.mjs:166` | guard-git allows the command when it cannot read the hook input | fix |
| R-09 | minor | security | `.claude/hooks/guard-git.mjs:81` | Force-push and hook-skipping checks miss a '+' refspec, a combined '-n' and '-c core.hooksPath' | fix |
| R-10 | minor | security | `.claude/hooks/lib/redact.mjs:36` | Redaction misses non-Windows home paths and several credential formats | fix |
| R-11 | minor | security | `.claude/agents/pr-reviewer.md:4` | Read-only agents can still write through Bash, and pr-reviewer can start writer subagents | defer |
| R-12 | nit | tests | `backend/tests/InvoiceApp.Tests/ApprovalServiceTests.cs:432` | A refusal step checks only the exception type | fix |
| R-13 | nit | other | `.claude/hooks/check-report.mjs:184` | check-report neither validates nor records a SubagentStop retry, and lets unreadable input through | dismiss |
| R-14 | nit | security | `.claude/hooks/lib/redact.mjs:35` | A redaction comment contains the local Windows short account name | fix |

Verdicts are decided by the author and recorded in the PR description.
