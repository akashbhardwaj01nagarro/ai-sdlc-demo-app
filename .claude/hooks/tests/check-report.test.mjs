import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { lastHandback, planCheck, validate } from '../check-report.mjs';

const hook = fileURLToPath(new URL('../check-report.mjs', import.meta.url));
// Every hook run below writes its ReportCheck record here, never into the real AI log.
const scratch = mkdtempSync(join(tmpdir(), 'check-report-'));
const testLog = join(scratch, 'log.jsonl');

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
  const args = schema ? [hook, schema] : [hook];
  return spawnSync(process.execPath, args, { input: JSON.stringify(input), env: { ...process.env, AI_LOG_FILE: testLog } });
}

function transcriptWithHandback(message) {
  const file = join(scratch, `agent-${Math.abs(message.length)}.jsonl`);
  const entries = [
    { type: 'assistant', message: { content: [{ type: 'text', text: 'Working on it.' }] } },
    { type: 'assistant', message: { content: [{ type: 'tool_use', name: 'SubagentHandback', input: { message } }] } },
  ];
  writeFileSync(file, entries.map((entry) => JSON.stringify(entry)).join('\n'));
  return file;
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

test('a malformed hand-back from a reviewing agent is denied with the reason', () => {
  const denied = runHook(null, { hook_event_name: 'PreToolUse', tool_name: 'SubagentHandback', agent_type: 'test-critic', tool_input: { message: 'All tests look fine.' } });
  assert.equal(denied.status, 0);
  const output = JSON.parse(denied.stdout.toString());
  assert.equal(output.hookSpecificOutput.permissionDecision, 'deny');
  assert.match(output.hookSpecificOutput.permissionDecisionReason, /"tests": \[/);

  const report = { tests: [{ test: 'A.B', rule: 'FR-001', catches: 'x', weakness: null, verdict: 'keep', suggestion: null }], missing: [] };
  const accepted = runHook(null, { hook_event_name: 'PreToolUse', tool_name: 'SubagentHandback', agent_type: 'test-critic', tool_input: { message: message(report) } });
  assert.equal(accepted.stdout.toString(), '');
});

test('hand-backs from agents without a report format, and other tools, are not checked', () => {
  assert.equal(planCheck({ hook_event_name: 'PreToolUse', tool_name: 'SubagentHandback', agent_type: 'domain-implementer', tool_input: { message: 'done' } }), null);
  assert.equal(planCheck({ hook_event_name: 'PreToolUse', tool_name: 'Bash', agent_type: 'test-critic', tool_input: { command: 'ls' } }), null);
  assert.equal(runHook(null, { hook_event_name: 'PreToolUse', tool_name: 'SubagentHandback', agent_type: 'domain-implementer', tool_input: { message: 'done' } }).stdout.toString(), '');
});

test('the agent type picks the schema', () => {
  for (const [agentType, schemaName] of [['pr-reviewer', 'review'], ['review-tests', 'review'], ['mutation-analyst', 'mutation'], ['log-auditor', 'audit']]) {
    assert.equal(planCheck({ hook_event_name: 'PreToolUse', tool_name: 'SubagentHandback', agent_type: agentType, tool_input: { message: '' } }).schemaName, schemaName);
  }
});

test('at SubagentStop an empty final message falls back to the hand-back in the transcript', () => {
  const transcript = transcriptWithHandback(message(goodReview));
  assert.equal(lastHandback(transcript), message(goodReview));
  const plan = planCheck({ hook_event_name: 'SubagentStop', agent_type: 'review-rules', last_assistant_message: '', agent_transcript_path: transcript }, 'review');
  assert.equal(plan.source, 'transcript');
  assert.equal(runHook('review', { hook_event_name: 'SubagentStop', last_assistant_message: '', agent_transcript_path: transcript }).stdout.toString(), '');

  const badTranscript = transcriptWithHandback('no report at all, sorry');
  const blocked = runHook('review', { hook_event_name: 'SubagentStop', last_assistant_message: '', agent_transcript_path: badTranscript });
  assert.equal(JSON.parse(blocked.stdout.toString()).decision, 'block');
  assert.equal(lastHandback(join(scratch, 'missing.jsonl')), '');
});

test('at SubagentStop the agent type picks the schema and other agents pass', () => {
  const critique = { tests: [{ test: 'A.B', rule: 'FR-003', catches: 'x', weakness: null, verdict: 'keep', suggestion: null }], missing: [] };
  const plan = planCheck({ hook_event_name: 'SubagentStop', agent_type: 'test-critic', last_assistant_message: message(critique) });
  assert.deepEqual([plan.schemaName, plan.source], ['test-critique', 'final-message']);
  assert.equal(planCheck({ hook_event_name: 'SubagentStop', agent_type: 'domain-implementer', last_assistant_message: 'done' }), null);
  const blocked = runHook(null, { hook_event_name: 'SubagentStop', agent_type: 'review-rules', last_assistant_message: 'No problems found.' });
  assert.equal(JSON.parse(blocked.stdout.toString()).decision, 'block');
  const retry = runHook(null, { hook_event_name: 'SubagentStop', agent_type: 'review-rules', last_assistant_message: 'No problems found.', stop_hook_active: true });
  assert.equal(retry.stdout.toString(), '');
});

test('every check is recorded in the AI log as a ReportCheck event', () => {
  runHook(null, { hook_event_name: 'PreToolUse', tool_name: 'SubagentHandback', agent_type: 'log-auditor', session_id: 's-check', tool_input: { message: 'nothing' } });
  assert.ok(existsSync(testLog));
  const records = readFileSync(testLog, 'utf8').trim().split('\n').map((line) => JSON.parse(line));
  const record = records.filter((entry) => entry.session_id === 's-check').at(-1);
  assert.equal(record.event, 'ReportCheck');
  assert.equal(record.agent_type, 'log-auditor');
  assert.deepEqual([record.data.schema, record.data.source, record.data.result], ['audit', 'handback', 'rejected']);
});

test('unknown schema names and garbage input never block', () => {
  assert.equal(runHook('nonsense', { last_assistant_message: 'x' }).stdout.toString(), '');
  const garbage = spawnSync(process.execPath, [hook, 'review'], { input: '{' });
  assert.equal(garbage.status, 0);
  assert.equal(garbage.stdout.toString(), '');
});
