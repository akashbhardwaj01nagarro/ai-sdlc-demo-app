// Shared by the AI-log hook and the transcript exporter. Everything written under
// ai-logs/ passes through sanitize(): secrets and personal data are replaced, home
// directories become "~", and very long strings are capped (head + tail + sha256).
// redactText() is also safe on serialized JSON text: a replacement never adds or drops a
// quote or an escaping backslash, so a value keeps its quoting ("[REDACTED]", '[REDACTED]'
// or [REDACTED]) and the text still parses. Redacting twice gives the same text.
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const MAX_STRING_LENGTH = 8000;
const KEEP_HEAD = 6000;
const KEEP_TAIL = 1500;

// Addresses that are public by design and safe to keep.
const ALLOWED_EMAILS = [/^noreply@anthropic\.com$/i, /@users\.noreply\.github\.com$/i, /^git@github\.com$/i];

// Object keys whose string values are always secrets, whatever they look like.
const SECRET_KEY = /^(password|passwd|pwd|secret|client_secret|api[_-]?key|authorization|[a-z_]*token)$/i;

// Right after a terminal color code such as ESC[32m (written \u001b[32m in JSON).
const AFTER_COLOR = String.raw`(?<=(?:\x1b|\\+u001b)\[[0-9;]*m)`;
// Where a secret may start: at the start of a word, also right after a JSON escape such
// as \n or \t (a line start inside serialized JSON) or a color code, but never on the
// letter of such an escape, which would leave a dangling backslash behind.
const START = String.raw`(?:(?<![\w\\])|(?<=\\[bfnrt])|(?<=\\)(?![bfnrtu])|${AFTER_COLOR})`;
// Where a home path may start: not in the middle of a relative path such as ./c/Users.
const PATH_START = String.raw`(?:(?<![\w.~-])|(?<=\\[bfnrt])|${AFTER_COLOR})`;
// The user's folder in a home path: up to the next separator, quote, backslash or marker.
const USER_FOLDER = String.raw`[^\\/\s"'\`<>|:*?[\]]+`;
// A newline, also escaped as \n (or \r\n) inside a JSON string.
const NEWLINE = String.raw`(?:\r?\n|(?:\\+r)?\\+n)`;

// Names whose value is a secret, also with a prefix (DB_PASSWORD, GITHUB_TOKEN, x-api-key)
// or in camelCase (accessToken, clientSecret).
const SECRET_NAME = '(?:[A-Za-z0-9]+[_-]){0,4}(?:password|passwd|pwd|secret|token|api[_-]?key|client[_-]?secret|access[_-]?token|refresh[_-]?token)';
// =, : or := but not a comparison (==) or a lambda (=>).
const SEPARATOR = String.raw`[ \t]*(?::=|[:=](?![=>]))[ \t]*`;
// A double quote followed by , : ] or } ends a JSON string, so it does not open a value.
const OPENS_VALUE = String.raw`(?!(?:\s|\\+[nrt])*[,:\]}])`;
// An unquoted value ends at whitespace, a quote, a delimiter, an escape such as \n or \"
// (with any number of backslashes, for JSON inside JSON), or a marker left by an earlier
// redaction.
const BARE_VALUE = String.raw`(?:(?!\[REDACTED)(?:\\+[^\s"\\bfnrtu]|[^\s"'\\,;})\]]))+`;
// name=value, name: value and "name": "value", also inside a JSON string where the quotes
// are escaped (\"name\": \"value\"). Group 1 (name and separator) is kept, and so are the
// quotes: group 2 is a double quote with its escaping backslashes, reused as the closing
// quote; group 3 a single quote; group 4 a quote that is never closed. A quoted value
// holds no double quote and no partial run of backslashes, so it never reaches across a
// JSON string boundary at any depth. A bare value after a quoted name is a JSON number,
// literal or expression, so it is left alone.
const SECRET_VALUE = new RegExp(
  String.raw`(${START}${SECRET_NAME}(?:\\*["'])?${SEPARATOR})(?!\\*["']?\[REDACTED)(?:` +
    String.raw`(\\*")${OPENS_VALUE}(?:\\+[^"\\\n]|[^"\\\n])*?\2` +
    String.raw`|(')(?:\\+[^"\\\n]|[^'"\\\n])*'` +
    String.raw`|(\\*"|')${OPENS_VALUE}${BARE_VALUE}` +
    String.raw`|(?<!["'][ \t]*[:=][ \t]*)(?![{[])${BARE_VALUE})`,
  'gi',
);

const TEXT_RULES = [
  // A private key: the whole BEGIN ... END block or, when the END line is missing, the
  // header and the key lines after it.
  {
    pattern: new RegExp(
      String.raw`-----BEGIN ([A-Z0-9 ]*PRIVATE KEY(?: BLOCK)?)-----(?:(?:(?!-----BEGIN )[^"])*?-----END \1-----` +
        String.raw`|${NEWLINE}[A-Za-z0-9+/=]{16,}(?=[\r\n\\"]|$)(?:${NEWLINE}[A-Za-z0-9+/=]+(?=[\r\n\\"]|$))*)`,
      'g',
    ),
    replacement: '[REDACTED:private-key]',
  },
  { pattern: new RegExp(`${START}gh[pousr]_[A-Za-z0-9]{20,}`, 'g'), replacement: '[REDACTED:github-token]' },
  { pattern: new RegExp(`${START}github_pat_[A-Za-z0-9_]{20,}`, 'g'), replacement: '[REDACTED:github-token]' },
  { pattern: new RegExp(`${START}sk-ant-[A-Za-z0-9_-]{20,}`, 'g'), replacement: '[REDACTED:api-key]' },
  { pattern: new RegExp(String.raw`${START}AKIA[0-9A-Z]{16}\b`, 'g'), replacement: '[REDACTED:aws-key]' },
  { pattern: new RegExp(String.raw`${START}Bearer\s+[A-Za-z0-9._~+/=-]{16,}`, 'g'), replacement: 'Bearer [REDACTED]' },
  {
    pattern: new RegExp(String.raw`(${START}Authorization(?:\\*["'])?[ \t]*[:=][ \t]*(?:\\*["'])?Basic[ \t]+)[A-Za-z0-9+/_-]+=*`, 'gi'),
    replacement: '$1[REDACTED]',
  },
  // A JWT: three base64url segments, the first a JSON header ({" encodes as eyJ).
  { pattern: new RegExp(String.raw`${START}eyJ[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]{2,}\.[A-Za-z0-9_-]*`, 'g'), replacement: '[REDACTED:jwt]' },
  { pattern: SECRET_VALUE, replacement: '$1$2$3$4[REDACTED]$2$3' },
  {
    pattern: new RegExp(String.raw`${START}(?:10\.\d{1,3}|172\.(?:1[6-9]|2\d|3[01])|192\.168)\.\d{1,3}\.\d{1,3}\b`, 'g'),
    replacement: '[REDACTED:private-ip]',
  },
  // Windows home directories in every spelling: C:\Users\name, C:/Users/name, JSON-escaped
  // C:\\Users\\name, 8.3 short names like SOMEON~1, Git Bash /c/Users/name and WSL
  // /mnt/c/Users/name.
  { pattern: new RegExp(String.raw`${START}[A-Za-z]:(?:\\+|\/)(?:[Uu]sers|USERS)(?:\\+|\/)${USER_FOLDER}`, 'g'), replacement: '~' },
  { pattern: new RegExp(String.raw`${PATH_START}(?:\/mnt)?\/[a-z]\/Users\/${USER_FOLDER}`, 'gi'), replacement: '~' },
  // macOS /Users/name and Linux /home/name. Case-sensitive, so a web route like /users/42 stays.
  { pattern: new RegExp(String.raw`${PATH_START}\/(?:Users|home)\/${USER_FOLDER}`, 'g'), replacement: '~' },
  // Claude Code project folder names embed the home path: c--Users-name-Downloads-...,
  // and outside Windows -Users-name-..., -home-name-... or -mnt-c-Users-name-...
  { pattern: new RegExp(`${START}([A-Za-z]--Users-)[A-Za-z0-9._]+`, 'g'), replacement: '$1~' },
  { pattern: new RegExp(`${PATH_START}((?:-mnt-[a-z])?-(?:Users|home)-)[A-Za-z0-9._]+`, 'g'), replacement: '$1~' },
];

// An address starts where its run of name characters starts (like START, but the run's own
// characters do not count as a boundary), which keeps a long run without an @ linear.
const EMAIL = new RegExp(
  String.raw`(?:(?<![\w.%+\\-])|(?<=\\[bfnrt])|(?<=\\)(?![bfnrtu])|${AFTER_COLOR})[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}`,
  'g',
);

// One pass can expose a new match, because a replacement changes the text around it that
// an earlier rule saw. Passes repeat until nothing changes, so redacting is idempotent.
const MAX_PASSES = 4;

const claudeDirectory = dirname(dirname(dirname(fileURLToPath(import.meta.url))));
const LOCAL_RULES_FILE = join(claudeDirectory, 'redact.local.json');

function warnOnStderr(message) {
  process.stderr.write(`${message}\n`);
}

// Machine-specific patterns (internal host names, unrelated projects) live in a
// git-ignored file so that the patterns themselves are never published. A file that
// exists but cannot be used is skipped with a warning that names the file but never
// quotes its content or its full path.
export function loadLocalRules(file = LOCAL_RULES_FILE, warn = warnOnStderr) {
  const none = { rules: [], omitToolUseIds: new Set() };
  if (!existsSync(file)) return none;
  const name = basename(file);
  let config;
  try {
    config = JSON.parse(readFileSync(file, 'utf8'));
  } catch {
    warn(`redact: ${name} does not parse as JSON; its machine-specific patterns are not applied.`);
    return none;
  }
  try {
    const rules = (config.patterns ?? []).map(([source, flags, replacement]) => ({
      pattern: new RegExp(source, flags.includes('g') ? flags : `${flags}g`),
      replacement,
    }));
    return { rules, omitToolUseIds: new Set(config.omitToolUseIds ?? []) };
  } catch {
    warn(`redact: ${name} has an invalid pattern; its machine-specific patterns are not applied.`);
    return none;
  }
}

const localRules = loadLocalRules();

export function shouldOmitToolUse(toolUseId) {
  return Boolean(toolUseId) && localRules.omitToolUseIds.has(toolUseId);
}

function redactOnce(text, stats) {
  let result = text;
  for (const { pattern, replacement } of [...TEXT_RULES, ...localRules.rules]) {
    result = result.replace(pattern, (...match) => {
      stats.redactions += 1;
      return replacement.replace(/\$(\d)/g, (_, group) => match[Number(group)] ?? '');
    });
  }
  return result.replace(EMAIL, (address) => {
    if (ALLOWED_EMAILS.some((allowed) => allowed.test(address))) return address;
    stats.redactions += 1;
    return '[REDACTED:email]';
  });
}

export function redactText(text, stats = { redactions: 0 }) {
  let result = text;
  for (let pass = 0; pass < MAX_PASSES; pass += 1) {
    const next = redactOnce(result, stats);
    if (next === result) break;
    result = next;
  }
  return result;
}

export function capString(text) {
  if (text.length <= MAX_STRING_LENGTH) return { text, truncated: false };
  const digest = createHash('sha256').update(text).digest('hex').slice(0, 16);
  const omitted = text.length - KEEP_HEAD - KEEP_TAIL;
  return {
    text: `${text.slice(0, KEEP_HEAD)}\n…[${omitted} chars omitted; original ${text.length} chars, sha256 ${digest}]…\n${text.slice(-KEEP_TAIL)}`,
    truncated: true,
  };
}

// Returns a redacted (and, with cap, length-capped) deep copy plus what was changed.
export function sanitize(value, { cap = true } = {}) {
  const stats = { redactions: 0, truncated: false };
  const visit = (node) => {
    if (typeof node === 'string') {
      const redacted = redactText(node, stats);
      if (!cap) return redacted;
      const capped = capString(redacted);
      stats.truncated ||= capped.truncated;
      return capped.text;
    }
    if (Array.isArray(node)) return node.map(visit);
    if (node && typeof node === 'object') {
      const copy = {};
      for (const [key, child] of Object.entries(node)) {
        if (SECRET_KEY.test(key) && typeof child === 'string' && child.length > 0) {
          stats.redactions += 1;
          copy[key] = '[REDACTED]';
        } else {
          copy[key] = visit(child);
        }
      }
      return copy;
    }
    return node;
  };
  const sanitized = visit(value);
  return { value: sanitized, redactions: stats.redactions, truncated: stats.truncated };
}
