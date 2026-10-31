---
name: commit-conventions
description: How commits are written and pushed in this repo (message format with What and Why, one logical change per commit, every commit green, push only to the fork). Use when creating a commit, writing a commit message, or pushing.
---

# Commits

- One logical change per commit. Every commit builds and passes the unit tests on its own, not only the last one.
- Message format, enforced by `.githooks/commit-msg` (enable once per clone: `git config core.hooksPath .githooks`):

```
type(scope): what changed, at most 72 characters

What: the change, concretely (files, behaviour).
Why: the reason (spec rule, finding id, bug).

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
```

  `type` is one of feat, fix, test, refactor, docs, chore, build, ci, perf, style, revert.
- Write the message with a heredoc or a file (`git commit -F -`), never with an editor.
- Stage explicit paths (`git add <paths>`), never `git add -A`: `ai-logs/` grows during work and is committed on purpose at the end.
- Never use `--no-verify`, never force-push, never amend a pushed commit; add a new commit instead.
- Push only to `origin` (the fork). Pull requests and issues go to the fork with `--repo <fork>`. A hook blocks anything aimed at the upstream workshop repository.
