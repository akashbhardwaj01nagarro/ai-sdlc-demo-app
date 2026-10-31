import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { evaluate, FORK, tokenize, withoutRedirections } from '../guard-git.mjs';

const hook = fileURLToPath(new URL('../guard-git.mjs', import.meta.url));

test('allows pushes to origin and plain pushes', () => {
  for (const command of ['git push -u origin 001-approval-limits', 'git push', 'git push origin HEAD', 'cd repo && git push origin main']) {
    assert.equal(evaluate(command), null, command);
  }
});

test('ignores shell redirections around a push', () => {
  for (const command of ['git push 2>&1 | tail -1', 'git push origin x >/dev/null 2>&1', 'git push > push.log', 'git push -u origin x &> out.txt']) {
    assert.equal(evaluate(command), null, command);
  }
  assert.notEqual(evaluate('git push upstream main 2>&1'), null);
  assert.deepEqual(withoutRedirections(['git', 'push', '2>&1', '>', 'log.txt', 'origin']), ['git', 'push', 'origin']);
});

test('blocks pushes to upstream, by name or URL, and other remotes', () => {
  for (const command of [
    'git push upstream main',
    'git push https://github.com/NITIN1670/ai-sdlc-demo-app.git HEAD:main',
    'git -C repo push upstream',
    'git fetch && git push somewhere-else main',
  ]) {
    assert.notEqual(evaluate(command), null, command);
  }
});

test('blocks force pushes and skipped hooks', () => {
  for (const command of ['git push --force origin main', 'git push -f', 'git push -uf origin x', 'git push --no-verify', 'git commit --no-verify -m x', 'git commit -n -m x']) {
    assert.notEqual(evaluate(command), null, command);
  }
  assert.equal(evaluate('git push --force-with-lease origin x'), null);
});

test('gh pull request and issue writes must name the fork', () => {
  assert.notEqual(evaluate('gh pr create --base main --title x'), null);
  assert.notEqual(evaluate('gh pr create --repo NITIN1670/ai-sdlc-demo-app --title x'), null);
  assert.notEqual(evaluate('gh issue create -R someone/else --title x'), null);
  assert.equal(evaluate(`gh pr create --repo ${FORK} --base main --head 001-approval-limits`), null);
  assert.equal(evaluate(`gh pr comment 1 -R ${FORK} --body-file x.md`), null);
  assert.equal(evaluate('gh pr view 1'), null);
  assert.equal(evaluate('gh pr diff 1'), null);
});

test('gh api may read upstream but never write to it', () => {
  assert.equal(evaluate('gh api repos/NITIN1670/ai-sdlc-demo-app/contents/README.md -H "Accept: application/vnd.github.raw"'), null);
  assert.notEqual(evaluate('gh api -X POST repos/NITIN1670/ai-sdlc-demo-app/issues -f title=x'), null);
  assert.equal(evaluate(`gh api -X PUT repos/${FORK}/actions/permissions -F enabled=true`), null);
});

test('text that only mentions a push inside a quoted message is not a push', () => {
  assert.equal(evaluate('git commit -m "Why: never git push upstream"'), null);
  assert.deepEqual(tokenize('git commit -m "a b" \'c d\''), ['git', 'commit', '-m', 'a b', 'c d']);
});

test('the hook prints a deny decision as JSON and always exits 0', () => {
  const denied = spawnSync(process.execPath, [hook], { input: JSON.stringify({ tool_input: { command: 'git push upstream main' } }) });
  assert.equal(denied.status, 0);
  const output = JSON.parse(denied.stdout.toString());
  assert.equal(output.hookSpecificOutput.permissionDecision, 'deny');
  assert.match(output.hookSpecificOutput.permissionDecisionReason, /NITIN1670/);

  const allowed = spawnSync(process.execPath, [hook], { input: JSON.stringify({ tool_input: { command: 'dotnet test' } }) });
  assert.equal(allowed.status, 0);
  assert.equal(allowed.stdout.toString(), '');

  const garbage = spawnSync(process.execPath, [hook], { input: 'nope' });
  assert.equal(garbage.status, 0);
  assert.equal(garbage.stdout.toString(), '');
});
