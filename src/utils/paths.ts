import { existsSync, renameSync, mkdirSync } from "fs";
import { join, dirname } from "path";
import { homedir } from "os";
import { createHash } from "crypto";
import { getGitRoot } from "./git.js";

export function getDataDir(): string {
  return join(homedir(), ".agentcache");
}

export function getDbPath(): string {
  return join(getDataDir(), "agentcache.db");
}

export function isInitialized(): boolean {
  return existsSync(getDbPath());
}

export function migrateFromLegacy(): void {
  const legacyDb = join(homedir(), ".loop", "loop.db");
  const newDb = getDbPath();
  if (existsSync(legacyDb) && !existsSync(newDb)) {
    mkdirSync(dirname(newDb), { recursive: true });
    renameSync(legacyDb, newDb);
  }
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
