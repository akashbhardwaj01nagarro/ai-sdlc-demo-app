// SubagentStop hook (declared as a Stop hook in a subagent's frontmatter): makes the
// reviewing subagents finish with one fenced ```json report in a fixed shape, so their
// output can be merged, rendered and compared run to run. Usage:
//   node check-report.mjs <review|test-critique|mutation|audit>
// A malformed report blocks the stop once with instructions; when stop_hook_active is
// set the subagent is already retrying, so it is let through to avoid a loop.
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

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
  const candidate = blocks.length ? blocks[blocks.length - 1][1] : (message ?? '').trim();
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

function main() {
  const schemaName = process.argv[2];
  const raw = readFileSync(0, 'utf8');
  const input = raw.trim() ? JSON.parse(raw) : {};
  if (input.stop_hook_active || !SCHEMAS[schemaName]) return;
  const problems = validate(schemaName, input.last_assistant_message);
  if (problems.length === 0) return;
  process.stdout.write(
    JSON.stringify({
      decision: 'block',
      reason:
        `Your report is not in the required format (${problems.slice(0, 8).join('; ')}). ` +
        `End your answer with exactly one fenced \`\`\`json block shaped like ${SCHEMAS[schemaName].shape}. ` +
        'Keep the findings you already have; only fix the format.',
    }),
  );
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
