// Renders ai-logs/ai-interactions.jsonl as ai-logs/AI-INTERACTIONS.md, one section per
// session, in time order. Prompts and answers are shown in full; each tool call is one
// line (the JSONL keeps the complete record). Same input, same output.
//
//   node scripts/ai-log/render-log.mjs [log.jsonl] [output.md]
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');

function fenced(text) {
  const longestRun = Math.max(0, ...[...String(text).matchAll(/`+/g)].map((match) => match[0].length));
  const fence = '`'.repeat(Math.max(3, longestRun + 1));
  return `${fence}text\n${text}\n${fence}`;
}

function oneLine(value, limit = 160) {
  const text = (typeof value === 'string' ? value : JSON.stringify(value) ?? '').replace(/\s+/g, ' ').trim();
  return text.length > limit ? `${text.slice(0, limit)}…` : text;
}

function inlineCode(text) {
  return `\`${text.replace(/`/g, "'")}\``;
}

export function describeToolInput(toolName, input) {
  if (!input || typeof input !== 'object') return oneLine(input ?? '');
  switch (toolName) {
    case 'Bash':
    case 'PowerShell':
      return oneLine(input.command);
    case 'Read':
    case 'Write':
    case 'Edit':
    case 'NotebookEdit':
      return oneLine(input.file_path);
    case 'Grep':
    case 'Glob':
      return oneLine(`${input.pattern}${input.path ? ` in ${input.path}` : ''}`);
    case 'Agent':
    case 'Task':
      return oneLine(`${input.subagent_type ?? 'general-purpose'}: ${input.description ?? ''}`);
    case 'Skill':
      return oneLine(`${input.skill}${input.args ? ` ${input.args}` : ''}`);
    case 'WebFetch':
      return oneLine(input.url);
    case 'WebSearch':
      return oneLine(input.query);
    case 'Workflow': {
      const name = /name:\s*'([^']+)'/.exec(input.script ?? '')?.[1];
      return oneLine(name ?? input.name ?? input.scriptPath ?? 'workflow');
    }
    default:
      return oneLine(input);
  }
}

function time(ts) {
  return (ts ?? '').replace('T', ' ').replace(/\.\d+Z$/, 'Z');
}

function speaker(record) {
  return record.agent_type ?? (record.agent_id ? `subagent ${record.agent_id}` : 'Claude (main)');
}

export function render(records) {
  const ordered = records.map((record, position) => ({ record, position }));
  ordered.sort((left, right) => (left.record.ts ?? '').localeCompare(right.record.ts ?? '') || left.position - right.position);
  const sorted = ordered.map(({ record }) => record);

  const lines = ['# AI interaction log', ''];
  lines.push('Generated from `ai-interactions.jsonl` by `scripts/ai-log/render-log.mjs`. Do not edit by hand; the JSONL file is the full record.');
  lines.push('');
  const byOrigin = {};
  const byEvent = {};
  const subagentRuns = {};
  for (const record of sorted) {
    byOrigin[record.origin] = (byOrigin[record.origin] ?? 0) + 1;
    byEvent[record.event] = (byEvent[record.event] ?? 0) + 1;
    if (record.event === 'SubagentStart' || (record.origin === 'backfill' && record.event === 'UserPromptSubmit' && record.agent_id)) {
      const name = record.agent_type ?? 'unknown';
      subagentRuns[name] = (subagentRuns[name] ?? 0) + 1;
    }
  }
  lines.push(`- Records: ${sorted.length} (${Object.entries(byOrigin).map(([origin, count]) => `${origin} ${count}`).join(', ')})`);
  if (sorted.length) lines.push(`- Covers ${time(sorted[0].ts)} to ${time(sorted.at(-1).ts)} (UTC). Later interactions are not in this file.`);
  lines.push('');
  lines.push('| Event | Records |', '| --- | --- |');
  for (const [event, count] of Object.entries(byEvent).sort()) lines.push(`| ${event} | ${count} |`);
  lines.push('');
  if (Object.keys(subagentRuns).length) {
    lines.push('| Agent | Runs |', '| --- | --- |');
    for (const [name, count] of Object.entries(subagentRuns).sort()) lines.push(`| ${name} | ${count} |`);
    lines.push('');
  }

  const sessions = new Map();
  for (const record of sorted) {
    const key = record.session_id ?? 'unknown';
    if (!sessions.has(key)) sessions.set(key, []);
    sessions.get(key).push(record);
  }
  for (const [sessionId, sessionRecords] of sessions) {
    lines.push(`## Session ${sessionId.slice(0, 8)}`, '');
    lines.push(`${time(sessionRecords[0].ts)} to ${time(sessionRecords.at(-1).ts)}, ${sessionRecords.length} records.`, '');
    const assistantTexts = new Set(sessionRecords.filter((record) => record.event === 'AssistantText').map((record) => record.data?.text));
    const responses = new Map(
      sessionRecords
        .filter((record) => ['PostToolUse', 'PostToolUseFailure'].includes(record.event) && record.tool_use_id)
        .map((record) => [record.tool_use_id, record]),
    );
    const shownCalls = new Set();
    // A hand-back can be logged twice (shortened by the hook, whole by the exporter); show the whole one.
    const handbacks = new Map();
    for (const record of sessionRecords) {
      if (record.event !== 'PreToolUse' || record.tool_name !== 'SubagentHandback' || !record.tool_use_id) continue;
      const known = handbacks.get(record.tool_use_id);
      if (!known || (known.truncated && !record.truncated)) handbacks.set(record.tool_use_id, record);
    }
    for (const record of sessionRecords) {
      const who = speaker(record);
      switch (record.event) {
        case 'UserPromptSubmit':
          lines.push(`### ${time(record.ts)} · ${record.agent_id ? `Prompt to ${who}` : 'Prompt'}${record.origin === 'probe' ? ' (probe)' : ''}`, '');
          lines.push(fenced(record.data?.prompt ?? ''), '');
          break;
        case 'AssistantText':
          lines.push(`**${time(record.ts)} · ${who}**`, '', fenced(record.data?.text ?? ''), '');
          break;
        case 'Stop':
        case 'SubagentStop': {
          const message = record.data?.last_assistant_message ?? '';
          const label = record.event === 'Stop' ? 'end of turn' : `${who} finished`;
          if (message && !assistantTexts.has(message)) lines.push(`**${time(record.ts)} · ${label}**`, '', fenced(message), '');
          else lines.push(`*${time(record.ts)} · ${label}*`, '');
          break;
        }
        case 'PreToolUse': {
          if (record.tool_use_id && shownCalls.has(record.tool_use_id)) break;
          shownCalls.add(record.tool_use_id);
          if (record.tool_name === 'SubagentHandback') {
            const handback = handbacks.get(record.tool_use_id) ?? record;
            lines.push(`**${time(record.ts)} · ${who} handed back**`, '', fenced(handback.data?.tool_input?.message ?? ''), '');
            break;
          }
          const response = responses.get(record.tool_use_id);
          const output = response?.data?.tool_response ?? response?.data?.error;
          const failed = response?.event === 'PostToolUseFailure' || response?.data?.is_error;
          const result = response ? ` → ${failed ? 'failed: ' : ''}${inlineCode(oneLine(output ?? '', 140))}` : '';
          const agent = record.agent_id ? ` (${who})` : '';
          lines.push(`- ${time(record.ts)} **${record.tool_name}**${agent} ${inlineCode(describeToolInput(record.tool_name, record.data?.tool_input))}${result}`);
          break;
        }
        case 'SubagentStart':
          lines.push(`- ${time(record.ts)} *subagent started: ${who}*`);
          break;
        case 'ContextInjected':
          lines.push(`- ${time(record.ts)} *context injected (${(record.data?.text ?? '').length} chars): ${inlineCode(oneLine(record.data?.text ?? '', 80))}*`);
          break;
        case 'Notification':
          lines.push(`- ${time(record.ts)} *notification: ${inlineCode(oneLine(record.data?.message ?? '', 120))}*`);
          break;
        case 'SessionStart':
        case 'SessionEnd':
        case 'PreCompact':
          lines.push(`- ${time(record.ts)} *${record.event}${record.data?.source ? ` (${record.data.source})` : ''}${record.data?.reason ? ` (${record.data.reason})` : ''}*`);
          break;
        default:
          break;
      }
    }
    lines.push('');
  }
  return `${lines.join('\n').replace(/\n{3,}/g, '\n\n').trimEnd()}\n`;
}

function main() {
  const logFile = resolve(process.argv[2] ?? join(repositoryRoot, 'ai-logs', 'ai-interactions.jsonl'));
  const outputFile = resolve(process.argv[3] ?? join(dirname(logFile), 'AI-INTERACTIONS.md'));
  if (!existsSync(logFile)) {
    process.stderr.write(`No log at ${logFile}\n`);
    process.exitCode = 1;
    return;
  }
  const records = readFileSync(logFile, 'utf8')
    .split('\n')
    .filter((line) => line.trim())
    .flatMap((line) => {
      try {
        return [JSON.parse(line)];
      } catch {
        return [];
      }
    });
  writeFileSync(outputFile, render(records), 'utf8');
  process.stdout.write(`Rendered ${records.length} records to ${outputFile}\n`);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) main();
