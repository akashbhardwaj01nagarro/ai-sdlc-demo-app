import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { decide, evaluate, FORK, splitSegments, tokenize, UPSTREAM, withoutHereDocuments, withoutRedirections } from '../guard-git.mjs';

const hook = fileURLToPath(new URL('../guard-git.mjs', import.meta.url));
const UPSTREAM_URL = `https://github.com/${UPSTREAM}.git`;

function assertAllowed(commands) {
  for (const command of commands) assert.equal(evaluate(command), null, `should allow: ${command}`);
}

function assertDenied(commands) {
  for (const command of commands) assert.notEqual(evaluate(command), null, `should deny: ${command}`);
}

test('allows the commands this repository actually uses', () => {
  assertAllowed([
    'git push',
    'git push -u origin 001-approval-limits',
    'git push origin HEAD',
    'cd repo && git push origin main',
    'git push 2>&1 | tail -1',
    'git push origin x >/dev/null 2>&1',
    'git push > push.log',
    'git push -u origin x &> out.txt',
    'git push --force-with-lease origin x',
    'git -C repo status',
    'git commit -q -F - <<\'EOF\'\nfeat(x): y\n\nWhat: never git push upstream main\nWhy: z\nEOF',
    'git commit -am "fix: n"',
    'git config core.hooksPath .githooks',
    'git config --get core.hooksPath',
    'git remote set-url --push upstream DISABLED',
    `gh pr create --repo ${FORK} --base main --head 001-approval-limits --body-file x.md`,
    `gh pr comment 1 -R ${FORK} --body-file x.md`,
    `gh pr edit 1 --repo=${FORK} --body-file x.md`,
    'gh pr view 1',
    'gh pr diff 1',
    `GH_REPO=${FORK} gh pr comment 1 --body x`,
    `gh api repos/${UPSTREAM}/contents/README.md -H "Accept: application/vnd.github.raw"`,
    `gh api -X PUT repos/${FORK}/actions/permissions -F enabled=true`,
    `gh repo set-default ${FORK}`,
    'node --test ".claude/hooks/tests/*.test.mjs"',
    "node - <<'EOF'\nconst text = 'git push upstream main';\nEOF",
  ]);
});

test('blocks pushes to the upstream, by name or URL, and to other remotes', () => {
  assertDenied([
    'git push upstream main',
    `git push ${UPSTREAM_URL} HEAD:main`,
    'git -C repo push upstream',
    'git fetch && git push somewhere-else main',
    'git push upstream main 2>&1',
  ]);
});

test('R-03: finds git and gh behind separators, wrappers, subshells and nested shells', () => {
  assertDenied([
    `& gh pr create --repo ${UPSTREAM} --title x`,
    `& "C:\\Program Files\\GitHub CLI\\gh.exe" pr create --repo ${UPSTREAM} --title x`,
    `env gh issue create --repo ${UPSTREAM} --title x`,
    `command gh issue create --repo ${UPSTREAM} --title x`,
    "bash -c 'git push upstream main'",
    `powershell -Command "gh pr create --repo ${UPSTREAM} --title x"`,
    'Invoke-Expression "git push upstream main"',
    '(git push upstream main)',
    'echo $(git push upstream main)',
    'echo x & git push upstream main',
    'GIT_TRACE=1 git push upstream main',
  ]);
});

test('R-03: every --repo value and GH_REPO must be the fork', () => {
  assertDenied([
    `gh pr create --repo ${FORK} --repo ${UPSTREAM} --title x`,
    `gh pr create -R${UPSTREAM} --title x`,
    `gh pr create --repo=${UPSTREAM} --title x`,
    `GH_REPO=${UPSTREAM} gh pr comment 1 --body x`,
    `export GH_REPO=${UPSTREAM}; gh issue create --title x`,
    `$env:GH_REPO = '${UPSTREAM}'; gh issue create --title x`,
    `gh release create v1 --repo ${UPSTREAM}`,
    `gh label create bug --repo ${UPSTREAM}`,
    `gh pr update-branch 1 --repo ${UPSTREAM}`,
    `gh repo set-default ${UPSTREAM}`,
    'gh pr create --base main --title x',
  ]);
});

test('R-03: gh api writes to the upstream are blocked in every spelling', () => {
  assertDenied([
    `gh api -X POST repos/${UPSTREAM}/issues -f title=x`,
    `gh api -XPOST repos/${UPSTREAM}/issues -ftitle=x`,
    `gh api --method=POST repos/${UPSTREAM}/issues`,
    `gh api repos/${UPSTREAM}/issues --raw-field=title=x`,
    `gh api repos/${UPSTREAM}/issues --field title=x`,
    `GH_REPO=${UPSTREAM} gh api -X POST repos/{owner}/{repo}/issues -f title=x`,
  ]);
});

test('R-03: remotes and settings may not point at the upstream', () => {
  assertDenied([
    `git remote set-url origin ${UPSTREAM_URL}`,
    `git remote add other ${UPSTREAM_URL}`,
    `git -c remote.origin.pushurl=${UPSTREAM_URL} push origin`,
    `git config remote.origin.url ${UPSTREAM_URL}`,
  ]);
});

test('R-09: force pushes, skipped hooks and replaced hooks are blocked', () => {
  assertDenied([
    'git push --force origin main',
    'git push -f',
    'git push -uf origin x',
    'git push origin +main',
    'git push origin +HEAD:main',
    'git push --no-verify',
    'git commit --no-verify -m x',
    'git commit -n -m x',
    'git commit -anm x',
    'git -c core.hooksPath=/dev/null commit -m x',
    'git -C repo -c core.hooksPath=/dev/null commit -m x',
    "GIT_CONFIG_PARAMETERS=\"'core.hooksPath'='/dev/null'\" git commit -m x",
    'GIT_CONFIG_COUNT=1 GIT_CONFIG_KEY_0=core.hooksPath GIT_CONFIG_VALUE_0=/dev/null git commit -m x',
    'git config core.hooksPath /dev/null',
    'git config --unset core.hooksPath',
  ]);
});

test('helpers: segments split outside quotes, heredoc bodies are dropped, redirections ignored', () => {
  assert.deepEqual(splitSegments('a && b; c | d & e (f) "g; h"'), ['a', 'b', 'c', 'd', 'e', 'f', '"g; h"']);
  assert.deepEqual(splitSegments('git push 2>&1 | tail -1'), ['git push 2>&1', 'tail -1']);
  assert.equal(withoutHereDocuments("cat <<'EOF'\ngit push upstream main\nEOF\necho done"), "cat <<'EOF'\necho done");
  assert.equal(withoutHereDocuments("git commit -F - <<-EOF\n\tbody\n\tEOF\nnext"), 'git commit -F - <<-EOF\nnext');
  assert.equal(withoutHereDocuments("git commit -m @'\ngit push upstream\n'@\ngit status"), "git commit -m @'\ngit status");
  assert.deepEqual(tokenize('git commit -m "a b" \'c d\''), ['git', 'commit', '-m', 'a b', 'c d']);
  assert.deepEqual(withoutRedirections(['git', 'push', '2>&1', '>', 'log.txt', 'origin']), ['git', 'push', 'origin']);
});

test('R-08: input that cannot be read is denied', () => {
  assert.match(decide('not json'), /could not read the command/);
  assert.match(decide(''), /could not read the command/);
  assert.match(decide(JSON.stringify({ tool_input: {} })), /could not read the command/);
  assert.equal(decide(JSON.stringify({ tool_input: { command: 'dotnet test' } })), null);
});

test('the hook prints a deny decision as JSON, prints nothing when it allows, and always exits 0', () => {
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
  assert.equal(JSON.parse(garbage.stdout.toString()).hookSpecificOutput.permissionDecision, 'deny');
});
