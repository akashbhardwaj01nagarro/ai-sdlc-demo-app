import assert from 'node:assert/strict';
import { test } from 'node:test';
import { capString, MAX_STRING_LENGTH, redactText, sanitize } from '../lib/redact.mjs';

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
