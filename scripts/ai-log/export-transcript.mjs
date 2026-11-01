// Imports Claude Code session transcripts into ai-logs/ai-interactions.jsonl in the same
// schema as the hook logger, with origin "backfill". It covers what hooks did not record:
// everything before the hooks existed in a session, and afterwards the assistant text
// written between tool calls. Re-running it adds nothing new (records are keyed by
// transcript uuid, block index and event).
//
//   node scripts/ai-log/export-transcript.mjs --session <session-id> [--session <id>...]
//   node scripts/ai-log/export-transcript.mjs --project          every session of this repo
//   node scripts/ai-log/export-transcript.mjs <transcript.jsonl> ...
import { randomUUID } from 'node:crypto';
import { appendFileSync, existsSync, mkdirSync, readFileSync, readdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { SCHEMA_VERSION } from '../../.claude/hooks/ai-log.mjs';
import { sanitize, shouldOmitToolUse } from '../../.claude/hooks/lib/redact.mjs';

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const FULL_INPUT_TOOLS = new Set(['Agent', 'Task', 'Workflow', 'Skill', 'SendMessage', 'SubagentHandback']);

export function textOf(content) {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  return content
    .map((block) => {
      if (block.type === 'text') return block.text;
      if (block.type === 'tool_reference') return `[tool loaded: ${block.tool_name}]`;
      return `[${block.type} omitted]`;
    })
    .join('\n');
}

function recordKey(record) {
  return `${record.src_uuid}#${record.src_index}#${record.event}`;
}

// Turns transcript lines into log records. Periods a hook already logged (at or after
// the first interactive record of that session) only contribute assistant text.
export function recordsFromTranscript(lines, { agentType = null, hookStartBySession = new Map() } = {}) {
  const toolNames = new Map();
  const records = [];
  let unparseable = 0;
  for (const line of lines) {
    if (!line.trim()) continue;
    let entry;
    try {
      entry = JSON.parse(line);
    } catch {
      unparseable += 1;
      continue;
    }
    if (entry.type !== 'user' && entry.type !== 'assistant') continue;
    const hookStart = hookStartBySession.get(entry.sessionId);
    const coveredByHooks = Boolean(hookStart) && entry.timestamp >= hookStart;
    const add = (event, data, index, { toolName = null, toolUseId = null, keepWhole = false } = {}) => {
      const { value, redactions, truncated } = sanitize(data, { cap: !keepWhole });
      records.push({
        v: SCHEMA_VERSION,
        id: randomUUID(),
        ts: entry.timestamp,
        origin: 'backfill',
        event,
        session_id: entry.sessionId ?? null,
        prompt_id: entry.promptId ?? null,
        agent_id: entry.agentId ?? null,
        agent_type: entry.agentId ? agentType : null,
        tool_name: toolName,
        tool_use_id: toolUseId,
        src_uuid: entry.uuid ?? null,
        src_index: index,
        redactions,
        truncated,
        data: value,
      });
    };
    const content = entry.message?.content;
    if (entry.type === 'assistant') {
      (Array.isArray(content) ? content : []).forEach((block, index) => {
        if (block.type === 'tool_use') toolNames.set(block.id, block.name);
        if (block.type === 'text' && block.text?.trim()) {
          add('AssistantText', { text: block.text }, index, { keepWhole: true });
        } else if (block.type === 'tool_use' && (!coveredByHooks || block.name === 'SubagentHandback')) {
          // A subagent's hand-back is its final report; hooks may have logged it shortened,
          // so it is always imported whole as well.
          add('PreToolUse', { tool_input: block.input ?? null }, index, {
            toolName: block.name,
            toolUseId: block.id,
            keepWhole: FULL_INPUT_TOOLS.has(block.name),
          });
        }
      });
      continue;
    }
    if (coveredByHooks) continue;
    if (Array.isArray(content) && content.some((block) => block.type === 'tool_result')) {
      content.forEach((block, index) => {
        if (block.type !== 'tool_result') return;
        const response = shouldOmitToolUse(block.tool_use_id)
          ? '[omitted from the log: unrelated local configuration]'
          : textOf(block.content);
        add('PostToolUse', { tool_response: response, is_error: block.is_error ?? false }, index, {
          toolName: toolNames.get(block.tool_use_id) ?? null,
          toolUseId: block.tool_use_id,
        });
      });
      continue;
    }
    const text = textOf(content);
    if (!text.trim()) continue;
    if (entry.isMeta) add('ContextInjected', { text }, 0);
    else if (entry.origin?.kind === 'task-notification') add('Notification', { message: text, notification_type: 'task-notification' }, 0);
    else add('UserPromptSubmit', { prompt: text }, 0, { keepWhole: true });
  }
  return { records, unparseable };
}

function readLog(logFile) {
  if (!existsSync(logFile)) return [];
  return readFileSync(logFile, 'utf8')
    .split('\n')
    .filter((line) => line.trim())
    .flatMap((line) => {
      try {
        return [JSON.parse(line)];
      } catch {
        return [];
      }
    });
}

export function hookStartsFrom(existing) {
  const starts = new Map();
  for (const record of existing) {
    if (record.origin !== 'interactive' || !record.session_id) continue;
    const known = starts.get(record.session_id);
    if (!known || record.ts < known) starts.set(record.session_id, record.ts);
  }
  return starts;
}

function subagentTranscripts(sessionDirectory) {
  const found = [];
  const walk = (directory) => {
    if (!existsSync(directory)) return;
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) walk(path);
      else if (/^agent-.+\.jsonl$/.test(entry.name)) found.push(path);
    }
  };
  walk(join(sessionDirectory, 'subagents'));
  return found.sort();
}

function agentTypeFor(transcript) {
  const metaFile = transcript.replace(/\.jsonl$/, '.meta.json');
  if (!existsSync(metaFile)) return null;
  try {
    const meta = JSON.parse(readFileSync(metaFile, 'utf8'));
    return meta.description ? `${meta.agentType} · ${meta.description}` : meta.agentType ?? null;
  } catch {
    return null;
  }
}

function projectsRoot() {
  return join(process.env.CLAUDE_CONFIG_DIR || join(homedir(), '.claude'), 'projects');
}

function projectSlug(directory) {
  return directory.replace(/[^A-Za-z0-9]/g, '-').toLowerCase();
}

function transcriptsForSession(sessionId) {
  const root = projectsRoot();
  if (!existsSync(root)) return [];
  for (const project of readdirSync(root)) {
    const main = join(root, project, `${sessionId}.jsonl`);
    if (existsSync(main)) return [main, ...subagentTranscripts(join(root, project, sessionId))];
  }
  return [];
}

function transcriptsForProject(directory) {
  const root = projectsRoot();
  if (!existsSync(root)) return [];
  const wanted = projectSlug(directory);
  const project = readdirSync(root).find((name) => name.toLowerCase() === wanted);
  if (!project) return [];
  const projectDirectory = join(root, project);
  return readdirSync(projectDirectory)
    .filter((name) => name.endsWith('.jsonl'))
    .sort()
    .flatMap((name) => [join(projectDirectory, name), ...subagentTranscripts(join(projectDirectory, basename(name, '.jsonl')))]);
}

export function exportTranscripts(transcripts, logFile) {
  const existing = readLog(logFile);
  const seen = new Set(existing.filter((record) => record.origin === 'backfill').map(recordKey));
  const hookStartBySession = hookStartsFrom(existing);
  const summary = [];
  mkdirSync(dirname(logFile), { recursive: true });
  for (const transcript of transcripts) {
    const lines = readFileSync(transcript, 'utf8').split('\n');
    const { records, unparseable } = recordsFromTranscript(lines, { agentType: agentTypeFor(transcript), hookStartBySession });
    const fresh = records.filter((record) => !seen.has(recordKey(record)));
    fresh.forEach((record) => seen.add(recordKey(record)));
    if (fresh.length) appendFileSync(logFile, fresh.map((record) => `${JSON.stringify(record)}\n`).join(''), 'utf8');
    summary.push({ transcript: basename(transcript), added: fresh.length, duplicates: records.length - fresh.length, unparseable });
  }
  return summary;
}

function main() {
  const args = process.argv.slice(2);
  const logFile = process.env.AI_LOG_FILE || join(repositoryRoot, 'ai-logs', 'ai-interactions.jsonl');
  const transcripts = [];
  for (let index = 0; index < args.length; index += 1) {
    if (args[index] === '--session') transcripts.push(...transcriptsForSession(args[++index]));
    else if (args[index] === '--project') transcripts.push(...transcriptsForProject(repositoryRoot));
    else transcripts.push(resolve(args[index]));
  }
  if (transcripts.length === 0) {
    process.stderr.write('No transcripts found. Pass --session <id>, --project, or transcript paths.\n');
    process.exitCode = 1;
    return;
  }
  for (const row of exportTranscripts(transcripts, logFile)) {
    process.stdout.write(`${row.transcript}: added ${row.added}, already logged ${row.duplicates}, unparseable ${row.unparseable}\n`);
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) main();
