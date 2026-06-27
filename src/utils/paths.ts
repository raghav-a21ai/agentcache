import { existsSync } from "fs";
import { join } from "path";
import { getGitRoot } from "./git.js";

export function findProjectRoot(cwd?: string): string {
  const dir = cwd || process.cwd();
  const gitRoot = getGitRoot(dir);
  return gitRoot || dir;
}

export function getLoopDir(projectRoot: string): string {
  return join(projectRoot, ".loop");
}

export function getDbPath(projectRoot: string): string {
  return join(getLoopDir(projectRoot), "loop.db");
}

export function getInjectedContextPath(projectRoot: string): string {
  return join(getLoopDir(projectRoot), "injected-context.md");
}

export function getGeneratedDir(projectRoot: string): string {
  return join(getLoopDir(projectRoot), "generated");
}

export function getConfigPath(projectRoot: string): string {
  return join(getLoopDir(projectRoot), "config.json");
}

export function getPendingQueuePath(projectRoot: string): string {
  return join(getLoopDir(projectRoot), "pending.jsonl");
}

export function isLoopInitialized(projectRoot: string): boolean {
  return existsSync(getDbPath(projectRoot));
}
