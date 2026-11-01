// Re-applies the current redaction rules to every record already in the AI log, for
// example after a new pattern was added to .claude/redact.local.json. Idempotent: text
// that is already redacted stays the same. Tool results listed under omitToolUseIds are
// replaced. Lines are rewritten in place, in the same order.
//
//   node scripts/ai-log/redact-log.mjs [log.jsonl]
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { sanitize, shouldOmitToolUse } from '../../.claude/hooks/lib/redact.mjs';

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const OMITTED = '[omitted from the log: unrelated local configuration]';

export function redactRecord(record) {
  const data = { ...record.data };
  if (shouldOmitToolUse(record.tool_use_id) && ['PostToolUse', 'PostToolUseFailure'].includes(record.event)) {
    if ('tool_response' in data) data.tool_response = OMITTED;
    if ('error' in data) data.error = OMITTED;
  }
  const { value, redactions } = sanitize(data, { cap: false });
  return { ...record, redactions: (record.redactions ?? 0) + redactions, data: value };
}

export function redactLines(lines) {
  let changed = 0;
  const output = lines.map((line) => {
    if (!line.trim()) return line;
    let record;
    try {
      record = JSON.parse(line);
    } catch {
      return line;
    }
    const redacted = redactRecord(record);
    if (JSON.stringify(redacted.data) === JSON.stringify(record.data)) return line;
    changed += 1;
    return JSON.stringify(redacted);
  });
  return { output, changed };
}

function main() {
  const logFile = resolve(process.argv[2] ?? join(repositoryRoot, 'ai-logs', 'ai-interactions.jsonl'));
  const { output, changed } = redactLines(readFileSync(logFile, 'utf8').split('\n'));
  if (changed) writeFileSync(logFile, output.join('\n'), 'utf8');
  process.stdout.write(`Re-redacted ${changed} records in ${logFile}\n`);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) main();
