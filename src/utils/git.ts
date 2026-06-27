import { execSync } from "child_process";

export interface GitContext {
  branch: string;
  commit: string;
  recentCommits: string[];
  modifiedFiles: string[];
}

function run(cmd: string, cwd: string): string {
  try {
    return execSync(cmd, { cwd, encoding: "utf-8", timeout: 5000 }).trim();
  } catch {
    return "";
  }
}

export function getGitContext(projectRoot: string): GitContext {
  const branch = run("git rev-parse --abbrev-ref HEAD", projectRoot);
  const commit = run("git rev-parse --short HEAD", projectRoot);
  const recentCommits = run("git log --oneline -10", projectRoot)
    .split("\n")
    .filter(Boolean);
  const modifiedFiles = run("git diff --name-only HEAD~5 HEAD", projectRoot)
    .split("\n")
    .filter(Boolean);

  return { branch, commit, recentCommits, modifiedFiles };
}

export function getGitRoot(cwd: string): string | null {
  const root = run("git rev-parse --show-toplevel", cwd);
  return root || null;
}
