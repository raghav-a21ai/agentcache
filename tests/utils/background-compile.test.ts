import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { existsSync, writeFileSync, readFileSync, rmSync, mkdirSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { mkdtempSync } from "fs";

let tmpDir: string;

vi.mock("../../src/utils/paths.js", () => ({
  getDataDir: () => tmpDir,
}));

describe("Background Compile Lockfile", () => {
  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "agentcache-test-lock-"));
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
    vi.resetModules();
  });

  it("acquireLock creates lockfile with pid and timestamp", async () => {
    const { acquireLock } = await import("../../src/utils/background-compile.js");
    const result = acquireLock();
    expect(result).toBe(true);

    const lockPath = join(tmpDir, "compile-all.lock");
    expect(existsSync(lockPath)).toBe(true);

    const content = JSON.parse(readFileSync(lockPath, "utf-8"));
    expect(content.pid).toBe(process.pid);
    expect(content.startedAt).toBeGreaterThan(0);
  });

  it("acquireLock returns false when lock held by current process", async () => {
    const { acquireLock } = await import("../../src/utils/background-compile.js");
    expect(acquireLock()).toBe(true);
    expect(acquireLock()).toBe(false);
  });

  it("releaseLock removes the lockfile", async () => {
    const { acquireLock, releaseLock } = await import("../../src/utils/background-compile.js");
    acquireLock();
    releaseLock();

    const lockPath = join(tmpDir, "compile-all.lock");
    expect(existsSync(lockPath)).toBe(false);
  });

  it("acquireLock succeeds when lock held by dead process", async () => {
    const lockPath = join(tmpDir, "compile-all.lock");
    writeFileSync(lockPath, JSON.stringify({ pid: 999999999, startedAt: Date.now() }));

    const { acquireLock } = await import("../../src/utils/background-compile.js");
    const result = acquireLock();
    expect(result).toBe(true);
  });

  it("acquireLock succeeds when lock is stale (> 4 hours)", async () => {
    const lockPath = join(tmpDir, "compile-all.lock");
    const fiveHoursAgo = Date.now() - 5 * 60 * 60 * 1000;
    writeFileSync(lockPath, JSON.stringify({ pid: process.pid, startedAt: fiveHoursAgo }));

    const { acquireLock } = await import("../../src/utils/background-compile.js");
    const result = acquireLock();
    expect(result).toBe(true);
  });

  it("acquireLock cleans up malformed lockfile", async () => {
    const lockPath = join(tmpDir, "compile-all.lock");
    writeFileSync(lockPath, "not json");

    const { acquireLock } = await import("../../src/utils/background-compile.js");
    const result = acquireLock();
    expect(result).toBe(true);
  });
});
