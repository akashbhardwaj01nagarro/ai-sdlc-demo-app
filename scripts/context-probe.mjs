// Shows whether AGENTS.md changes what a cold agent knows. It asks the same questions,
// with headless `claude -p`, in two checkouts that differ only in AGENTS.md, and writes
// the raw answers, scores.csv and README.md. Every run is appended to the AI log with
// origin "probe".
//
// Each answer is scored twice: by a blind judge (a separate tool-less `claude -p` call
// that sees only the question, the answer and the facts, never the arm) and by quick
// regexes. The judge is the headline score; the regexes are kept as a cross-check.
//
//   node scripts/context-probe.mjs --old <checkout> --new <checkout> [--runs 2]
//        [--model haiku] [--out docs/evidence/context-probe] [--concurrency 4]
//   node scripts/context-probe.mjs --rescore [--out ...]   re-score saved answers only
import { spawn } from 'node:child_process';
import { appendFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { buildRecord, logFilePath } from '../.claude/hooks/ai-log.mjs';
import { sanitize } from '../.claude/hooks/lib/redact.mjs';

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const ANSWER_RULE = 'Answer only from the files in this repository; do not change anything. Answer in at most 150 words.';

// facts: [label, regex, claim the judge checks]
export const PROBES = [
  {
    id: 'P1',
    topic: 'Who may approve 75,000 and 600,000',
    prompt: "According to this project's approval rules, who may approve an invoice of 75,000, and what has to happen before an invoice of 600,000 is approved? Name the roles and the number of approvals.",
    facts: [
      ['75,000 needs a Director', /director/i, 'An invoice of 75,000 must be approved by a Director; a Manager is not enough.'],
      ['600,000 needs two approvals', /\b(two|2)\b[^.]{0,40}(approv|user|people|person)|second approv/i, 'An invoice of 600,000 needs two approvals from two different people.'],
      ['the second approver is a Director', /second[^.]{0,60}director|director[^.]{0,40}second/i, 'For 600,000 the second approval must come from a Director.'],
    ],
  },
  {
    id: 'P2',
    topic: 'Same person as both approvers',
    prompt: "According to this project's rules, can the same person give both approvals on an invoice that needs two approvals? How is 'the same person' decided?",
    facts: [
      ['no, never the same person', /\b(no|never|cannot|can't|must not|may not|not allowed)\b/i, 'The same person may never give both approvals on one invoice.'],
      ['identity is the username', /user ?name/i, 'The person is identified by the signed-in username.'],
      ['compared trimmed and case-insensitively', /case[- ]?insensitiv|ignor\w* case|trim/i, 'Usernames are compared ignoring case and surrounding whitespace.'],
    ],
  },
  {
    id: 'P3',
    topic: 'A refused approval attempt',
    prompt: "According to this project's rules, what must happen to an invoice when an approval attempt is refused, for example a Manager approving above their limit?",
    facts: [
      ['nothing about the invoice changes', /unchanged|nothing[^.]{0,30}chang|no field|not (be )?(modified|changed|updated)|stays? (as it was|the same|pending)|remains? (pending|unchanged)/i, 'A refused approval leaves the invoice completely unchanged.'],
      ['a clear reason is returned', /reason/i, 'A refused approval returns a clear reason.'],
      ['a refusal is not a rejection', /not (a |the same as (a )?)?reject|never sets? \W?rejected|does not reject|isn't (a )?reject/i, 'A refused approval is not a rejection: the invoice is not set to Rejected.'],
    ],
  },
  {
    id: 'P4',
    topic: 'Where the limit check belongs',
    prompt: 'Where should an approval-limit check be implemented (project and class), and what should the API return when an approval is refused?',
    facts: [
      ['in the Domain project', /domain/i, 'The check belongs in the Domain project.'],
      ['in ApprovalPolicy / ApprovalService', /ApprovalPolicy|ApprovalService/, 'The check belongs in ApprovalPolicy or ApprovalService.'],
      ['refusal is HTTP 403', /\b403\b/, 'A refused approval returns HTTP 403.'],
    ],
  },
  {
    id: 'P5',
    topic: 'Commands that prove a change is done',
    prompt: 'Which commands prove that a change in this repository is done? List them.',
    facts: [
      ['dotnet build', /dotnet build/i, 'dotnet build is one of the commands.'],
      ['dotnet test', /dotnet test/i, 'dotnet test is one of the commands.'],
      ['Playwright end-to-end tests', /playwright|npm test/i, 'Running the Playwright end-to-end tests is one of the commands.'],
      ['per-rule test filter', /--filter|Rule=FR/i, 'Tests for a single rule can be run with a filter such as --filter Rule=FR-004.'],
    ],
  },
  {
    id: 'P6',
    topic: 'Tests for the Manager limit',
    prompt: 'List (do not write) the unit tests you would add for the Manager approval limit.',
    facts: [
      ['at-limit case 50,000.00', /50,?000(\.00)?m?\b(?!\.0[1-9])/, 'A test that a Manager can approve exactly 50,000.00.'],
      ['over-limit case 50,000.01', /50,?000\.01/, 'A test that a Manager is refused at 50,000.01.'],
      ['refusal leaves the invoice unchanged / no Update', /unchanged|snapshot|Update/, 'A test that a refused attempt leaves the invoice unchanged or does not call Update.'],
      ['tagged by rule', /Trait|FR-001/, 'Tests are tagged by rule (a Trait or the rule id FR-001).'],
    ],
  },
  {
    id: 'P7',
    topic: 'Control: DiscountCalculator (not covered by AGENTS.md)',
    prompt: 'What does DiscountCalculator.CombinedDiscount return for 60 items, 3 years as a customer, and a Nonprofit customer?',
    facts: [['0.18 (18%)', /0\.18\b|\b18 ?%/, 'The final result is 0.18 (18%).']],
  },
];

export function regexScore(probe, answer) {
  return probe.facts.map(([fact, pattern]) => ({ fact, hit: pattern.test(answer ?? '') }));
}

export function judgePrompt(probe, answer) {
  const claims = probe.facts.map(([, , claim], index) => `${index + 1}. ${claim}`).join('\n');
  return [
    'You grade answers for a study. Be strict and literal, and do not use any tools.',
    `Question that was asked about a code repository:\n<question>\n${probe.prompt}\n</question>`,
    `Answer that was given:\n<answer>\n${answer}\n</answer>`,
    'For each numbered fact, decide whether the answer clearly states it as a rule, requirement, command or result of that repository, or, where the fact describes a test, proposes that test. ' +
      'A fact the answer says is absent, unknown or not a rule does not count. A wrong or contradicted value does not count.',
    claims,
    `Reply with only a JSON object and nothing else: {"facts": [true or false for each of the ${probe.facts.length} facts, in order]}`,
  ].join('\n\n');
}

export function parseJudgement(text, expected) {
  const match = /\{[\s\S]*\}/.exec(text ?? '');
  if (!match) return null;
  try {
    const facts = JSON.parse(match[0]).facts;
    return Array.isArray(facts) && facts.length === expected && facts.every((value) => typeof value === 'boolean') ? facts : null;
  } catch {
    return null;
  }
}

function claudeBinary() {
  if (process.env.CLAUDE_BIN) return process.env.CLAUDE_BIN;
  const npmBinary = join(process.env.APPDATA ?? '', 'npm', 'node_modules', '@anthropic-ai', 'claude-code', 'bin', 'claude.exe');
  return existsSync(npmBinary) ? npmBinary : 'claude';
}

function runClaude(cwd, args) {
  return new Promise((resolvePromise) => {
    const child = spawn(claudeBinary(), args, { cwd, env: { ...process.env, CLAUDE_CODE_DISABLE_AUTO_MEMORY: '1' }, stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => (stdout += chunk));
    child.stderr.on('data', (chunk) => (stderr += chunk));
    child.on('close', () => {
      try {
        resolvePromise(JSON.parse(stdout));
      } catch {
        resolvePromise({ is_error: true, result: '', stderr: stderr.slice(0, 2000), stdout: stdout.slice(0, 2000) });
      }
    });
  });
}

function askProbe(checkout, prompt, model) {
  return runClaude(checkout, [
    '-p', `${prompt}\n\n${ANSWER_RULE}`,
    '--output-format', 'json',
    '--model', model,
    '--tools', 'Read,Grep,Glob',
    // dontAsk denies every tool that is not pre-approved, so the read-only tools must be
    // allowed explicitly or the agent cannot open a single file.
    '--allowedTools', 'Read,Grep,Glob',
    '--permission-mode', 'dontAsk',
    '--setting-sources', 'project',
    '--strict-mcp-config',
    '--no-session-persistence',
    '--max-budget-usd', '0.25',
  ]);
}

async function askJudge(probe, answer, model, neutralDirectory) {
  for (let attempt = 1; attempt <= 2; attempt += 1) {
    const output = await runClaude(neutralDirectory, [
      '-p', judgePrompt(probe, answer),
      '--output-format', 'json',
      '--model', model,
      '--tools', '',
      '--permission-mode', 'dontAsk',
      '--setting-sources', 'project',
      '--strict-mcp-config',
      '--no-session-persistence',
      '--max-budget-usd', '0.05',
    ]);
    const facts = parseJudgement(output.result, probe.facts.length);
    if (facts) return { facts, cost: output.total_cost_usd ?? 0 };
  }
  return { facts: null, cost: 0 };
}

function logExchange(agentType, sessionId, prompt, answer) {
  const promptRecord = buildRecord({ hook_event_name: 'UserPromptSubmit', session_id: sessionId, agent_type: agentType, prompt }, { origin: 'probe' });
  const answerRecord = buildRecord({ hook_event_name: 'Stop', session_id: sessionId, agent_type: agentType, last_assistant_message: answer }, { origin: 'probe' });
  appendFileSync(logFilePath(), `${JSON.stringify(promptRecord)}\n${JSON.stringify(answerRecord)}\n`, 'utf8');
}

async function inPool(tasks, concurrency) {
  const results = new Array(tasks.length);
  let next = 0;
  const worker = async () => {
    while (next < tasks.length) {
      const index = next++;
      results[index] = await tasks[index]();
    }
  };
  await Promise.all(Array.from({ length: Math.min(concurrency, tasks.length) }, worker));
  return results;
}

function quote(text, limit = 220) {
  const flat = (text ?? '').replace(/\s+/g, ' ').trim();
  return flat.length > limit ? `${flat.slice(0, limit)}…` : flat;
}

function answerFile(out, arm, probeId, run) {
  return join(out, arm, `${probeId}-r${run}.json`);
}

async function collectAnswers(options) {
  const tasks = [];
  for (const arm of ['old', 'new']) {
    for (const probe of PROBES) {
      for (let run = 1; run <= options.runs; run += 1) {
        tasks.push(async () => {
          const output = await askProbe(resolve(options[arm]), probe.prompt, options.model);
          const file = answerFile(options.out, arm, probe.id, run);
          mkdirSync(dirname(file), { recursive: true });
          writeFileSync(file, `${JSON.stringify(sanitize(output, { cap: false }).value, null, 2)}\n`);
          logExchange(`probe-${arm}`, output.session_id ?? `probe-${arm}-${probe.id}-${run}`, `[${probe.id} run ${run}] ${probe.prompt}`, output.result ?? '');
          process.stdout.write(`asked ${arm} ${probe.id} run ${run}${output.is_error ? ' (error)' : ''}\n`);
        });
      }
    }
  }
  await inPool(tasks, options.concurrency);
}

async function scoreAnswers(options) {
  const neutralDirectory = mkdtempSync(join(tmpdir(), 'probe-judge-'));
  const tasks = [];
  for (const arm of ['old', 'new']) {
    for (const probe of PROBES) {
      for (let run = 1; run <= options.runs; run += 1) {
        tasks.push(async () => {
          const file = answerFile(options.out, arm, probe.id, run);
          if (!existsSync(file)) return null;
          const output = JSON.parse(readFileSync(file, 'utf8'));
          const answer = output.result ?? '';
          const regex = regexScore(probe, answer);
          const judged = await askJudge(probe, answer, options.model, neutralDirectory);
          logExchange('probe-judge', `probe-judge-${probe.id}-${run}-${arm === 'old' ? 'a' : 'b'}`, judgePrompt(probe, answer), JSON.stringify({ facts: judged.facts }));
          process.stdout.write(`judged ${arm} ${probe.id} run ${run}: ${judged.facts ? judged.facts.filter(Boolean).length : '?'}/${probe.facts.length}\n`);
          return {
            arm,
            probe: probe.id,
            run,
            asked: probe.facts.length,
            judge: judged.facts,
            judgeHits: judged.facts ? judged.facts.filter(Boolean).length : 0,
            regex,
            regexHits: regex.filter((fact) => fact.hit).length,
            answer,
            turns: output.num_turns ?? null,
            cost: (output.total_cost_usd ?? 0) + judged.cost,
            error: Boolean(output.is_error),
          };
        });
      }
    }
  }
  return (await inPool(tasks, options.concurrency)).filter(Boolean);
}

function summarise(rows, options) {
  const lines = ['# Context probe: does AGENTS.md change what a cold agent knows?', ''];
  lines.push(
    `Generated by \`scripts/context-probe.mjs\`. Model \`${options.model}\`, ${options.runs} runs per probe and arm. Both arms are the upstream code at the same commit (66cb3f9); NEW only replaces AGENTS.md with this branch's version (as of commit ac18345). Each run is a fresh headless \`claude -p\` session in the checkout, with read-only tools (Read, Grep, Glob) pre-approved, project settings only, no MCP servers and auto-memory off.`,
    '',
    'Scoring: a blind judge (a separate, tool-less `claude -p` call that sees the question, the answer and the facts, but not which arm produced the answer) decides for each fact whether the answer asserts it. The regex column is a cheap cross-check; it misreads some phrasings (for example "every field keeps its value"), so the judge is the headline score. Scores are facts asserted / facts asked, summed over runs.',
    '',
  );
  lines.push('| Probe | Topic | OLD judge | NEW judge | OLD regex | NEW regex |', '| --- | --- | --- | --- | --- | --- |');
  const totals = { oldJudge: 0, newJudge: 0, oldRegex: 0, newRegex: 0, possible: 0 };
  for (const probe of PROBES) {
    const cells = (arm) => {
      const armRows = rows.filter((row) => row.arm === arm && row.probe === probe.id);
      const asked = armRows.reduce((sum, row) => sum + row.asked, 0);
      const judge = armRows.reduce((sum, row) => sum + row.judgeHits, 0);
      const regex = armRows.reduce((sum, row) => sum + row.regexHits, 0);
      const unjudged = armRows.filter((row) => !row.judge).length;
      return { asked, judge, regex, judgeText: `${judge}/${asked}${unjudged ? ` (${unjudged} unjudged)` : ''}` };
    };
    const oldCells = cells('old');
    const newCells = cells('new');
    if (probe.id !== 'P7') {
      totals.oldJudge += oldCells.judge;
      totals.newJudge += newCells.judge;
      totals.oldRegex += oldCells.regex;
      totals.newRegex += newCells.regex;
      totals.possible += newCells.asked;
    }
    lines.push(`| ${probe.id} | ${probe.topic} | ${oldCells.judgeText} | ${newCells.judgeText} | ${oldCells.regex}/${oldCells.asked} | ${newCells.regex}/${newCells.asked} |`);
  }
  lines.push(
    '',
    `**Approval probes P1–P6: OLD ${totals.oldJudge}/${totals.possible}, NEW ${totals.newJudge}/${totals.possible} (judge); OLD ${totals.oldRegex}/${totals.possible}, NEW ${totals.newRegex}/${totals.possible} (regex).** P7 is a control about code that AGENTS.md does not mention, so any difference there is noise (for example an arithmetic slip), not context.`,
    '',
    "History: a first attempt ran with `--permission-mode dontAsk` but without `--allowedTools`, so every Read, Grep and Glob was denied and both arms answered without seeing the code. A second attempt asked P1–P3 without saying \"according to this project's rules\"; with code access, the NEW agent correctly answered that today's code does not enforce the rules yet, which measured the code, not the context. Both attempts were discarded, the questions were made explicit for both arms alike, and everything was asked again. All exchanges remain in `ai-logs/` with origin `probe`.",
    '',
  );
  lines.push('## Sample answers (run 1)', '');
  for (const probe of PROBES) {
    lines.push(`### ${probe.id}: ${probe.prompt}`, '');
    for (const arm of ['old', 'new']) {
      const row = rows.find((candidate) => candidate.arm === arm && candidate.probe === probe.id && candidate.run === 1);
      const missed = row?.judge ? probe.facts.filter((_, index) => !row.judge[index]).map(([label]) => label) : [];
      lines.push(`- **${arm.toUpperCase()}** (judge ${row ? `${row.judgeHits}/${row.asked}` : 'no run'}${missed.length ? `; not asserted: ${missed.join(', ')}` : ''}): ${quote(row?.answer)}`);
    }
    lines.push('');
  }
  return `${lines.join('\n')}\n`;
}

function writeReports(rows, options) {
  const csv = ['arm,probe,run,asked,judge_hits,regex_hits,turns,cost_usd,error,judge_missed'];
  for (const row of rows) {
    const missed = row.judge ? PROBES.find((probe) => probe.id === row.probe).facts.filter((_, index) => !row.judge[index]).map(([label]) => label).join('; ') : 'unjudged';
    csv.push([row.arm, row.probe, row.run, row.asked, row.judgeHits, row.regexHits, row.turns ?? '', row.cost.toFixed(4), row.error, `"${missed}"`].join(','));
  }
  writeFileSync(join(options.out, 'scores.csv'), `${csv.join('\n')}\n`);
  writeFileSync(join(options.out, 'README.md'), summarise(rows, options));
}

async function main() {
  const options = { runs: 2, model: 'haiku', out: join(repositoryRoot, 'docs', 'evidence', 'context-probe'), concurrency: 4, rescore: false };
  const args = process.argv.slice(2);
  for (let index = 0; index < args.length; index += 1) {
    const key = args[index].replace(/^--/, '');
    if (key === 'rescore') {
      options.rescore = true;
      continue;
    }
    options[key] = ['runs', 'concurrency'].includes(key) ? Number(args[index + 1]) : args[index + 1];
    index += 1;
  }
  options.out = resolve(options.out);
  if (!options.rescore) {
    if (!options.old || !options.new) throw new Error('Pass --old <checkout> and --new <checkout>, or --rescore.');
    await collectAnswers(options);
  }
  const rows = await scoreAnswers(options);
  writeReports(rows, options);
  const totalCost = rows.reduce((sum, row) => sum + row.cost, 0);
  process.stdout.write(`Done: ${rows.length} answers scored, $${totalCost.toFixed(2)}. Summary in ${join(options.out, 'README.md')}\n`);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  main().catch((error) => {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  });
}
