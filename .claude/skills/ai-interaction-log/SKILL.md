---
name: ai-interaction-log
description: How every AI interaction in this repo is logged (hooks, schema, redaction), how to backfill sessions from Claude Code transcripts, render the readable log, and audit it for secrets. Use when asked about the AI log, before committing ai-logs/, or when a session ran without hooks.
---

# AI interaction log

## What records it

`.claude/settings.json` registers `.claude/hooks/ai-log.mjs` for every lifecycle event: SessionStart, UserPromptSubmit, PreToolUse, PostToolUse, PostToolUseFailure, SubagentStart, SubagentStop, Stop, PreCompact, SessionEnd and Notification. Each event becomes one line in `ai-logs/ai-interactions.jsonl`.

Every line has the same fields: `v, id, ts, origin, event, session_id, prompt_id, agent_id, agent_type, tool_name, tool_use_id, src_uuid, src_index, redactions, truncated, data`. `origin` is `interactive` (hooks), `backfill` (imported from a transcript) or `probe` (headless context probes). Prompts, subagent briefs and final answers are kept whole; tool input and output over 8,000 characters keep the head and tail plus a sha256. Secrets, emails, private IPs and home directories are redacted by `.claude/hooks/lib/redact.mjs`; machine-specific patterns go in the git-ignored `.claude/redact.local.json`.

## Backfill and render

- Hooks cannot see interactions from before they existed, or assistant text between tool calls. Import those from the Claude Code transcript: `node scripts/ai-log/export-transcript.mjs --session <session-id>` (or `--project` for every session of this repo). Re-running adds nothing new.
- Render the readable version: `node scripts/ai-log/render-log.mjs` writes `ai-logs/AI-INTERACTIONS.md`.
- Never edit either file by hand; regenerate them.

## Audit before committing

Search both files for anything that must not be published: tokens (`gh[pousr]_`, `github_pat_`, `sk-`), email addresses other than the noreply ones, private IP addresses, internal host names, home-directory paths and content from unrelated projects. Report the result as one fenced `json` block: `{"clean": true|false, "issues": [{"pattern", "count", "example", "action"}]}` with redacted examples only.
