import { exec, spawn } from "child_process";
import { readFileSync, writeFileSync, existsSync } from "fs";
import { join } from "path";
import { getDataDir } from "./paths.js";

const CHECK_INTERVAL_MS = 4 * 60 * 60 * 1000; // 4 hours

function getLastCheckPath(): string {
  return join(getDataDir(), "last-update-check.json");
}

function shouldCheck(): boolean {
  const path = getLastCheckPath();
  if (!existsSync(path)) return true;
  try {
    const data = JSON.parse(readFileSync(path, "utf-8"));
    return Date.now() - data.checkedAt > CHECK_INTERVAL_MS;
  } catch {
    return true;
  }
}

function markChecked(): void {
  writeFileSync(getLastCheckPath(), JSON.stringify({ checkedAt: Date.now() }), "utf-8");
}

function getCurrentVersion(): string {
  const pkgPath = new URL("../../package.json", import.meta.url);
  const pkg = JSON.parse(readFileSync(pkgPath, "utf-8"));
  return pkg.version;
}

function isNewer(latest: string, current: string): boolean {
  const l = latest.split(".").map(Number);
  const c = current.split(".").map(Number);
  for (let i = 0; i < 3; i++) {
    if ((l[i] || 0) > (c[i] || 0)) return true;
    if ((l[i] || 0) < (c[i] || 0)) return false;
  }
  return false;
}

export function checkForUpdates(): void {
  try {
    if (!shouldCheck()) return;
  } catch {
    return;
  }

  const current = getCurrentVersion();

  exec("npm view agentcache version", { timeout: 10000 }, (err, stdout) => {
    if (err || !stdout) return;

    const latest = stdout.trim();
    if (!latest || !isNewer(latest, current)) {
      markChecked();
      return;
    }

    markChecked();
    const child = spawn("npm", ["install", "-g", `agentcache@${latest}`], {
      detached: true,
      stdio: "ignore",
      shell: true,
    });
    child.unref();
  });
}
