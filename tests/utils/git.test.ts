import { describe, it, expect } from "vitest";
import { mkdtempSync, rmSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { getGitContext, getGitRoot } from "../../src/utils/git.js";

describe("git utilities", () => {
  describe("getGitContext in non-git directory", () => {
    let tmpDir: string;

    beforeEach(() => {
      tmpDir = mkdtempSync(join(tmpdir(), "agentcache-test-git-"));
    });

    afterEach(() => {
      rmSync(tmpDir, { recursive: true, force: true });
    });

    it("returns empty context without throwing", () => {
      const ctx = getGitContext(tmpDir);
      expect(ctx.branch).toBe("");
      expect(ctx.commit).toBe("");
      expect(ctx.recentCommits).toEqual([]);
      expect(ctx.modifiedFiles).toEqual([]);
    });

    it("does not print to stderr", () => {
      const stderrSpy = vi.spyOn(process.stderr, "write");
      getGitContext(tmpDir);
      expect(stderrSpy).not.toHaveBeenCalled();
      stderrSpy.mockRestore();
    });
  });

  describe("getGitContext in git directory", () => {
    it("returns non-empty branch and commit for this repo", () => {
      // Use the test repo's own root
      const repoRoot = join(__dirname, "../..");
      const ctx = getGitContext(repoRoot);
      expect(ctx.branch).not.toBe("");
      expect(ctx.commit).not.toBe("");
      expect(ctx.recentCommits.length).toBeGreaterThan(0);
    });
  });

  describe("getGitRoot", () => {
    it("returns null for non-git directory", () => {
      const tmpDir = mkdtempSync(join(tmpdir(), "agentcache-test-noroot-"));
      expect(getGitRoot(tmpDir)).toBeNull();
      rmSync(tmpDir, { recursive: true, force: true });
    });

    it("returns path for git directory", () => {
      const repoRoot = join(__dirname, "../..");
      const root = getGitRoot(repoRoot);
      expect(root).not.toBeNull();
      expect(root).toContain("loop");
    });
  });
});
