// Git commit-msg hook (wired through .githooks/commit-msg and core.hooksPath): enforces the
// commit message format from AGENTS.md so every commit says what changed and why.
//   type(scope): what changed            <- at most 72 characters
//                                        <- blank line
//   What: ...
//   Why: ...
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

const SUBJECT = /^(feat|fix|test|refactor|docs|chore|build|ci|perf|style|revert)(\([a-z0-9-]+\))?: \S/;
const EXEMPT_SUBJECT = /^(Merge |Revert "|fixup! |squash! |amend! )/;

export function problemsWith(message) {
  const lines = message
    .replace(/\r\n/g, '\n')
    .split('\n')
    .filter((line) => !line.startsWith('#'));
  const subject = lines[0] ?? '';
  if (EXEMPT_SUBJECT.test(subject)) return [];
  const problems = [];
  if (!SUBJECT.test(subject)) {
    problems.push(
      'The subject must read "type(scope): what changed", with type one of feat, fix, test, refactor, docs, chore, build, ci, perf, style or revert.',
    );
  }
  if (subject.length > 72) problems.push(`The subject is ${subject.length} characters long; keep it to 72.`);
  if (lines.length > 1 && lines[1].trim() !== '') problems.push('Leave a blank line after the subject.');
  const body = lines.slice(1).join('\n');
  if (!/^What: \S/m.test(body)) problems.push('The body needs a paragraph starting with "What: " that says what changed.');
  if (!/^Why: \S/m.test(body)) problems.push('The body needs a paragraph starting with "Why: " that says why.');
  return problems;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const problems = problemsWith(readFileSync(process.argv[2], 'utf8'));
  if (problems.length > 0) {
    process.stderr.write(`commit-msg: message rejected (see AGENTS.md)\n- ${problems.join('\n- ')}\n`);
    process.exitCode = 1;
  }
}
