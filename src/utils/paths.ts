import { existsSync } from "fs";
import { join } from "path";
import { homedir } from "os";
import { createHash } from "crypto";
import { getGitRoot } from "./git.js";

export function getGlobalLoopDir(): string {
  return join(homedir(), ".loop");
}

export function getDbPath(): string {
  return join(getGlobalLoopDir(), "loop.db");
}

export function isLoopInitialized(): boolean {
  return existsSync(getDbPath());
}

export function findProjectRoot(cwd?: string): string {
  const dir = cwd || process.cwd();
  const gitRoot = getGitRoot(dir);
  return gitRoot || dir;
}

export function getProjectId(projectRoot: string): string {
  const name = projectRoot.split("/").pop() || "unknown";
  const hash = createHash("sha256").update(projectRoot).digest("hex").slice(0, 6);
  return `${name}-${hash}`;
}

export function getProjectDisplayName(projectRoot: string): string {
  return projectRoot.split("/").pop() || "unknown";
}

export function getClaudeTranscriptsDir(): string {
  return join(homedir(), ".claude", "projects");
}

export function getContinueSessionsDir(): string {
  return join(homedir(), ".continue", "sessions");
}
