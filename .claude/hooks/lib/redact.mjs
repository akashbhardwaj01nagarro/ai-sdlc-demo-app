// Shared by the AI-log hook and the transcript exporter. Everything written under
// ai-logs/ passes through sanitize(): secrets and personal data are replaced, home
// directories become "~", and very long strings are capped (head + tail + sha256).
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const MAX_STRING_LENGTH = 8000;
const KEEP_HEAD = 6000;
const KEEP_TAIL = 1500;

// Addresses that are public by design and safe to keep.
const ALLOWED_EMAILS = [/^noreply@anthropic\.com$/i, /@users\.noreply\.github\.com$/i, /^git@github\.com$/i];
const EMAIL = /[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}/g;

// Object keys whose string values are always secrets, whatever they look like.
const SECRET_KEY = /^(password|passwd|pwd|secret|client_secret|api[_-]?key|authorization|[a-z_]*token)$/i;

const TEXT_RULES = [
  { pattern: /\bgh[pousr]_[A-Za-z0-9]{20,}/g, replacement: '[REDACTED:github-token]' },
  { pattern: /\bgithub_pat_[A-Za-z0-9_]{20,}/g, replacement: '[REDACTED:github-token]' },
  { pattern: /\bsk-ant-[A-Za-z0-9_-]{20,}/g, replacement: '[REDACTED:api-key]' },
  { pattern: /\bAKIA[0-9A-Z]{16}\b/g, replacement: '[REDACTED:aws-key]' },
  { pattern: /\bBearer\s+[A-Za-z0-9._~+/=-]{16,}/g, replacement: 'Bearer [REDACTED]' },
  {
    pattern: /("?\b(?:password|passwd|pwd|client_secret|api[_-]?key)\b"?\s*[:=]\s*)("[^"\n]*"|'[^'\n]*'|[^\s,;})\]]+)/gi,
    replacement: '$1"[REDACTED]"',
  },
  {
    pattern: /\b(?:10\.\d{1,3}|172\.(?:1[6-9]|2\d|3[01])|192\.168)\.\d{1,3}\.\d{1,3}\b/g,
    replacement: '[REDACTED:private-ip]',
  },
  // Windows home directories in every spelling: C:\Users\name, C:/Users/name,
  // JSON-escaped C:\\Users\\name, 8.3 short names like AKASHB~1, and Git Bash /c/Users/name.
  { pattern: /\b[A-Za-z]:(?:\\\\|\\|\/)Users(?:\\\\|\\|\/)[^\\/\s"'`<>|:*?]+/gi, replacement: '~' },
  { pattern: /(?<![\w.~-])\/[a-z]\/Users\/[^/\s"'`<>|:*?]+/gi, replacement: '~' },
  // Claude Code project folder names embed the home path: c--Users-name-Downloads-...
  { pattern: /\b([A-Za-z]--Users-)[A-Za-z0-9._]+/g, replacement: '$1~' },
];

const hooksDirectory = dirname(dirname(fileURLToPath(import.meta.url)));

// Machine-specific patterns (internal host names, unrelated projects) live in a
// git-ignored file so that the patterns themselves are never published.
function loadLocalRules() {
  const file = join(dirname(hooksDirectory), 'redact.local.json');
  if (!existsSync(file)) return { rules: [], omitToolUseIds: new Set() };
  try {
    const config = JSON.parse(readFileSync(file, 'utf8'));
    const rules = (config.patterns ?? []).map(([source, flags, replacement]) => ({
      pattern: new RegExp(source, flags.includes('g') ? flags : `${flags}g`),
      replacement,
    }));
    return { rules, omitToolUseIds: new Set(config.omitToolUseIds ?? []) };
  } catch {
    return { rules: [], omitToolUseIds: new Set() };
  }
}

const localRules = loadLocalRules();

export function shouldOmitToolUse(toolUseId) {
  return Boolean(toolUseId) && localRules.omitToolUseIds.has(toolUseId);
}

export function redactText(text, stats = { redactions: 0 }) {
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
