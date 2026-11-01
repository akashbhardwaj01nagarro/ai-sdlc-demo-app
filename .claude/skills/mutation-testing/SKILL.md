---
name: mutation-testing
description: Running Stryker.NET 4.13.0 on the approval code, recording before/after scores, and triaging surviving mutants. Use when asked to run mutation tests, measure test strength, compare mutation scores, or decide which tests to add after a Stryker run.
---

# Mutation testing with Stryker.NET

Stryker.NET is pinned to **4.13.0** in `.config/dotnet-tools.json`; newer releases target a later .NET runtime and fail on .NET 8. Restore it with `dotnet tool restore` (the global equivalent is `dotnet tool install -g dotnet-stryker --version 4.13.0`).

Configuration: `backend/tests/InvoiceApp.Tests/stryker-config.json` (project `InvoiceApp.Domain.csproj`; reporters progress, cleartext, markdown, html, json).

## Runs

From `backend/tests/InvoiceApp.Tests`, after `source scripts/dev-env.sh` at the repo root:

- Approval scope (headline score): `dotnet stryker -m "**/Approv*.cs" -O StrykerOutput/<label>-approval`
- Whole Domain project: `dotnet stryker -O StrykerOutput/<label>-whole`

`<label>` is `01-baseline`, `02-after-feature` or `03-after-hardening`. Reports land in `StrykerOutput/<label>-*/reports/` (git-ignored). Copy `mutation-report.md` to `docs/mutation/<label>-approval.md` or `-whole.md`, and record the commit SHA, SDK version and Stryker version next to the score. `DiscountCalculator.cs` is untested and outside this feature: it lowers the whole-project score in every run and is reported, not hidden.

## Triage every surviving approval mutant

For each survivor give the file, line, mutator and the rule it belongs to, then classify it:

- `missing-test`: a plausible bug the tests do not catch; propose the exact test (name, inputs, assertion).
- `equivalent`: the mutant cannot change behaviour; explain why.
- `out-of-scope`: not approval behaviour (for example a default value in `Invoice`); explain why.

Never weaken the configuration (thresholds, ignored mutators, excluded files) to raise a score.

## Report format (mutation-analyst)

End with one fenced `json` block: `{"score_scoped": <number|null>, "score_whole": <number|null>, "survivors": [{"file", "line", "mutator", "rule", "classification", "proposed_test", "reason"}]}`. A hook rejects any other shape.
