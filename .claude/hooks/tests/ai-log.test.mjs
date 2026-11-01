import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { buildRecord, SCHEMA_VERSION } from '../ai-log.mjs';

const hook = fileURLToPath(new URL('../ai-log.mjs', import.meta.url));
const FIELDS = ['v', 'id', 'ts', 'origin', 'event', 'session_id', 'prompt_id', 'agent_id', 'agent_type', 'tool_name', 'tool_use_id', 'src_uuid', 'src_index', 'redactions', 'truncated', 'data'];

function runHook(stdin) {
  const logFile = join(mkdtempSync(join(tmpdir(), 'ai-log-')), 'log.jsonl');
  const result = spawnSync(process.execPath, [hook], { input: stdin, env: { ...process.env, AI_LOG_FILE: logFile, AI_LOG_ORIGIN: '' } });
  return { result, logFile };
}

test('every record has the same fields in the same order', () => {
  for (const input of [
    { hook_event_name: 'UserPromptSubmit', session_id: 's', prompt: 'hello' },
    { hook_event_name: 'PreToolUse', session_id: 's', tool_name: 'Bash', tool_use_id: 't', tool_input: { command: 'ls' } },
    { hook_event_name: 'SubagentStop', session_id: 's', agent_id: 'a', agent_type: 'test-critic', last_assistant_message: 'done' },
    { hook_event_name: 'SomethingNew', session_id: 's' },
  ]) {
    assert.deepEqual(Object.keys(buildRecord(input)), FIELDS);
  }
});

test('the hook appends one JSON line, prints nothing and exits 0', () => {
  const { result, logFile } = runHook(JSON.stringify({ hook_event_name: 'UserPromptSubmit', session_id: 's1', prompt: 'go' }));
  assert.equal(result.status, 0);
  assert.equal(result.stdout.toString(), '');
  const lines = readFileSync(logFile, 'utf8').trim().split('\n');
  assert.equal(lines.length, 1);
  const record = JSON.parse(lines[0]);
  assert.equal(record.v, SCHEMA_VERSION);
  assert.equal(record.event, 'UserPromptSubmit');
  assert.equal(record.origin, 'interactive');
  assert.equal(record.data.prompt, 'go');
});

test('garbage input still exits 0 without stdout', () => {
  const { result, logFile } = runHook('{not json');
  assert.equal(result.status, 0);
  assert.equal(result.stdout.toString(), '');
  assert.equal(existsSync(logFile), false);
});

test('prompts and subagent briefs are kept whole, tool output is capped', () => {
  const long = 'x'.repeat(20000);
  assert.equal(buildRecord({ hook_event_name: 'UserPromptSubmit', prompt: long }).data.prompt.length, 20000);
  assert.equal(buildRecord({ hook_event_name: 'PreToolUse', tool_name: 'Agent', tool_input: { prompt: long } }).data.tool_input.prompt.length, 20000);
  const capped = buildRecord({ hook_event_name: 'PostToolUse', tool_name: 'Bash', tool_input: {}, tool_response: { stdout: long } });
  assert.equal(capped.truncated, true);
  assert.ok(capped.data.tool_response.stdout.length < 20000);
});

test('secrets in tool input are redacted before they reach the log', () => {
  const record = buildRecord({ hook_event_name: 'PreToolUse', tool_name: 'Bash', tool_input: { command: 'echo ghp_abcdefghijklmnopqrstuvwxyz0123' } });
  assert.doesNotMatch(JSON.stringify(record), /ghp_/);
  assert.ok(record.redactions >= 1);
});
