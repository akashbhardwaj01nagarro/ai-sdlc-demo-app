// PreToolUse hook for Bash and PowerShell: keeps git and gh writes on the fork.
// It denies pushes to any remote other than origin (upstream is the workshop's repo),
// force pushes, gh pr/issue writes without --repo <fork>, writing gh api calls against
// the upstream repo, and --no-verify. Anything else falls through to the normal
// permission flow. A denial is reported as JSON on stdout; the exit code is always 0.
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

export const FORK = process.env.AI_SDLC_FORK || 'akashbhardwaj01nagarro/ai-sdlc-demo-app';
export const UPSTREAM = 'NITIN1670/ai-sdlc-demo-app';

const GH_WRITE_ACTIONS = {
  pr: new Set(['create', 'edit', 'comment', 'merge', 'close', 'reopen', 'review', 'ready']),
  issue: new Set(['create', 'edit', 'comment', 'close', 'reopen', 'delete', 'transfer']),
};
const GIT_OPTIONS_WITH_VALUE = new Set(['-C', '-c', '--git-dir', '--work-tree', '--namespace']);
const PUSH_OPTIONS_WITH_VALUE = new Set(['-o', '--push-option', '--receive-pack', '--exec', '--repo']);

export function splitSegments(command) {
  return command
    .split(/&&|\|\||;|\||\r?\n/)
    .map((segment) => segment.trim())
    .filter(Boolean);
}

export function tokenize(segment) {
  const tokens = [];
  let current = '';
  let quote = null;
  let inToken = false;
  for (const character of segment) {
    if (quote) {
      if (character === quote) quote = null;
      else current += character;
      continue;
    }
    if (character === '"' || character === "'") {
      quote = character;
      inToken = true;
    } else if (/\s/.test(character)) {
      if (inToken) tokens.push(current);
      current = '';
      inToken = false;
    } else {
      current += character;
      inToken = true;
    }
  }
  if (inToken) tokens.push(current);
  return tokens;
}

function optionValue(args, names) {
  for (let index = 0; index < args.length; index += 1) {
    for (const name of names) {
      if (args[index] === name) return args[index + 1] ?? '';
      if (name.startsWith('--') && args[index].startsWith(`${name}=`)) return args[index].slice(name.length + 1);
    }
  }
  return null;
}

function mentionsUpstream(text) {
  return text.toLowerCase().includes(UPSTREAM.toLowerCase());
}

function checkPush(args) {
  if (args.includes('--no-verify')) return 'Do not skip hooks: push without --no-verify.';
  if (args.some((arg) => arg === '--force' || arg === '-f' || /^-[a-zA-Z]*f[a-zA-Z]*$/.test(arg) || arg === '--mirror')) {
    return 'Force pushes are blocked. Add a new commit instead of rewriting pushed history.';
  }
  const positional = [];
  for (let index = 0; index < args.length; index += 1) {
    if (PUSH_OPTIONS_WITH_VALUE.has(args[index])) {
      index += 1;
    } else if (!args[index].startsWith('-')) {
      positional.push(args[index]);
    }
  }
  const remote = optionValue(args, ['--repo']) ?? positional[0];
  if (remote === undefined || remote === 'origin') return null;
  if (mentionsUpstream(remote) || remote === 'upstream') {
    return `Never push to ${UPSTREAM}. Push to origin (${FORK}) instead.`;
  }
  if (remote.toLowerCase().includes(FORK.toLowerCase())) return null;
  return `Only push to origin (${FORK}); "${remote}" is not the fork.`;
}

function checkCommit(args) {
  if (args.includes('--no-verify') || args.includes('-n')) {
    return 'Do not skip the commit-msg hook: commit without --no-verify and fix the message instead.';
  }
  return null;
}

function checkGh(args) {
  const [group, action] = args;
  if (group === 'api') {
    const method = (optionValue(args, ['-X', '--method']) ?? 'GET').toUpperCase();
    const hasFields = args.some((arg) => ['-f', '-F', '--field', '--raw-field', '--input'].includes(arg));
    const writes = method !== 'GET' || hasFields;
    if (writes && args.some(mentionsUpstream)) return `gh api writes to ${UPSTREAM} are blocked; only read it.`;
    return null;
  }
  const writeActions = GH_WRITE_ACTIONS[group];
  if (!writeActions || !writeActions.has(action)) return null;
  const repository = optionValue(args, ['--repo', '-R']);
  if (!repository) return `Pass --repo ${FORK} so the ${group} ${action} goes to the fork, never to ${UPSTREAM}.`;
  if (repository.toLowerCase() !== FORK.toLowerCase()) {
    return `--repo ${repository} is not the fork ${FORK}; ${group} ${action} must target the fork.`;
  }
  return null;
}

export function evaluate(command) {
  for (const segment of splitSegments(command)) {
    const tokens = tokenize(segment);
    let position = 0;
    while (position < tokens.length && /^[A-Za-z_][A-Za-z0-9_]*=/.test(tokens[position])) position += 1;
    const program = (tokens[position] ?? '').replace(/\.exe$/i, '').split(/[\\/]/).pop();
    const rest = tokens.slice(position + 1);
    if (program === 'git') {
      let index = 0;
      while (index < rest.length && rest[index].startsWith('-')) {
        index += GIT_OPTIONS_WITH_VALUE.has(rest[index]) ? 2 : 1;
      }
      const subcommand = rest[index];
      const subcommandArgs = rest.slice(index + 1);
      const reason =
        subcommand === 'push' ? checkPush(subcommandArgs) : subcommand === 'commit' ? checkCommit(subcommandArgs) : null;
      if (reason) return reason;
    } else if (program === 'gh') {
      const reason = checkGh(rest);
      if (reason) return reason;
    }
  }
  return null;
}

function main() {
  const raw = readFileSync(0, 'utf8');
  const input = raw.trim() ? JSON.parse(raw) : {};
  const command = input.tool_input?.command;
  if (typeof command !== 'string') return;
  const reason = evaluate(command);
  if (!reason) return;
  process.stdout.write(
    JSON.stringify({
      hookSpecificOutput: {
        hookEventName: 'PreToolUse',
        permissionDecision: 'deny',
        permissionDecisionReason: `guard-git: ${reason}`,
      },
    }),
  );
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  try {
    main();
  } catch (error) {
    try {
      process.stderr.write(`guard-git hook could not check the command: ${error.message}\n`);
    } catch {
      // stderr is gone; nothing else to do
    }
  }
  process.exitCode = 0;
}
