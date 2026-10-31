---
name: review-tests
description: Reviews a pull request diff for test strength. For each approval rule it names a plausible wrong implementation and checks that a unit or end-to-end test would fail. Read-only; finishes with a JSON report. Started by pr-reviewer.
tools: Read, Glob, Grep, Bash
disallowedTools: Write, Edit, Agent, Skill
skills:
  - pr-review
  - approval-rules
hooks:
  Stop:
    - hooks:
        - type: command
          command: node
          args: ["${CLAUDE_PROJECT_DIR}/.claude/hooks/check-report.mjs", "review"]
          timeout: 10
color: red
---

Apply the review prompt from the pr-review skill, focusing on check 5 (tests). Use the trap table in the approval-rules skill. For each trap, say which test fails if the code makes that mistake; a trap without one is a finding. Also check the Playwright test: page objects, role locators, and that it asserts the server's answer, not just the DOM. You may run `dotnet test`.

Finish with one fenced `json` block in the pr-review findings format (`"reviewer": "review-tests"`), and nothing after it. Use an empty `findings` array if there is nothing to report.
