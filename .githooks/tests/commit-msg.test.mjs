import assert from 'node:assert/strict';
import { test } from 'node:test';
import { problemsWith } from '../commit-msg.mjs';

const good = `feat(approvals): enforce single-approver limits by role

What: Approve now takes the approver's role and refuses amounts above it.
Why: spec 001 FR-001 and FR-002.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
`;

test('accepts the documented format, with or without a scope', () => {
  assert.deepEqual(problemsWith(good), []);
  assert.deepEqual(problemsWith('docs: tidy README\n\nWhat: fixed a typo.\nWhy: it was wrong.\n'), []);
  assert.deepEqual(problemsWith(good.replace(/\n/g, '\r\n')), []);
});

test('rejects messages without What or Why', () => {
  const problems = problemsWith('fix(api): map refusals to 403\n\nWhy: clear reasons.\n');
  assert.equal(problems.length, 1);
  assert.match(problems[0], /What:/);
  assert.match(problemsWith('fix(api): x\n\nWhat: y\n')[0], /Why:/);
});

test('rejects a free-form subject, a long subject and a missing blank line', () => {
  assert.ok(problemsWith('Added stuff\n\nWhat: a\nWhy: b\n').some((problem) => problem.includes('type(scope)')));
  assert.ok(problemsWith(`feat: ${'x'.repeat(80)}\n\nWhat: a\nWhy: b\n`).some((problem) => problem.includes('72')));
  assert.ok(problemsWith('feat: x\nWhat: a\nWhy: b\n').some((problem) => problem.includes('blank line')));
});

test('ignores comment lines and lets merges and reverts through', () => {
  assert.deepEqual(problemsWith(`# Please enter the commit message\n${good}`), []);
  assert.deepEqual(problemsWith("Merge branch 'main' into 001-approval-limits\n"), []);
  assert.deepEqual(problemsWith('Revert "feat: x"\n\nThis reverts commit abc.\n'), []);
});
