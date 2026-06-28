import { spawn } from "child_process";
import { existsSync, writeFileSync, readFileSync, unlinkSync } from "fs";
import { join } from "path";
import { getDataDir } from "./paths.js";

const LOCK_FILE = "compile-all.lock";
const STALE_THRESHOLD_MS = 4 * 60 * 60 * 1000; // 4 hours

function getLockPath(): string {
  return join(getDataDir(), LOCK_FILE);
}

function isLocked(): boolean {
  const lockPath = getLockPath();
  if (!existsSync(lockPath)) return false;

  try {
    const content = readFileSync(lockPath, "utf-8");
    const { pid, startedAt } = JSON.parse(content);

    // Stale lock (process died without cleanup)
    if (Date.now() - startedAt > STALE_THRESHOLD_MS) {
      unlinkSync(lockPath);
      return false;
    }

    // Check if process is still alive
    try {
      process.kill(pid, 0);
      return true;
    } catch {
      unlinkSync(lockPath);
      return false;
    }
  } catch {
    unlinkSync(lockPath);
    return false;
  }
}

export function spawnCompileAll(): boolean {
  if (isLocked()) return false;

  const agentcacheBin = process.argv[1]?.replace(/\/dist\/.*/, "/dist/cli.js") || "agentcache";
  const isLinkedBinary = agentcacheBin.includes("dist/cli.js");

  const cmd = isLinkedBinary ? process.execPath : "agentcache";
  const args = isLinkedBinary ? [agentcacheBin, "compile-all"] : ["compile-all"];

  const child = spawn(cmd, args, {
    detached: true,
    stdio: "ignore",
    env: { ...process.env, AGENTCACHE_BACKGROUND: "1" },
  });

  child.unref();

  // Write lock
  try {
    writeFileSync(getLockPath(), JSON.stringify({ pid: child.pid, startedAt: Date.now() }));
  } catch {}

  return true;
}

export function acquireLock(): boolean {
  if (isLocked()) return false;
  try {
    writeFileSync(getLockPath(), JSON.stringify({ pid: process.pid, startedAt: Date.now() }));
    return true;
  } catch {
    return false;
  }
}

export function releaseLock(): void {
  try {
    unlinkSync(getLockPath());
  } catch {}
}
