import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { capString, loadLocalRules, MAX_STRING_LENGTH, redactText, sanitize } from '../lib/redact.mjs';

// Every credential below is fake. The ones a secret scanner would flag (a JWT, a private
// key block, a Basic header value) are assembled at runtime, so this file holds none.
const JWT = ['eyJhbGciOiJub25lIn0', 'eyJzdWIiOiJkZW1vIn0', 'c2lnbmF0dXJl'].join('.');
const BASIC = Buffer.from('demo:not-a-secret').toString('base64');
const KEY_LINES = ['MIIEowIBAAKCAQEAfakefakefakefakefakefakefakefakefakefakefakefake', 'Zm9vYmFyZm9vYmFyZm9vYmFyZm9vYmFyZm9vYmFy', 'Zm9vYmFy=='];
const privateKey = (label, { end = true } = {}) =>
  [`-----BEGIN ${label}-----`, ...KEY_LINES, ...(end ? [`-----END ${label}-----`] : [])].join('\n');

const NON_WINDOWS_PATHS = [
  ['/Users/someone/Downloads/ai-sdlc', '~/Downloads/ai-sdlc'],
  ['cd /home/someone/projects && ls', 'cd ~/projects && ls'],
  ['/mnt/c/Users/someone/Downloads', '~/Downloads'],
  ['file:///Users/someone/notes.txt', 'file://~/notes.txt'],
  ['.claude/projects/-Users-someone-Downloads-ai-sdlc/x.jsonl', '.claude/projects/-Users-~-Downloads-ai-sdlc/x.jsonl'],
  ['.claude/projects/-home-someone-src/x.jsonl', '.claude/projects/-home-~-src/x.jsonl'],
  ['.claude/projects/-mnt-c-Users-someone-Downloads/x.jsonl', '.claude/projects/-mnt-c-Users-~-Downloads/x.jsonl'],
  ['\u001b[32mC:\\Users\\someone\\x\u001b[0m', '\u001b[32m~\\x\u001b[0m'],
];

const CREDENTIALS = [
  [`key:\n${privateKey('RSA PRIVATE KEY')}\ndone`, 'key:\n[REDACTED:private-key]\ndone'],
  [privateKey('OPENSSH PRIVATE KEY'), '[REDACTED:private-key]'],
  [`${privateKey('PRIVATE KEY', { end: false })}\nnext line`, '[REDACTED:private-key]\nnext line'],
  [`token ${JWT} end`, 'token [REDACTED:jwt] end'],
  [`Authorization: Basic ${BASIC}`, 'Authorization: Basic [REDACTED]'],
  [`curl -H 'authorization: basic ${BASIC}' x`, "curl -H 'authorization: basic [REDACTED]' x"],
  [`{"Authorization": "Basic ${BASIC}"}`, '{"Authorization": "Basic [REDACTED]"}'],
];

const SECRET_VALUES = [
  ['password=x', 'password=[REDACTED]'],
  ['password="x y"', 'password="[REDACTED]"'],
  ["password='x y'", "password='[REDACTED]'"],
  ['echo "password=x"', 'echo "password=[REDACTED]"'],
  ['token: abc123', 'token: [REDACTED]'],
  ['GITHUB_TOKEN=abc123 DB_PASSWORD=hunter2 npm publish', 'GITHUB_TOKEN=[REDACTED] DB_PASSWORD=[REDACTED] npm publish'],
  [
    'curl -d access_token=abc -d refresh_token=def -d client_secret=ghi',
    'curl -d access_token=[REDACTED] -d refresh_token=[REDACTED] -d client_secret=[REDACTED]',
  ],
  ['{"token": "abc123", "secret": "s3cr3t", "user": "demo"}', '{"token": "[REDACTED]", "secret": "[REDACTED]", "user": "demo"}'],
  [
    '{"access_token":"abc","refresh_token":"def","clientSecret":"ghi"}',
    '{"access_token":"[REDACTED]","refresh_token":"[REDACTED]","clientSecret":"[REDACTED]"}',
  ],
  [`id_token=${JWT}`, 'id_token=[REDACTED:jwt]'],
];

const LEFT_ALONE = [
  'GET /api/users/42 and https://example.com/home/docs',
  'Basic authentication is on; a public key stays: -----BEGIN PUBLIC KEY-----',
  'max_tokens=4096, "input_tokens": 12, token_count=3',
  'if (password == expected) items.map(token => token.trim())',
  '{"token": null, "secret": true}',
];

test('redacts GitHub tokens, bearer tokens and password values', () => {
  const text = 'token ghp_abcdefghijklmnopqrstuvwxyz0123 and Bearer 0123456789abcdef0123 then "password": "ChangeMe123!"';
  const result = redactText(text);
  assert.doesNotMatch(result, /ghp_/);
  assert.doesNotMatch(result, /0123456789abcdef0123/);
  assert.doesNotMatch(result, /ChangeMe123!/);
  assert.match(result, /\[REDACTED:github-token\]/);
  assert.match(result, /Bearer \[REDACTED\]/);
});

test('redacts personal emails but keeps the public noreply addresses', () => {
  const text = 'from someone.name@example.com, Co-Authored-By: Claude <noreply@anthropic.com>, 1+me@users.noreply.github.com';
  const result = redactText(text);
  assert.doesNotMatch(result, /someone\.name@example\.com/);
  assert.match(result, /noreply@anthropic\.com/);
  assert.match(result, /1\+me@users\.noreply\.github\.com/);
});

test('redacts private IP addresses but not version numbers', () => {
  const result = redactText('host 172.24.242.245 and 10.1.2.3, Windows 10.0.26200');
  assert.doesNotMatch(result, /172\.24\.242\.245/);
  assert.doesNotMatch(result, /10\.1\.2\.3/);
  assert.match(result, /10\.0\.26200/);
});

test('rewrites home directories in every spelling to ~', () => {
  const cases = [
    'C:\\Users\\someone\\Downloads\\ai-sdlc',
    'C:/Users/someone/Downloads/ai-sdlc',
    'C:\\\\Users\\\\someone\\\\Downloads',
    'C:\\Users\\SOMEON~1\\AppData\\Local\\Temp',
    '/c/Users/someone/Downloads/ai-sdlc',
    'projects/c--Users-someone-Downloads-ai-sdlc/x.jsonl',
  ];
  for (const path of cases) assert.doesNotMatch(redactText(path), /someone|SOMEON~1/i, path);
});

test('caps long strings with head, tail and a digest', () => {
  const long = `${'a'.repeat(MAX_STRING_LENGTH)}tail-marker`;
  const { text, truncated } = capString(long);
  assert.equal(truncated, true);
  assert.ok(text.length < long.length);
  assert.match(text, /chars omitted; original \d+ chars, sha256 [0-9a-f]{16}/);
  assert.ok(text.endsWith('tail-marker'));
  assert.deepEqual(capString('short'), { text: 'short', truncated: false });
});

test('sanitize redacts secret keys and leaves the input untouched', () => {
  const input = { login: { token: 'abc123', username: 'demo.manager' }, note: 'x'.repeat(MAX_STRING_LENGTH + 10) };
  const { value, redactions, truncated } = sanitize(input);
  assert.equal(value.login.token, '[REDACTED]');
  assert.equal(value.login.username, 'demo.manager');
  assert.equal(truncated, true);
  assert.ok(redactions >= 1);
  assert.equal(input.login.token, 'abc123');
});

test('sanitize without cap keeps long prompts whole', () => {
  const prompt = 'p'.repeat(MAX_STRING_LENGTH * 2);
  const { value, truncated } = sanitize({ prompt }, { cap: false });
  assert.equal(value.prompt, prompt);
  assert.equal(truncated, false);
});

test('rewrites macOS, Linux and WSL home directories and project folders to ~', () => {
  for (const [input, expected] of NON_WINDOWS_PATHS) assert.equal(redactText(input), expected, input);
});

test('redacts private key blocks, JWTs and Basic credentials', () => {
  for (const [input, expected] of CREDENTIALS) assert.equal(redactText(input), expected, input);
});

test('redacts password, token and secret values and keeps their quoting', () => {
  for (const [input, expected] of SECRET_VALUES) assert.equal(redactText(input), expected, input);
});

test('leaves routes, prose, counters, comparisons, lambdas and JSON literals alone', () => {
  for (const text of LEFT_ALONE) assert.equal(redactText(text), text);
});

test('redacting serialized JSON keeps it parseable and redacts inside its strings', () => {
  const original = {
    command: 'deploy password=x --token=abc123',
    quoted: `login password="x y" secret='z'`,
    json: '{"token": "abc123", "password": "x"}',
    prompt: 'Enter password:',
    lines: 'first line\npassword=x\nsomeone@example.com\nC:\\Users\\someone\\x',
    colored: '\u001b[32m/home/someone/x\u001b[0m',
    header: `Authorization: Basic ${BASIC}`,
    jwt: `id_token=${JWT}`,
    key: privateKey('RSA PRIVATE KEY'),
    paths: '"/Users/someone/x" and "C:\\Users\\someone\\y" and /mnt/c/Users/someone/z',
    password: 'a value under a secret key',
  };
  const expected = {
    command: 'deploy password=[REDACTED] --token=[REDACTED]',
    quoted: `login password="[REDACTED]" secret='[REDACTED]'`,
    json: '{"token": "[REDACTED]", "password": "[REDACTED]"}',
    prompt: 'Enter password:',
    lines: 'first line\npassword=[REDACTED]\n[REDACTED:email]\n~\\x',
    colored: '\u001b[32m~/x\u001b[0m',
    header: 'Authorization: Basic [REDACTED]',
    jwt: 'id_token=[REDACTED:jwt]',
    key: '[REDACTED:private-key]',
    paths: '"~/x" and "~\\y" and ~/z',
    password: '[REDACTED]',
  };
  assert.deepEqual(JSON.parse(redactText(JSON.stringify(original))), expected);
  assert.deepEqual(JSON.parse(redactText(JSON.stringify(original, null, 2))), expected);
  const twice = JSON.parse(redactText(JSON.stringify({ wrapped: JSON.stringify(original) })));
  assert.deepEqual(JSON.parse(twice.wrapped), expected);
});

test('redacting twice gives the same text, also for text redacted by the earlier rules', () => {
  const samples = [
    ...[...NON_WINDOWS_PATHS, ...CREDENTIALS, ...SECRET_VALUES].map(([input]) => input),
    ...LEFT_ALONE,
    'password="[REDACTED]" and api_key="[REDACTED]"',
    JSON.stringify({ text: SECRET_VALUES.map(([input]) => input).join('\n') }),
  ];
  for (const sample of samples) {
    const once = redactText(sample);
    assert.equal(redactText(once), once, sample);
  }
  assert.equal(redactText('password="[REDACTED]"'), 'password="[REDACTED]"');
});

test('a redact.local.json that does not parse is reported on stderr without its content', () => {
  const file = join(mkdtempSync(join(tmpdir(), 'redact-local-')), 'redact.local.json');
  writeFileSync(file, '{"patterns": [["intranet-host-name", "i", "[REDACTED:host]"]');
  const moduleUrl = new URL('../lib/redact.mjs', import.meta.url).href;
  const script = `import { loadLocalRules } from ${JSON.stringify(moduleUrl)}; loadLocalRules(${JSON.stringify(file)});`;
  const result = spawnSync(process.execPath, ['--input-type=module', '--eval', script], { encoding: 'utf8' });
  assert.equal(result.status, 0);
  assert.equal(result.stdout, '');
  assert.match(result.stderr, /redact\.local\.json does not parse as JSON/);
  assert.doesNotMatch(result.stderr, /intranet-host-name/);
});

test('a missing redact.local.json is silent, a valid one is loaded, a bad pattern is reported', () => {
  const directory = mkdtempSync(join(tmpdir(), 'redact-local-'));
  const warnings = [];
  const warn = (message) => warnings.push(message);
  assert.equal(loadLocalRules(join(directory, 'absent.json'), warn).rules.length, 0);
  const valid = join(directory, 'valid.json');
  writeFileSync(valid, JSON.stringify({ patterns: [['intranet\\.example', 'i', '[REDACTED:host]']], omitToolUseIds: ['toolu_1'] }));
  const loaded = loadLocalRules(valid, warn);
  assert.equal(loaded.rules.length, 1);
  assert.equal(loaded.rules[0].pattern.flags, 'gi');
  assert.ok(loaded.omitToolUseIds.has('toolu_1'));
  assert.deepEqual(warnings, []);
  const invalid = join(directory, 'invalid.json');
  writeFileSync(invalid, JSON.stringify({ patterns: [['(unclosed-group', 'i', 'x']] }));
  assert.equal(loadLocalRules(invalid, warn).rules.length, 0);
  assert.equal(warnings.length, 1);
  assert.match(warnings[0], /invalid\.json has an invalid pattern/);
  assert.doesNotMatch(warnings[0], /unclosed-group/);
});
