# Invoice Approval Demo App Constitution

## Core Principles

### I. Rules Live in the Domain

Business rules MUST be implemented in the `InvoiceApp.Domain` project and nowhere else.
Controllers MUST only adapt: they build the acting user from the signed-in session (never from a
request body) and map domain exceptions to HTTP status codes. The web UI MUST only display what the
server returns; it MUST NOT re-implement limits or role checks.

Rationale: one place to read, test and mutate the rules; no second copy that can drift.

### II. Refuse Safely

Every rule MUST be checked before any state is written. A refused action MUST leave every field of
the affected record unchanged, MUST NOT persist anything, and MUST return a reason that names the
record and the rule that applied, with the facts it applied to (such as the role and the limit). Roles that a rule does not name MUST be refused
(fail closed).

Rationale: repositories in this app hand out live objects, so a write before a refusal leaks into
the store even without an explicit save.

### III. Test-First Rules (NON-NEGOTIABLE)

Every rule MUST have an at-limit, an over-limit and a negative unit test, using literal boundary
values rather than the production constants. Refusal tests MUST assert the reason, a full snapshot
of the record taken before the attempt, and that the repository was not updated. Behaviour visible
in the UI MUST also have a Playwright test that uses page objects and role-based locators.
Assertions MUST NOT be weakened, skipped or deleted to make a test pass.

Rationale: the cases most likely to look right and be wrong are refusals and boundaries; mutation
testing (Stryker.NET) is used to check that the tests actually catch them.

### IV. Small, Reviewed Steps

Work MUST land one user story per commit, and every commit MUST build and pass the unit tests on
its own. An AI agent MUST be given one scoped step per prompt, never a whole feature. Every review
finding MUST receive exactly one verdict (fixed, dismissed or deferred) with a reason; an agent may
propose a verdict, a human decides.

Rationale: small steps keep each change reviewable and make it obvious which prompt produced what.

### V. Traceability

Requirement IDs (FR-xxx) from the spec MUST appear in the tests (as traits), in commit messages and
in review findings. Every AI interaction MUST be logged in the repository's AI interaction log with
secrets and personal data redacted.

Rationale: a reviewer can follow any rule from the spec to its code, its tests, its commit and the
conversation that produced it.

## Technology and Scope Constraints

- ASP.NET Core 8 Web API, xUnit tests, Playwright end-to-end tests, in-memory storage; no new
  runtime dependencies without a recorded reason in the plan.
- Demo accounts in configuration are not real credentials; real credentials, tokens and customer
  data MUST NOT be committed.
- Commands, file layout, naming and review expectations are defined in `AGENTS.md`, which is the
  operational guide for humans and agents; this constitution does not repeat them.

## Development Workflow and Quality Gates

- A feature starts as a Spec Kit specification with requirement IDs and user stories; the plan and
  task list are derived from it and kept up to date.
- Before a commit: build and unit tests pass; for UI-visible changes the Playwright suite passes;
  the commit message states what changed and why.
- Before a merge: the pull request has been reviewed with the review prompt in the `pr-review`
  skill, every finding has a verdict in the pull request description, and mutation scores for the
  rule code are recorded before and after.

## Governance

This constitution takes precedence over other practices in this repository. Amendments are made in
a dedicated commit that updates this file, states the reason, and bumps the version: MAJOR for
removing or redefining a principle, MINOR for adding a principle or materially expanding guidance,
PATCH for clarifications. Every plan MUST pass the Constitution Check against these principles, and
reviewers check compliance as part of the review expectations in `AGENTS.md`.

**Version**: 1.0.0 | **Ratified**: 2026-11-01 | **Last Amended**: 2026-11-01
