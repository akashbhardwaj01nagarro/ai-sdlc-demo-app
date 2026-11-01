import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { exportTranscripts, hookStartsFrom, recordsFromTranscript } from '../export-transcript.mjs';
import { describeToolInput, render } from '../render-log.mjs';

const session = 'session-1';
const transcript = [
  { type: 'queue-operation', sessionId: session },
  { type: 'user', uuid: 'u1', sessionId: session, timestamp: '2026-01-01T10:00:00.000Z', origin: { kind: 'human' }, message: { role: 'user', content: [{ type: 'text', text: 'Please add limits' }] } },
  { type: 'user', uuid: 'u2', sessionId: session, timestamp: '2026-01-01T10:00:00.100Z', isMeta: true, message: { role: 'user', content: 'skill body' } },
  { type: 'assistant', uuid: 'a1', sessionId: session, timestamp: '2026-01-01T10:00:01.000Z', message: { role: 'assistant', content: [{ type: 'thinking', thinking: '' }, { type: 'text', text: 'Reading the repo.' }, { type: 'tool_use', id: 'toolu_1', name: 'Bash', input: { command: 'ls' } }] } },
  { type: 'user', uuid: 'u3', sessionId: session, timestamp: '2026-01-01T10:00:02.000Z', message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'toolu_1', content: 'AGENTS.md\nREADME.md' }] } },
  { type: 'assistant', uuid: 'a2', sessionId: session, timestamp: '2026-01-01T12:00:00.000Z', message: { role: 'assistant', content: [{ type: 'text', text: 'Later text the hooks cannot see.' }, { type: 'tool_use', id: 'toolu_2', name: 'Read', input: { file_path: 'x' } }] } },
].map((entry) => JSON.stringify(entry));

test('maps prompts, injected context, assistant text and tool calls; skips thinking and plumbing', () => {
  const { records, unparseable } = recordsFromTranscript([...transcript, '{broken']);
  assert.equal(unparseable, 1);
  assert.deepEqual(
    records.map((record) => record.event),
    ['UserPromptSubmit', 'ContextInjected', 'AssistantText', 'PreToolUse', 'PostToolUse', 'AssistantText', 'PreToolUse'],
  );
  const result = records.find((record) => record.event === 'PostToolUse');
  assert.equal(result.tool_name, 'Bash');
  assert.equal(result.data.tool_response, 'AGENTS.md\nREADME.md');
  assert.ok(records.every((record) => record.origin === 'backfill'));
});

test('after the hooks start, only assistant text is imported', () => {
  const hookStartBySession = new Map([[session, '2026-01-01T11:00:00.000Z']]);
  const { records } = recordsFromTranscript(transcript, { hookStartBySession });
  const late = records.filter((record) => record.ts >= '2026-01-01T11:00:00.000Z');
  assert.deepEqual(late.map((record) => record.event), ['AssistantText']);
});

test('hook start is the first interactive record per session', () => {
  const starts = hookStartsFrom([
    { origin: 'interactive', session_id: 'a', ts: '2026-01-02T00:00:00Z' },
    { origin: 'interactive', session_id: 'a', ts: '2026-01-01T00:00:00Z' },
    { origin: 'backfill', session_id: 'b', ts: '2025-01-01T00:00:00Z' },
  ]);
  assert.equal(starts.get('a'), '2026-01-01T00:00:00Z');
  assert.equal(starts.has('b'), false);
});

test('exporting twice adds nothing the second time', () => {
  const directory = mkdtempSync(join(tmpdir(), 'export-'));
  const transcriptFile = join(directory, 'session-1.jsonl');
  const logFile = join(directory, 'log.jsonl');
  writeFileSync(transcriptFile, transcript.join('\n'));
  const first = exportTranscripts([transcriptFile], logFile);
  const second = exportTranscripts([transcriptFile], logFile);
  assert.equal(first[0].added, 7);
  assert.equal(second[0].added, 0);
  assert.equal(readFileSync(logFile, 'utf8').trim().split('\n').length, 7);
});

test('renders prompts in full and each tool call on one line', () => {
  const { records } = recordsFromTranscript(transcript);
  const markdown = render(records);
  assert.match(markdown, /# AI interaction log/);
  assert.match(markdown, /Please add limits/);
  assert.match(markdown, /\*\*Bash\*\* `ls` → `AGENTS\.md README\.md`/);
  assert.equal(render(records), markdown);
});

test('a hand-back is imported whole even after the hooks start, and rendered once, untruncated', () => {
  const longReport = `Report\n${'x'.repeat(9000)}\nEND`;
  const handbackEntry = JSON.stringify({ type: 'assistant', uuid: 'h1', sessionId: session, agentId: 'agent-1', timestamp: '2026-01-01T12:30:00.000Z', message: { role: 'assistant', content: [{ type: 'tool_use', id: 'toolu_h', name: 'SubagentHandback', input: { message: longReport } }] } });
  const hookStartBySession = new Map([[session, '2026-01-01T11:00:00.000Z']]);
  const { records } = recordsFromTranscript([handbackEntry], { agentType: 'test-critic', hookStartBySession });
  assert.equal(records.length, 1);
  assert.equal(records[0].data.tool_input.message, longReport);
  const shortened = { ...records[0], origin: 'interactive', truncated: true, ts: '2026-01-01T12:29:59.000Z', data: { tool_input: { message: 'Report…[cut]' } } };
  const markdown = render([shortened, records[0]]);
  assert.equal(markdown.split('handed back').length - 1, 1);
  assert.ok(markdown.includes('END'));
});

test('describes tool inputs briefly', () => {
  assert.equal(describeToolInput('Bash', { command: 'dotnet  test\n--no-build' }), 'dotnet test --no-build');
  assert.equal(describeToolInput('Agent', { subagent_type: 'test-critic', description: 'Review US1 tests' }), 'test-critic: Review US1 tests');
  assert.equal(describeToolInput('Workflow', { script: "export const meta = { name: 'review-pr' }" }), 'review-pr');
});
