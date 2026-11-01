// SessionStart hook: lets the Bash tool find a user-local .NET SDK. Claude Code runs the
// contents of CLAUDE_ENV_FILE before every Bash command, so appending a line that sources
// scripts/dev-env.sh puts ~/.dotnet ahead of a machine-wide dotnet that has no SDK.
// dev-env.sh does nothing on machines without ~/.dotnet. Always exits 0.
import { appendFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

try {
  const environmentFile = process.env.CLAUDE_ENV_FILE;
  const projectDirectory = process.env.CLAUDE_PROJECT_DIR || process.cwd();
  const devEnvScript = join(projectDirectory, 'scripts', 'dev-env.sh');
  if (environmentFile && existsSync(devEnvScript)) {
    const shellPath = devEnvScript.replace(/\\/g, '/');
    appendFileSync(environmentFile, `\n# .claude/hooks/session-env.mjs: user-local .NET SDK first on PATH\n. "${shellPath}"\n`);
  }
} catch {
  // never break session start
}
process.exitCode = 0;
