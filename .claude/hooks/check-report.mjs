// Makes the reviewing subagents hand back one fenced ```json report in a fixed shape, so
// their output can be merged, rendered and compared run to run. Both hooks are registered
// in .claude/settings.json and pick the schema from agent_type (other agents pass):
//   - PreToolUse on SubagentHandback: a subagent started with the Agent tool returns its
//     report through this tool call; a malformed report is denied with the reason, so the
//     subagent fixes the format and hands back again.
//   - SubagentStop: checks the final message (workflow agents end with it) or, when that
//     is empty, the last hand-back in the subagent's transcript, and blocks once; when
//     stop_hook_active is set the subagent is already retrying.
// Hooks declared in a subagent's frontmatter never ran in this harness, so none are used.
// A schema can also be named directly: node check-report.mjs <review|test-critique|mutation|audit>
// Every check is recorded in the AI log as a "ReportCheck" event.
import { appendFileSync, existsSync, readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { buildRecord, logFilePath } from './ai-log.mjs';

export const AGENT_SCHEMAS = {
  'pr-reviewer': 'review',
  'review-rules': 'review',
  'review-tests': 'review',
  'review-security': 'review',
  'test-critic': 'test-critique',
  'mutation-analyst': 'mutation',
  'log-auditor': 'audit',
};

const SEVERITIES = ['blocker', 'major', 'minor', 'nit'];
const RULE_AREAS = ['FR-001', 'FR-002', 'FR-003', 'FR-004', 'FR-005', 'layering', 'tests', 'security', 'conventions', 'other'];

function requireString(object, key, path, problems, { allowEmpty = false } = {}) {
  const value = object?.[key];
  if (typeof value !== 'string' || (!allowEmpty && value.trim() === '')) problems.push(`${path}.${key} must be a non-empty string`);
}

function requireOneOf(object, key, allowed, path, problems) {
  if (!allowed.includes(object?.[key])) problems.push(`${path}.${key} must be one of ${allowed.join(', ')}`);
}

function requireArray(object, key, path, problems) {
  if (!Array.isArray(object?.[key])) {
    problems.push(`${path}.${key} must be an array (use [] when there is nothing to report)`);
    return [];
  }
  return object[key];
}

function requireNullableNumber(object, key, path, problems) {
  const value = object?.[key];
  if (!(value === null || (typeof value === 'number' && Number.isFinite(value)))) problems.push(`${path}.${key} must be a number or null`);
}

export const SCHEMAS = {
  review: {
    shape:
      '{"reviewer": "<agent name>", "scope": "<what was reviewed>", "findings": [{"id": "R-01", "severity": "blocker|major|minor|nit", ' +
      '"rule": "FR-001..FR-005|layering|tests|security|conventions|other", "file": "path/from/repo/root", "line": 12, ' +
      '"title": "...", "evidence": "...", "suggested_fix": "...", "proposed_verdict": "fix|dismiss|defer", "proposed_reason": "..."}]}',
    check(report, problems) {
      requireString(report, 'reviewer', 'report', problems);
      requireString(report, 'scope', 'report', problems);
      requireArray(report, 'findings', 'report', problems).forEach((finding, index) => {
        const path = `findings[${index}]`;
        if (!/^[A-Z]+-\d+$/.test(finding?.id ?? '')) problems.push(`${path}.id must look like R-01`);
        requireOneOf(finding, 'severity', SEVERITIES, path, problems);
        requireOneOf(finding, 'rule', RULE_AREAS, path, problems);
        requireString(finding, 'file', path, problems);
        if (!Number.isInteger(finding?.line) || finding.line < 0) problems.push(`${path}.line must be a whole number (0 if not line-specific)`);
        for (const key of ['title', 'evidence', 'suggested_fix', 'proposed_reason']) requireString(finding, key, path, problems);
        requireOneOf(finding, 'proposed_verdict', ['fix', 'dismiss', 'defer'], path, problems);
      });
    },
  },
  'test-critique': {
    shape:
      '{"tests": [{"test": "Class.Method", "rule": "FR-00x|other", "catches": "the wrong implementation this test fails for", ' +
      '"weakness": "... or null", "verdict": "keep|strengthen|replace|delete", "suggestion": "... or null"}], ' +
      '"missing": [{"rule": "FR-00x", "case": "the untested case"}]}',
    check(report, problems) {
      requireArray(report, 'tests', 'report', problems).forEach((test, index) => {
        const path = `tests[${index}]`;
        requireString(test, 'test', path, problems);
        requireString(test, 'rule', path, problems);
        requireString(test, 'catches', path, problems);
        requireOneOf(test, 'verdict', ['keep', 'strengthen', 'replace', 'delete'], path, problems);
        if (test?.verdict !== 'keep' && typeof test?.suggestion !== 'string') problems.push(`${path}.suggestion is required unless the verdict is keep`);
      });
      requireArray(report, 'missing', 'report', problems).forEach((gap, index) => {
        requireString(gap, 'rule', `missing[${index}]`, problems);
        requireString(gap, 'case', `missing[${index}]`, problems);
      });
    },
  },
  mutation: {
    shape:
      '{"score_scoped": 91.3, "score_whole": 52.1, "survivors": [{"file": "path", "line": 12, "mutator": "...", "rule": "FR-00x|other", ' +
      '"classification": "missing-test|equivalent|out-of-scope", "proposed_test": "... or null", "reason": "..."}]}',
    check(report, problems) {
      requireNullableNumber(report, 'score_scoped', 'report', problems);
      requireNullableNumber(report, 'score_whole', 'report', problems);
      requireArray(report, 'survivors', 'report', problems).forEach((survivor, index) => {
        const path = `survivors[${index}]`;
        requireString(survivor, 'file', path, problems);
        if (!Number.isInteger(survivor?.line)) problems.push(`${path}.line must be a whole number`);
        requireString(survivor, 'mutator', path, problems);
        requireString(survivor, 'rule', path, problems);
        requireString(survivor, 'reason', path, problems);
        requireOneOf(survivor, 'classification', ['missing-test', 'equivalent', 'out-of-scope'], path, problems);
        if (survivor?.classification === 'missing-test' && typeof survivor?.proposed_test !== 'string') {
          problems.push(`${path}.proposed_test is required for a missing-test survivor`);
        }
      });
    },
  },
  audit: {
    shape: '{"clean": true, "issues": [{"pattern": "...", "count": 3, "example": "redacted excerpt", "action": "..."}]}',
    check(report, problems) {
      if (typeof report?.clean !== 'boolean') problems.push('report.clean must be true or false');
      requireArray(report, 'issues', 'report', problems).forEach((issue, index) => {
        const path = `issues[${index}]`;
        requireString(issue, 'pattern', path, problems);
        if (!Number.isInteger(issue?.count)) problems.push(`${path}.count must be a whole number`);
        requireString(issue, 'example', path, problems, { allowEmpty: true });
        requireString(issue, 'action', path, problems);
      });
    },
  },
};

export function extractReport(message) {
  const blocks = [...(message ?? '').matchAll(/```json[^\S\r\n]*\r?\n([\s\S]*?)\r?\n```/g)];
  const candidate = blocks.length ? blocks.at(-1)[1] : (message ?? '').trim();
  return JSON.parse(candidate);
}

// Returns the list of problems; an empty list means the report is acceptable.
export function validate(schemaName, message) {
  const schema = SCHEMAS[schemaName];
  if (!schema) return [];
  let report;
  try {
    report = extractReport(message);
  } catch {
    return ['the final message has no parseable ```json block'];
  }
  const problems = [];
  schema.check(report, problems);
  return problems;
}

// The text a subagent last handed back, read from its own transcript: the message of its
// final SubagentHandback call, or else its last plain text.
export function lastHandback(transcriptPath) {
  if (!transcriptPath || !existsSync(transcriptPath)) return '';
  const entries = readFileSync(transcriptPath, 'utf8')
    .split('\n')
    .filter((line) => line.trim())
    .flatMap((line) => {
      try {
        return [JSON.parse(line)];
      } catch {
        return [];
      }
    })
    .filter((entry) => entry.type === 'assistant');
  for (const entry of entries.reverse()) {
    const blocks = Array.isArray(entry.message?.content) ? [...entry.message.content].reverse() : [];
    for (const block of blocks) {
      if (block.type === 'tool_use' && block.name === 'SubagentHandback' && typeof block.input?.message === 'string') return block.input.message;
      if (block.type === 'text' && block.text?.trim()) return block.text;
    }
  }
  return '';
}

// Works out what to check and how to answer for one hook call; null means nothing to do.
export function planCheck(input, schemaArgument) {
  if (input.hook_event_name === 'PreToolUse') {
    if (input.tool_name !== 'SubagentHandback') return null;
    const schemaName = AGENT_SCHEMAS[input.agent_type];
    if (!schemaName) return null;
    return { schemaName, text: input.tool_input?.message ?? '', source: 'handback' };
  }
  const schemaName = SCHEMAS[schemaArgument] ? schemaArgument : AGENT_SCHEMAS[input.agent_type];
  if (!schemaName || input.stop_hook_active) return null;
  if (input.last_assistant_message?.trim()) return { schemaName, text: input.last_assistant_message, source: 'final-message' };
  return { schemaName, text: lastHandback(input.agent_transcript_path), source: 'transcript' };
}

export function decision(input, schemaName, problems) {
  const reason =
    `Your report is not in the required format (${problems.slice(0, 8).join('; ')}). ` +
    `End it with exactly one fenced \`\`\`json block shaped like ${SCHEMAS[schemaName].shape}. ` +
    'Keep the findings you already have; only fix the format.';
  if (input.hook_event_name === 'PreToolUse') {
    return { hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'deny', permissionDecisionReason: `check-report: ${reason}` } };
  }
  return { decision: 'block', reason };
}

function recordCheck(input, plan, problems) {
  const record = buildRecord({ hook_event_name: 'ReportCheck', session_id: input.session_id, prompt_id: input.prompt_id, agent_id: input.agent_id, agent_type: input.agent_type, tool_name: input.tool_name, tool_use_id: input.tool_use_id });
  record.data = { checked_on: input.hook_event_name, schema: plan.schemaName, source: plan.source, result: problems.length ? 'rejected' : 'accepted', problems: problems.slice(0, 8) };
  appendFileSync(logFilePath(), `${JSON.stringify(record)}\n`, 'utf8');
}

function main() {
  const raw = readFileSync(0, 'utf8');
  const input = raw.trim() ? JSON.parse(raw) : {};
  const plan = planCheck(input, process.argv[2]);
  if (!plan) return;
  const problems = validate(plan.schemaName, plan.text);
  try {
    recordCheck(input, plan, problems);
  } catch {
    // logging must never decide the outcome
  }
  if (problems.length === 0) return;
  process.stdout.write(JSON.stringify(decision(input, plan.schemaName, problems)));
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  try {
    main();
  } catch (error) {
    try {
      process.stderr.write(`check-report hook could not validate: ${error.message}\n`);
    } catch {
      // stderr is gone; nothing else to do
    }
  }
  process.exitCode = 0;
}
