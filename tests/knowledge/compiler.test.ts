import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { SqliteKnowledgeRepository } from "../../src/storage/sqlite.js";
import { mkdirSync, rmSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { mkdtempSync } from "fs";
import { startCompile, processExtraction, processClustering } from "../../src/knowledge/compiler.js";

vi.mock("../../src/utils/git.js", () => ({
  getGitContext: vi.fn(() => ({
    branch: "main",
    commit: "abc1234",
    recentCommits: ["abc1234 test commit"],
    modifiedFiles: ["src/test.ts"],
  })),
  getGitRoot: vi.fn(() => null),
}));

describe("Compiler Steps", () => {
  let repo: SqliteKnowledgeRepository;
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "loop-compiler-"));
    repo = new SqliteKnowledgeRepository(join(tmpDir, "loop.db"));
    mkdirSync(join(tmpDir, ".loop", "generated"), { recursive: true });
  });

  afterEach(() => {
    repo.close();
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("startCompile returns extraction prompt", () => {
    const events = [
      { type: "message", role: "user", content: "Always use path aliases" },
      { type: "message", role: "assistant", content: "Got it." },
    ];

    const state = startCompile(events, "sess_test", "test-project", tmpDir, repo);
    expect(state.sessionId).toBe("sess_test");
    expect(state.prompt).toContain("transcript");
    expect(state.prompt).toContain("path aliases");

    // Session should be saved
    const session = repo.getSession("sess_test");
    expect(session).not.toBeNull();
  });

  it("processExtraction with no clustering needed finalizes", () => {
    const events = [{ type: "message", role: "user", content: "test" }];
    startCompile(events, "sess_test", "test-project", tmpDir, repo);

    // Simulate agent response (extraction result)
    const agentResponse = JSON.stringify({
      observations: [
        { type: "rule", content: "Always use path aliases", sourceQuote: "use path aliases", confidence: "high" },
      ],
    });

    const result = processExtraction(repo, agentResponse, "sess_test", "test-project", tmpDir);

    // First time — no existing items to match, so needs clustering
    expect(result.status).toBe("needs_clustering");
    if (result.status === "needs_clustering") {
      expect(result.clusteringPrompt).toContain("CREATE");
    }
  });

  it("processExtraction auto-reinforces matching items", () => {
    const events = [{ type: "message", role: "user", content: "test" }];
    startCompile(events, "sess_test", "test-project", tmpDir, repo);

    // Pre-populate a knowledge item
    repo.saveKnowledgeItem({
      id: "ki_existing",
      canonicalHash: "abc",
      type: "rule",
      title: "Use path aliases",
      content: "Always use path aliases",
      confidence: "medium",
      observationCount: 3,
      authority: "AUTO",
      status: "active",
      enforce: false,
      project: "test-project",
      scope: "global",
      createdAt: 1000,
      updatedAt: 1000,
      lastSeenAt: 1000,
      metadata: {},
    });

    const agentResponse = JSON.stringify({
      observations: [
        { type: "rule", content: "Always use path aliases", sourceQuote: "quote", confidence: "high" },
      ],
    });

    const result = processExtraction(repo, agentResponse, "sess_test", "test-project", tmpDir);

    // Should auto-reinforce — the canonical keys match
    const item = repo.getKnowledgeItem("ki_existing");
    expect(item!.observationCount).toBe(4);
  });

  it("processClustering finalizes compilation", () => {
    const events = [{ type: "message", role: "user", content: "test" }];
    startCompile(events, "sess_test2", "test-project", tmpDir, repo);

    // Save an observation for this session
    repo.saveObservation({
      id: "obs_1",
      sessionId: "sess_test2",
      timestamp: Date.now(),
      type: "rule",
      content: "Never use var",
      sourceQuote: "quote",
      confidence: "high",
      project: "test-project",
      scope: "global",
    });

    const clusterResponse = JSON.stringify({
      clusters: [{ observationId: "obs_1", action: "CREATE", reasoning: "new rule" }],
    });

    const result = processClustering(repo, clusterResponse, "sess_test2", "test-project", tmpDir);
    expect(result.status).toBe("complete");
    expect(result.diagnostics).toContain("new knowledge items");

    // Verify knowledge item was created
    const items = repo.getKnowledgeItems("test-project");
    expect(items.length).toBeGreaterThan(0);

    // Verify compile run saved
    const runs = repo.getCompileRuns("test-project");
    expect(runs).toHaveLength(1);
  });
});
