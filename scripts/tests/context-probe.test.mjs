import assert from 'node:assert/strict';
import { test } from 'node:test';
import { judgePrompt, parseJudgement, PROBES, regexScore } from '../context-probe.mjs';

const p1 = PROBES.find((probe) => probe.id === 'P1');

test('every probe fact has a label, a regex and a claim for the judge', () => {
  for (const probe of PROBES) {
    for (const [label, pattern, claim] of probe.facts) {
      assert.equal(typeof label, 'string');
      assert.ok(pattern instanceof RegExp);
      assert.ok(claim.endsWith('.'), `${probe.id}: ${claim}`);
    }
  }
});

test('the judge prompt carries the question, the answer and numbered claims, but no arm', () => {
  const prompt = judgePrompt(p1, 'A Director approves 75,000.');
  assert.match(prompt, /According to this project's approval rules, who may approve an invoice of 75,000/);
  assert.match(prompt, /<answer>\nA Director approves 75,000\.\n<\/answer>/);
  assert.match(prompt, /1\. An invoice of 75,000 must be approved by a Director/);
  assert.match(prompt, /3\. For 600,000 the second approval/);
  assert.doesNotMatch(prompt, /\b(OLD|NEW|arm)\b/);
});

test('judgements are accepted only with one boolean per fact', () => {
  assert.deepEqual(parseJudgement('{"facts": [true, false, true]}', 3), [true, false, true]);
  assert.deepEqual(parseJudgement('Sure:\n```json\n{"facts":[false,false,false]}\n```', 3), [false, false, false]);
  assert.equal(parseJudgement('{"facts": [true, false]}', 3), null);
  assert.equal(parseJudgement('{"facts": ["yes", false, true]}', 3), null);
  assert.equal(parseJudgement('no json', 3), null);
});

test('regex scoring marks each fact', () => {
  const scored = regexScore(p1, 'One Director for 75,000; two approvals, the second approval by a Director.');
  assert.deepEqual(scored.map((fact) => fact.hit), [true, true, true]);
});
