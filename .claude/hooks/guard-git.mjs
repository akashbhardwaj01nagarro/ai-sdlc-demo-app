// PreToolUse hook for Bash and PowerShell: keeps git and gh writes on the fork.
// It denies pushes to any remote other than origin (upstream is the workshop's repo), force
// pushes, skipped or replaced git hooks (--no-verify, core.hooksPath), remotes or settings
// that point at the upstream, gh writes that are not aimed at the fork, and gh api writes
// against the upstream. Commands are found wherever they run: after &&, ||, ;, |, & and
// newlines, inside ( ) and $( ), behind wrappers such as env or PowerShell's & operator, and
// inside bash -c / powershell -Command / Invoke-Expression strings. Heredoc and here-string
// bodies (commit messages) are not commands and are skipped. Anything else falls through to
// the normal permission flow. A denial is reported as JSON on stdout, and input the hook
// cannot read is denied too; the exit code is always 0.
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

export const FORK = process.env.AI_SDLC_FORK || 'akashbhardwaj01nagarro/ai-sdlc-demo-app';
export const UPSTREAM = 'NITIN1670/ai-sdlc-demo-app';

const GH_WRITE_ACTIONS = {
  pr: new Set(['create', 'edit', 'comment', 'merge', 'close', 'reopen', 'review', 'ready', 'update-branch', 'lock', 'unlock']),
  issue: new Set(['create', 'edit', 'comment', 'close', 'reopen', 'delete', 'transfer', 'lock', 'unlock', 'pin', 'unpin']),
  release: new Set(['create', 'edit', 'delete', 'upload', 'delete-asset']),
  label: new Set(['create', 'edit', 'delete', 'clone']),
  repo: new Set(['edit', 'delete', 'rename', 'archive', 'unarchive', 'set-default']),
  workflow: new Set(['run', 'enable', 'disable']),
  secret: new Set(['set', 'delete']),
  variable: new Set(['set', 'delete']),
};
// gh commands that must name the fork explicitly instead of relying on the default repository.
const GH_NEEDS_EXPLICIT_REPO = new Set(['pr', 'issue']);
const GIT_OPTIONS_WITH_VALUE = new Set(['-C', '-c', '--git-dir', '--work-tree', '--namespace', '--config-env']);
const PUSH_OPTIONS_WITH_VALUE = new Set(['-o', '--push-option', '--receive-pack', '--exec', '--repo']);
const WRAPPERS = new Set(['env', 'command', 'exec', 'sudo', 'time', 'nohup', 'nice', 'xargs', 'call', '&']);
// Shells and evaluators whose argument is itself a command line.
const COMMAND_STRING_FLAGS = {
  bash: ['-c'],
  sh: ['-c'],
  zsh: ['-c'],
  dash: ['-c'],
  pwsh: ['-c', '-command'],
  powershell: ['-c', '-command'],
  cmd: ['/c', '/k'],
  'invoke-expression': [''],
  iex: [''],
};
const MAX_NESTING = 4;

const lower = (text) => text.toLowerCase();
const mentionsUpstream = (text) => lower(text).includes(lower(UPSTREAM));
const isFork = (text) => lower(text) === lower(FORK) || lower(text).endsWith(`/${lower(FORK)}`) || lower(text).endsWith(`/${lower(FORK)}.git`);

// Removes heredoc bodies (<<EOF … EOF) and PowerShell here-strings (@' … '@): they are data,
// usually commit messages, and must not be read as commands.
export function withoutHereDocuments(command) {
  const kept = [];
  let terminator = null;
  for (const line of command.split(/\r?\n/)) {
    if (terminator) {
      if (terminator.test(line)) terminator = null;
      continue;
    }
    kept.push(line);
    const heredoc = /<<(-?)\s*(['"]?)([A-Za-z_]\w*)\2/.exec(line);
    if (heredoc) {
      terminator = heredoc[1] ? new RegExp(`^\\s*${heredoc[3]}\\s*$`) : new RegExp(`^${heredoc[3]}\\s*$`);
    } else if (/@(['"])\s*$/.test(line)) {
      const quote = /@(['"])\s*$/.exec(line)[1];
      terminator = new RegExp(`^${quote}@`);
    }
  }
  return kept.join('\n');
}

// Splits a command line into simple commands on && || ; | & newlines and ( ), outside quotes.
// A & that belongs to a redirection (2>&1, &>file) does not split.
export function splitSegments(command) {
  const segments = [];
  let current = '';
  let quote = null;
  for (let index = 0; index < command.length; index += 1) {
    const character = command[index];
    if (quote) {
      if (character === quote) quote = null;
      current += character;
      continue;
    }
    if (character === '"' || character === "'") {
      quote = character;
      current += character;
      continue;
    }
    const previous = command[index - 1];
    const next = command[index + 1];
    const isRedirectionAmpersand = character === '&' && (previous === '>' || previous === '<' || next === '>');
    if ('\n;|()'.includes(character) || (character === '&' && !isRedirectionAmpersand)) {
      segments.push(current);
      current = '';
      continue;
    }
    if (character !== '\r') current += character;
  }
  segments.push(current);
  return segments.map((segment) => segment.trim()).filter(Boolean);
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

// Drops shell redirections such as 2>&1, >/dev/null or "> out.txt" so they are not
// mistaken for a remote name or another argument.
export function withoutRedirections(tokens) {
  const kept = [];
  for (let index = 0; index < tokens.length; index += 1) {
    const redirection = /^(\d*|&)(>>?|<)(.*)$/.exec(tokens[index]);
    if (!redirection) kept.push(tokens[index]);
    else if (redirection[3] === '') index += 1;
  }
  return kept;
}

function programName(token) {
  return lower((token ?? '').replace(/^.*[\\/]/, '').replace(/\.(exe|cmd|bat)$/i, ''));
}

// Every value of an option, including --name=value, -Xvalue and repeated flags.
function optionValues(args, names, { attachedShortForms = false } = {}) {
  const values = [];
  for (let index = 0; index < args.length; index += 1) {
    for (const name of names) {
      if (args[index] === name) values.push(args[index + 1] ?? '');
      else if (name.startsWith('--') && args[index].startsWith(`${name}=`)) values.push(args[index].slice(name.length + 1));
      else if (attachedShortForms && /^-[A-Za-z]$/.test(name) && args[index].startsWith(name) && args[index].length > 2) {
        values.push(args[index].slice(2));
      }
    }
  }
  return values;
}

function gitConfigOverrides(environment) {
  return [...environment.entries()].filter(([name]) => /^GIT_CONFIG/i.test(name)).map(([, value]) => value);
}

function checkPush(args) {
  if (args.includes('--no-verify')) return 'Do not skip hooks: push without --no-verify.';
  const isForceFlag = (arg) => arg === '--force' || arg === '--mirror' || (/^-[a-zA-Z]+$/.test(arg) && arg.includes('f'));
  const positional = [];
  for (let index = 0; index < args.length; index += 1) {
    if (PUSH_OPTIONS_WITH_VALUE.has(args[index])) index += 1;
    else if (!args[index].startsWith('-')) positional.push(args[index]);
  }
  if (args.some(isForceFlag) || positional.slice(1).some((refspec) => refspec.startsWith('+'))) {
    return 'Force pushes are blocked (including +refspecs). Add a new commit instead of rewriting pushed history.';
  }
  const remote = optionValues(args, ['--repo'])[0] ?? positional[0];
  if (remote === undefined || remote === 'origin') return null;
  if (mentionsUpstream(remote) || remote === 'upstream') return `Never push to ${UPSTREAM}. Push to origin (${FORK}) instead.`;
  if (lower(remote).includes(lower(FORK))) return null;
  return `Only push to origin (${FORK}); "${remote}" is not the fork.`;
}

function checkCommit(args) {
  const skipsHooks = (arg) => arg === '--no-verify' || (/^-[a-zA-Z]+$/.test(arg) && arg.includes('n'));
  if (args.some(skipsHooks)) return 'Do not skip the commit-msg hook: commit without --no-verify (or -n) and fix the message instead.';
  return null;
}

function checkRemote(args) {
  const [action, ...rest] = args;
  if (!['add', 'set-url'].includes(action)) return null;
  if (rest.some(mentionsUpstream)) return `Do not point a git remote at ${UPSTREAM}; work happens on the fork.`;
  return null;
}

function checkConfig(args) {
  const lowered = args.map(lower);
  const hooksIndex = lowered.findIndex((arg) => arg === 'core.hookspath');
  const unsets = lowered.includes('--unset') || lowered.includes('--unset-all');
  const newValue = args[hooksIndex + 1];
  if (hooksIndex >= 0 && (unsets || (newValue !== undefined && newValue !== '.githooks'))) {
    return 'core.hooksPath must stay .githooks so the commit-msg hook keeps running.';
  }
  const remoteUrlIndex = lowered.findIndex((arg) => /^remote\..+\.(push)?url$/.test(arg));
  if (remoteUrlIndex >= 0 && args.slice(remoteUrlIndex + 1).some(mentionsUpstream)) {
    return `Do not point a git remote at ${UPSTREAM}; work happens on the fork.`;
  }
  return null;
}

function checkGit(args, environment) {
  // Global options come before the subcommand; -c values among them override configuration.
  const overrides = gitConfigOverrides(environment);
  let index = 0;
  while (index < args.length && args[index].startsWith('-')) {
    if (args[index] === '-c') overrides.push(args[index + 1] ?? '');
    else if (args[index].startsWith('-c') && args[index].length > 2) overrides.push(args[index].slice(2));
    index += GIT_OPTIONS_WITH_VALUE.has(args[index]) ? 2 : 1;
  }
  for (const setting of overrides) {
    if (/core\.hookspath/i.test(setting)) return 'Do not replace git hooks: core.hooksPath must stay .githooks.';
    if (/remote\..+\.(push)?url/i.test(setting) && mentionsUpstream(setting)) {
      return `Do not point a git remote at ${UPSTREAM}; work happens on the fork.`;
    }
  }
  const subcommandArgs = args.slice(index + 1);
  switch (args[index]) {
    case 'push':
      return checkPush(subcommandArgs);
    case 'commit':
      return checkCommit(subcommandArgs);
    case 'remote':
      return checkRemote(subcommandArgs);
    case 'config':
      return checkConfig(subcommandArgs);
    default:
      return null;
  }
}

function checkGhApi(args, environment) {
  const methods = optionValues(args, ['-X', '--method'], { attachedShortForms: true }).map((method) => method.toUpperCase());
  const fieldFlags = ['-f', '-F', '--field', '--raw-field', '--input'];
  const hasFields = args.some((arg) => fieldFlags.includes(arg) || /^-[fF]./.test(arg) || /^--(field|raw-field|input)=/.test(arg));
  const writes = methods.some((method) => method !== 'GET') || hasFields;
  if (!writes) return null;
  const ghRepo = environment.get('GH_REPO') ?? '';
  const aimsAtUpstream = args.some(mentionsUpstream) || (mentionsUpstream(ghRepo) && args.some((arg) => arg.includes('{owner}') || arg.includes('{repo}')));
  return aimsAtUpstream ? `gh api writes to ${UPSTREAM} are blocked; only read it.` : null;
}

function checkGh(args, environment) {
  const [group, action] = args;
  if (group === 'api') return checkGhApi(args, environment);
  if (!GH_WRITE_ACTIONS[group]?.has(action)) return null;
  const repositories = optionValues(args, ['--repo', '-R'], { attachedShortForms: true });
  const ghRepo = environment.get('GH_REPO');
  if (ghRepo !== undefined && !isFork(ghRepo)) return `GH_REPO=${ghRepo} is not the fork ${FORK}; ${group} ${action} must target the fork.`;
  const notFork = repositories.find((repository) => !isFork(repository));
  if (notFork !== undefined) return `--repo ${notFork} is not the fork ${FORK}; ${group} ${action} must target the fork.`;
  if (args.some(mentionsUpstream)) return `${group} ${action} must not name ${UPSTREAM}.`;
  if (GH_NEEDS_EXPLICIT_REPO.has(group) && repositories.length === 0 && ghRepo === undefined) {
    return `Pass --repo ${FORK} so the ${group} ${action} goes to the fork, never to ${UPSTREAM}.`;
  }
  return null;
}

// Reads leading VAR=value assignments and wrapper words, and returns where the program starts.
function commandStart(tokens, environment) {
  const local = new Map(environment);
  let position = 0;
  while (position < tokens.length) {
    const assignment = /^([A-Za-z_]\w*)=(.*)$/s.exec(tokens[position]);
    if (assignment) {
      local.set(assignment[1], assignment[2]);
      position += 1;
      continue;
    }
    const name = programName(tokens[position]);
    if (!WRAPPERS.has(name)) break;
    position += 1;
    while (name !== '&' && tokens[position]?.startsWith('-')) position += 1;
  }
  return { position, local };
}

// Remembers variables set for later commands: export VAR=value, set VAR=value, $env:VAR = value.
function rememberAssignment(tokens, environment) {
  const powershell = /^\$env:([A-Za-z_]\w*)(?:=(.*))?$/i.exec(tokens[0] ?? '');
  if (powershell) {
    const value = powershell[2] ?? (tokens[1] === '=' ? tokens[2] : tokens[1]?.replace(/^=/, ''));
    environment.set(powershell[1].toUpperCase(), value ?? '');
    return true;
  }
  const keyword = programName(tokens[0]);
  if ((keyword === 'export' || keyword === 'set') && tokens.length > 1) {
    for (const token of tokens.slice(1)) {
      const assignment = /^([A-Za-z_]\w*)=(.*)$/s.exec(token);
      if (assignment) environment.set(assignment[1].toUpperCase(), assignment[2]);
    }
    return true;
  }
  if (tokens.length > 0 && tokens.every((token) => /^[A-Za-z_]\w*=/.test(token))) {
    for (const token of tokens) {
      const [name, ...value] = token.split('=');
      environment.set(name.toUpperCase(), value.join('='));
    }
    return true;
  }
  return false;
}

function checkSegment(segment, environment, depth) {
  const tokens = withoutRedirections(tokenize(segment));
  if (rememberAssignment(tokens, environment)) return null;
  const { position, local } = commandStart(tokens, environment);
  const program = programName(tokens[position]);
  const rest = tokens.slice(position + 1);
  const upperCaseLocal = new Map([...local.entries()].map(([name, value]) => [name.toUpperCase(), value]));
  if (program === 'git') return checkGit(rest, upperCaseLocal);
  if (program === 'gh') return checkGh(rest, upperCaseLocal);
  const flags = COMMAND_STRING_FLAGS[program];
  if (flags && depth < MAX_NESTING) {
    const flagIndex = flags[0] === '' ? -1 : rest.findIndex((arg) => flags.includes(lower(arg)));
    const inner = flags[0] === '' ? rest.join(' ') : flagIndex >= 0 ? rest.slice(flagIndex + 1).join(' ') : '';
    if (inner) return evaluate(inner, depth + 1, environment);
  }
  return null;
}

export function evaluate(command, depth = 0, environment = new Map()) {
  for (const segment of splitSegments(withoutHereDocuments(command))) {
    const reason = checkSegment(segment, environment, depth);
    if (reason) return reason;
  }
  return null;
}

export function decide(raw) {
  let command;
  try {
    command = JSON.parse(raw).tool_input?.command;
  } catch {
    command = undefined;
  }
  if (typeof command !== 'string') return 'guard-git could not read the command, so it was not allowed.';
  return evaluate(command);
}

function main() {
  const reason = decide(readFileSync(0, 'utf8'));
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
    // Fail closed: a guard that cannot decide must not let the command through.
    try {
      process.stdout.write(
        JSON.stringify({
          hookSpecificOutput: {
            hookEventName: 'PreToolUse',
            permissionDecision: 'deny',
            permissionDecisionReason: `guard-git failed (${error.message}), so the command was not allowed.`,
          },
        }),
      );
    } catch {
      // stdout is gone; nothing else to do
    }
  }
  process.exitCode = 0;
}
