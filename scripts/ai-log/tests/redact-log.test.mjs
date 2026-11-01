import assert from 'node:assert/strict';
import { test } from 'node:test';
import { redactLines } from '../redact-log.mjs';

const record = {
  v: 1,
  event: 'PostToolUse',
  tool_use_id: 'toolu_test',
  redactions: 0,
  data: { tool_response: 'mail someone@example.com from 192.168.1.20' },
};

test('re-redacts old records and is idempotent', () => {
  const first = redactLines([JSON.stringify(record), '']);
  assert.equal(first.changed, 1);
  const redacted = JSON.parse(first.output[0]);
  assert.doesNotMatch(redacted.data.tool_response, /someone@example\.com|192\.168\.1\.20/);
  assert.ok(redacted.redactions >= 2);
  const second = redactLines(first.output);
  assert.equal(second.changed, 0);
  assert.deepEqual(second.output, first.output);
});

test('leaves clean and unparseable lines exactly as they were', () => {
  const clean = JSON.stringify({ ...record, data: { tool_response: 'Build succeeded.' } });
  const { output, changed } = redactLines([clean, '{broken', '']);
  assert.equal(changed, 0);
  assert.deepEqual(output, [clean, '{broken', '']);
});
