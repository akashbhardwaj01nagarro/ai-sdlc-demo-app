import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { validate } from '../check-report.mjs';

const hook = fileURLToPath(new URL('../check-report.mjs', import.meta.url));

const goodReview = {
  reviewer: 'review-rules',
  scope: 'PR 1 diff',
  findings: [
    {
      id: 'R-01',
      severity: 'major',
      rule: 'FR-004',
      file: 'backend/src/InvoiceApp.Domain/ApprovalService.cs',
      line: 42,
      title: 'Same user can approve twice',
      evidence: 'The second approval compares DecidedBy instead of FirstApprovedBy.',
      suggested_fix: 'Compare against FirstApprovedBy.',
      proposed_verdict: 'fix',
      proposed_reason: 'Breaks FR-004.',
    },
  ],
};

function message(report) {
  return `Summary of the review.\n\n\`\`\`json\n${JSON.stringify(report, null, 2)}\n\`\`\``;
}

function runHook(schema, input) {
  return spawnSync(process.execPath, [hook, schema], { input: JSON.stringify(input) });
}

test('accepts a well-formed review, including an empty one', () => {
  assert.deepEqual(validate('review', message(goodReview)), []);
  assert.deepEqual(validate('review', message({ reviewer: 'x', scope: 'y', findings: [] })), []);
});

test('rejects missing fields, bad severities and bad verdicts', () => {
  const bad = structuredClone(goodReview);
  bad.findings[0].severity = 'critical';
  bad.findings[0].proposed_verdict = 'maybe';
  delete bad.findings[0].line;
  const problems = validate('review', message(bad));
  assert.ok(problems.some((problem) => problem.includes('severity')));
  assert.ok(problems.some((problem) => problem.includes('proposed_verdict')));
  assert.ok(problems.some((problem) => problem.includes('line')));
});

test('rejects a message without a JSON block', () => {
  assert.deepEqual(validate('review', 'Looks good to me!'), ['the final message has no parseable ```json block']);
});

test('uses the last JSON block when there are several', () => {
  const text = `${message({ wrong: true })}\n\nFinal:\n${message(goodReview)}`;
  assert.deepEqual(validate('review', text), []);
});

test('validates the test-critique, mutation and audit shapes', () => {
  assert.deepEqual(validate('test-critique', message({ tests: [{ test: 'A.B', rule: 'FR-001', catches: '< instead of <=', weakness: null, verdict: 'keep', suggestion: null }], missing: [] })), []);
  assert.ok(validate('test-critique', message({ tests: [{ test: 'A.B', rule: 'FR-001', catches: 'x', verdict: 'strengthen' }], missing: [] })).length > 0);
  assert.deepEqual(validate('mutation', message({ score_scoped: 95.5, score_whole: null, survivors: [] })), []);
  assert.ok(validate('mutation', message({ score_scoped: 'high', survivors: [] })).length > 0);
  assert.deepEqual(validate('audit', message({ clean: true, issues: [] })), []);
});

test('the hook blocks a malformed report once and lets a retry through', () => {
  const blocked = runHook('review', { last_assistant_message: 'no json here', stop_hook_active: false });
  assert.equal(blocked.status, 0);
  const decision = JSON.parse(blocked.stdout.toString());
  assert.equal(decision.decision, 'block');
  assert.match(decision.reason, /```json/);

  const retry = runHook('review', { last_assistant_message: 'still no json', stop_hook_active: true });
  assert.equal(retry.status, 0);
  assert.equal(retry.stdout.toString(), '');

  const good = runHook('review', { last_assistant_message: message(goodReview), stop_hook_active: false });
  assert.equal(good.stdout.toString(), '');
});

test('unknown schema names and garbage input never block', () => {
  assert.equal(runHook('nonsense', { last_assistant_message: 'x' }).stdout.toString(), '');
  const garbage = spawnSync(process.execPath, [hook, 'review'], { input: '{' });
  assert.equal(garbage.status, 0);
  assert.equal(garbage.stdout.toString(), '');
});
