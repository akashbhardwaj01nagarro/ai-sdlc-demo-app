// Claude Code hook registered for every lifecycle event in .claude/settings.json.
// Appends one JSON line per event to ai-logs/ai-interactions.jsonl, all in one schema.
// It never blocks: nothing is written to stdout (some events feed stdout back to the
// model) and the exit code is always 0, even when the input cannot be read.
import { randomUUID } from 'node:crypto';
import { appendFileSync, mkdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { sanitize } from './lib/redact.mjs';

export const SCHEMA_VERSION = 1;

// Prompts, subagent briefs and final answers are the interaction itself: keep them whole.
const FULL_TEXT_EVENTS = new Set(['UserPromptSubmit', 'Stop', 'SubagentStop']);
const FULL_INPUT_TOOLS = new Set(['Agent', 'Task', 'Workflow', 'Skill', 'SendMessage', 'SubagentHandback']);

function eventData(input) {
  switch (input.hook_event_name) {
    case 'SessionStart':
      return { source: input.source ?? null, model: input.model ?? null };
    case 'UserPromptSubmit':
      return { prompt: input.prompt ?? '' };
    case 'PreToolUse':
      return { tool_input: input.tool_input ?? null };
    case 'PostToolUse':
      return {
        tool_input: input.tool_input ?? null,
        tool_response: input.tool_response ?? null,
        duration_ms: input.duration_ms ?? null,
      };
    case 'PostToolUseFailure':
      return {
        tool_input: input.tool_input ?? null,
        error: input.error ?? null,
        is_interrupt: input.is_interrupt ?? false,
        duration_ms: input.duration_ms ?? null,
      };
    case 'SubagentStart':
      return {};
    case 'SubagentStop':
    case 'Stop':
      return {
        last_assistant_message: input.last_assistant_message ?? null,
        stop_hook_active: input.stop_hook_active ?? false,
      };
    case 'PreCompact':
      return { trigger: input.trigger ?? null, custom_instructions: input.custom_instructions ?? null };
    case 'SessionEnd':
      return { reason: input.reason ?? null };
    case 'Notification':
      return {
        message: input.message ?? null,
        title: input.title ?? null,
        notification_type: input.notification_type ?? null,
      };
    default:
      return { input_keys: Object.keys(input) };
  }
}

export function buildRecord(input, { now = new Date(), origin = process.env.AI_LOG_ORIGIN || 'interactive' } = {}) {
  const event = input.hook_event_name ?? 'Unknown';
  const keepWhole =
    FULL_TEXT_EVENTS.has(event) || (event === 'PreToolUse' && FULL_INPUT_TOOLS.has(input.tool_name));
  const { value: data, redactions, truncated } = sanitize(eventData(input), { cap: !keepWhole });
  return {
    v: SCHEMA_VERSION,
    id: randomUUID(),
    ts: now.toISOString(),
    origin,
    event,
    session_id: input.session_id ?? null,
    prompt_id: input.prompt_id ?? null,
    agent_id: input.agent_id ?? null,
    agent_type: input.agent_type ?? null,
    tool_name: input.tool_name ?? null,
    tool_use_id: input.tool_use_id ?? null,
    src_uuid: null,
    src_index: null,
    redactions,
    truncated,
    data,
  };
}

export function logFilePath() {
  if (process.env.AI_LOG_FILE) return process.env.AI_LOG_FILE;
  const projectDirectory = process.env.CLAUDE_PROJECT_DIR || process.cwd();
  return join(projectDirectory, 'ai-logs', 'ai-interactions.jsonl');
}

function main() {
  const raw = readFileSync(0, 'utf8');
  const input = raw.trim() ? JSON.parse(raw) : {};
  const file = logFilePath();
  mkdirSync(dirname(file), { recursive: true });
  appendFileSync(file, `${JSON.stringify(buildRecord(input))}\n`, 'utf8');
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  try {
    main();
  } catch (error) {
    try {
      process.stderr.write(`ai-log hook skipped an event: ${error.message}\n`);
    } catch {
      // stderr is gone; nothing else to do
    }
  }
  process.exitCode = 0;
}
