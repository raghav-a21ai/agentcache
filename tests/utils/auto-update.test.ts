import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { existsSync, writeFileSync, readFileSync, rmSync, mkdirSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { mkdtempSync } from "fs";

let tmpDir: string;

vi.mock("../../src/utils/paths.js", () => ({
  getDataDir: () => tmpDir,
}));

vi.mock("child_process", () => ({
  exec: vi.fn(),
  spawn: vi.fn(() => ({ unref: vi.fn() })),
}));

describe("Auto-Update", () => {
  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "agentcache-test-update-"));
    vi.resetModules();
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
    vi.restoreAllMocks();
  });

  describe("shouldCheck throttling", () => {
    it("returns true when no last-check file exists", async () => {
      const { checkForUpdates } = await import("../../src/utils/auto-update.js");
      const { exec } = await import("child_process");

      checkForUpdates();

      // exec should be called since shouldCheck returns true
      expect(exec).toHaveBeenCalled();
    });

    it("returns false when last check was recent", async () => {
      // Write a recent timestamp
      writeFileSync(
        join(tmpDir, "last-update-check.json"),
        JSON.stringify({ checkedAt: Date.now() }),
        "utf-8"
      );

      const { checkForUpdates } = await import("../../src/utils/auto-update.js");
      const { exec } = await import("child_process");

      checkForUpdates();

      // exec should NOT be called since shouldCheck returns false
      expect(exec).not.toHaveBeenCalled();
    });

    it("returns true when last check is older than 4 hours", async () => {
      const fiveHoursAgo = Date.now() - 5 * 60 * 60 * 1000;
      writeFileSync(
        join(tmpDir, "last-update-check.json"),
        JSON.stringify({ checkedAt: fiveHoursAgo }),
        "utf-8"
      );

      const { checkForUpdates } = await import("../../src/utils/auto-update.js");
      const { exec } = await import("child_process");

      checkForUpdates();

      expect(exec).toHaveBeenCalled();
    });

    it("returns true when last-check file is corrupted", async () => {
      writeFileSync(join(tmpDir, "last-update-check.json"), "not json", "utf-8");

      const { checkForUpdates } = await import("../../src/utils/auto-update.js");
      const { exec } = await import("child_process");

      checkForUpdates();

      expect(exec).toHaveBeenCalled();
    });
  });

  describe("markChecked only after successful check", () => {
    it("does not write timestamp before npm callback fires", async () => {
      const { checkForUpdates } = await import("../../src/utils/auto-update.js");

      checkForUpdates();

      // Before the exec callback fires, no timestamp should be written
      const checkPath = join(tmpDir, "last-update-check.json");
      expect(existsSync(checkPath)).toBe(false);
    });

    it("writes timestamp when npm returns a version", async () => {
      const { exec } = await import("child_process");
      const mockExec = vi.mocked(exec);

      // Make exec call back with a version lower than current (no update needed)
      mockExec.mockImplementation((_cmd: any, _opts: any, cb: any) => {
        cb(null, "0.0.1\n", "");
        return {} as any;
      });

      const { checkForUpdates } = await import("../../src/utils/auto-update.js");
      checkForUpdates();

      const checkPath = join(tmpDir, "last-update-check.json");
      expect(existsSync(checkPath)).toBe(true);
    });

    it("does not write timestamp when npm errors", async () => {
      const { exec } = await import("child_process");
      const mockExec = vi.mocked(exec);

      mockExec.mockImplementation((_cmd: any, _opts: any, cb: any) => {
        cb(new Error("network error"), "", "");
        return {} as any;
      });

      const { checkForUpdates } = await import("../../src/utils/auto-update.js");
      checkForUpdates();

      const checkPath = join(tmpDir, "last-update-check.json");
      expect(existsSync(checkPath)).toBe(false);
    });
  });

  describe("version comparison", () => {
    it("spawns install when registry version is newer", async () => {
      const { exec, spawn } = await import("child_process");
      const mockExec = vi.mocked(exec);
      const mockSpawn = vi.mocked(spawn);

      // Return a very high version
      mockExec.mockImplementation((_cmd: any, _opts: any, cb: any) => {
        cb(null, "99.0.0\n", "");
        return {} as any;
      });

      const { checkForUpdates } = await import("../../src/utils/auto-update.js");
      checkForUpdates();

      expect(mockSpawn).toHaveBeenCalledWith(
        "npm",
        ["install", "-g", "agentcache@99.0.0"],
        expect.objectContaining({ detached: true, shell: true, stdio: "ignore" })
      );
    });

    it("does not spawn install when current version matches registry", async () => {
      const { exec, spawn } = await import("child_process");
      const mockExec = vi.mocked(exec);
      const mockSpawn = vi.mocked(spawn);

      // Return exact current version (from package.json)
      const pkg = JSON.parse(readFileSync(join(__dirname, "../../package.json"), "utf-8"));
      mockExec.mockImplementation((_cmd: any, _opts: any, cb: any) => {
        cb(null, `${pkg.version}\n`, "");
        return {} as any;
      });

      const { checkForUpdates } = await import("../../src/utils/auto-update.js");
      checkForUpdates();

      expect(mockSpawn).not.toHaveBeenCalled();
    });

    it("does not spawn install when registry version is older", async () => {
      const { exec, spawn } = await import("child_process");
      const mockExec = vi.mocked(exec);
      const mockSpawn = vi.mocked(spawn);

      mockExec.mockImplementation((_cmd: any, _opts: any, cb: any) => {
        cb(null, "0.0.1\n", "");
        return {} as any;
      });

      const { checkForUpdates } = await import("../../src/utils/auto-update.js");
      checkForUpdates();

      expect(mockSpawn).not.toHaveBeenCalled();
    });
  });

  describe("spawn options for cross-platform compatibility", () => {
    it("uses shell:true for Windows .cmd compatibility", async () => {
      const { exec, spawn } = await import("child_process");
      const mockExec = vi.mocked(exec);
      const mockSpawn = vi.mocked(spawn);

      mockExec.mockImplementation((_cmd: any, _opts: any, cb: any) => {
        cb(null, "99.0.0\n", "");
        return {} as any;
      });

      const { checkForUpdates } = await import("../../src/utils/auto-update.js");
      checkForUpdates();

      expect(mockSpawn).toHaveBeenCalledWith(
        "npm",
        expect.any(Array),
        expect.objectContaining({ shell: true })
      );
    });

    it("uses detached:true so update survives parent exit", async () => {
      const { exec, spawn } = await import("child_process");
      const mockExec = vi.mocked(exec);
      const mockSpawn = vi.mocked(spawn);

      mockExec.mockImplementation((_cmd: any, _opts: any, cb: any) => {
        cb(null, "99.0.0\n", "");
        return {} as any;
      });

      const { checkForUpdates } = await import("../../src/utils/auto-update.js");
      checkForUpdates();

      expect(mockSpawn).toHaveBeenCalledWith(
        "npm",
        expect.any(Array),
        expect.objectContaining({ detached: true })
      );
    });

    it("pins exact version from registry, not @latest", async () => {
      const { exec, spawn } = await import("child_process");
      const mockExec = vi.mocked(exec);
      const mockSpawn = vi.mocked(spawn);

      mockExec.mockImplementation((_cmd: any, _opts: any, cb: any) => {
        cb(null, "5.2.1\n", "");
        return {} as any;
      });

      const { checkForUpdates } = await import("../../src/utils/auto-update.js");
      checkForUpdates();

      expect(mockSpawn).toHaveBeenCalledWith(
        "npm",
        ["install", "-g", "agentcache@5.2.1"],
        expect.any(Object)
      );
    });
  });

  describe("error boundary", () => {
    it("does not throw when getDataDir path is unwritable", async () => {
      // Make tmpDir read-only (Unix only)
      if (process.platform !== "win32") {
        const { chmodSync } = await import("fs");
        chmodSync(tmpDir, 0o444);

        const { checkForUpdates } = await import("../../src/utils/auto-update.js");

        // Should not throw
        expect(() => checkForUpdates()).not.toThrow();

        chmodSync(tmpDir, 0o755);
      }
    });
  });
});
