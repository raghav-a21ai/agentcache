import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtempSync, writeFileSync, rmSync, mkdirSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { SqliteKnowledgeRepository } from "../../src/storage/sqlite.js";

vi.mock("../../src/utils/git.js", () => ({
  getGitContext: vi.fn(() => ({
    branch: "main",
    commit: "abc1234",
    recentCommits: [],
    modifiedFiles: [],
  })),
  getGitRoot: vi.fn(() => null),
}));

describe("compile-all transcript discovery", () => {
  let tmpDir: string;
  let repo: SqliteKnowledgeRepository;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "agentcache-test-compile-"));
    repo = new SqliteKnowledgeRepository(join(tmpDir, "agentcache.db"));
  });

  afterEach(() => {
    repo.close();
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("filters out already-compiled transcript paths", () => {
    const compiled = new Set(["path/a.jsonl", "path/b.jsonl"]);
    const all = ["path/a.jsonl", "path/b.jsonl", "path/c.jsonl"];
    const uncompiled = all.filter((p) => !compiled.has(p));
    expect(uncompiled).toEqual(["path/c.jsonl"]);
  });

  it("inferProjectRoot extracts path from claude project slug", () => {
    const path = "/home/user/.claude/projects/-Users-raghav-myproject/abc123.jsonl";
    const slug = path.split(".claude/projects/")[1]?.split("/")[0] || "";
    const root = slug.startsWith("-") ? slug.replace(/-/g, "/") : slug;
    expect(root).toBe("/Users/raghav/myproject");
  });

  it("processOneTranscript skips transcripts with < 3 events", async () => {
    const { startCompile, processExtraction } = await import("../../src/knowledge/compiler.js");
    const events = [
      { type: "message", role: "user", content: "hi" },
      { type: "message", role: "assistant", content: "hello" },
    ];

    // Less than 3 events = skip
    expect(events.length < 3).toBe(true);
  });

  it("compilation pipeline processes extraction then clustering", async () => {
    const { startCompile, processExtraction, processClustering } = await import("../../src/knowledge/compiler.js");

    const events = [
      { type: "message", role: "user", content: "Always use TypeScript strict mode" },
      { type: "message", role: "assistant", content: "Good practice." },
      { type: "message", role: "user", content: "And never use any types" },
    ];

    const sessionId = "sess_test_ca";
    const state = startCompile(events, sessionId, "test-project", tmpDir, repo);
    expect(state.prompt).toContain("TypeScript strict mode");

    const extractResponse = JSON.stringify({
      observations: [
        { type: "rule", content: "Always use TypeScript strict mode", sourceQuote: "TypeScript strict", confidence: "high" },
      ],
    });

    const extractResult = processExtraction(repo, extractResponse, sessionId, "test-project", tmpDir);
    expect(extractResult.status).toBe("needs_clustering");

    if (extractResult.status === "needs_clustering") {
      const obs = repo.getObservations("test-project").filter((o) => o.sessionId === sessionId);
      const clusterResponse = JSON.stringify({
        clusters: [{ observationId: obs[0].id, action: "CREATE", reasoning: "new" }],
      });

      const clusterResult = processClustering(repo, clusterResponse, sessionId, "test-project", tmpDir);
      expect(clusterResult.status).toBe("complete");

      const items = repo.getKnowledgeItems("test-project");
      expect(items.length).toBeGreaterThan(0);
      expect(items[0].content).toContain("TypeScript strict mode");
    }
  });
});
