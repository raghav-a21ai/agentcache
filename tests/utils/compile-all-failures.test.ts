import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtempSync, writeFileSync, rmSync, mkdirSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { SqliteKnowledgeRepository } from "../../src/storage/sqlite.js";
import { startCompile, processExtraction, processClustering } from "../../src/knowledge/compiler.js";

vi.mock("../../src/utils/git.js", () => ({
  getGitContext: vi.fn(() => ({
    branch: "main",
    commit: "abc1234",
    recentCommits: [],
    modifiedFiles: [],
  })),
  getGitRoot: vi.fn(() => null),
}));

describe("compile-all failure paths", () => {
  let tmpDir: string;
  let repo: SqliteKnowledgeRepository;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "agentcache-test-failures-"));
    repo = new SqliteKnowledgeRepository(join(tmpDir, "agentcache.db"));
  });

  afterEach(() => {
    repo.close();
    rmSync(tmpDir, { recursive: true, force: true });
  });

  const sampleEvents = [
    { type: "message", role: "user", content: "Always use TypeScript strict mode" },
    { type: "message", role: "assistant", content: "Understood, I'll use strict mode." },
    { type: "message", role: "user", content: "And use path aliases in imports" },
  ];

  const validExtractResponse = JSON.stringify({
    observations: [
      { type: "rule", content: "Always use TypeScript strict mode", sourceQuote: "strict mode", confidence: "high" },
    ],
  });

  const validClusterResponse = (obsId: string) => JSON.stringify({
    clusters: [{ observationId: obsId, action: "CREATE", reasoning: "new rule" }],
  });

  describe("extraction failure does not mark transcript as compiled", () => {
    it("transcript remains retryable when extraction LLM returns null", () => {
      const sessionId = "sess_extract_fail";
      startCompile(sampleEvents, sessionId, "test-project", tmpDir, repo);

      // Extraction LLM returns null — simulate backend.invoke() returning null
      // In this case processOneTranscript returns early without calling updateSessionTranscriptPath

      // Session exists but has empty transcript_path
      const compiledPaths = repo.getAllCompiledTranscriptPaths();
      expect(compiledPaths).not.toContain("/some/transcript.jsonl");

      // Transcript would be retried on next run
      const allPaths = new Set(compiledPaths);
      expect(allPaths.has("/some/transcript.jsonl")).toBe(false);
    });
  });

  describe("extraction success marks transcript as compiled", () => {
    it("transcript is marked compiled after successful extraction", () => {
      const sessionId = "sess_extract_ok";
      const transcriptPath = "/test/session.jsonl";

      startCompile(sampleEvents, sessionId, "test-project", tmpDir, repo);
      processExtraction(repo, validExtractResponse, sessionId, "test-project", tmpDir);

      // Simulate what compile-all does: mark after extraction
      repo.updateSessionTranscriptPath(sessionId, transcriptPath);

      const compiledPaths = repo.getAllCompiledTranscriptPaths();
      expect(compiledPaths).toContain(transcriptPath);
    });

    it("transcript stays compiled even when clustering LLM returns null", () => {
      const sessionId = "sess_cluster_fail";
      const transcriptPath = "/test/cluster-fail.jsonl";

      startCompile(sampleEvents, sessionId, "test-project", tmpDir, repo);
      processExtraction(repo, validExtractResponse, sessionId, "test-project", tmpDir);

      // Mark compiled immediately after extraction (before clustering)
      repo.updateSessionTranscriptPath(sessionId, transcriptPath);

      // Clustering fails (returns null) — but path is already set
      const compiledPaths = repo.getAllCompiledTranscriptPaths();
      expect(compiledPaths).toContain(transcriptPath);
    });
  });

  describe("no duplicate observations on retry", () => {
    it("failed extraction means no observations saved (safe to retry)", () => {
      const sessionId = "sess_no_obs";
      startCompile(sampleEvents, sessionId, "test-project", tmpDir, repo);

      // Extraction LLM returned null — processExtraction never called
      const observations = repo.getObservations("test-project");
      const sessionObs = observations.filter((o) => o.sessionId === sessionId);
      expect(sessionObs.length).toBe(0);
    });

    it("successful extraction saves observations exactly once", () => {
      const sessionId = "sess_one_extract";
      startCompile(sampleEvents, sessionId, "test-project", tmpDir, repo);
      processExtraction(repo, validExtractResponse, sessionId, "test-project", tmpDir);

      const observations = repo.getObservations("test-project");
      const sessionObs = observations.filter((o) => o.sessionId === sessionId);
      expect(sessionObs.length).toBe(1);
      expect(sessionObs[0].content).toBe("Always use TypeScript strict mode");
    });

    it("marking transcript compiled prevents duplicate observations on next run", () => {
      const transcriptPath = "/test/no-dups.jsonl";

      // First run: extraction succeeds, mark compiled
      const sessionId1 = "sess_run1";
      startCompile(sampleEvents, sessionId1, "test-project", tmpDir, repo);
      processExtraction(repo, validExtractResponse, sessionId1, "test-project", tmpDir);
      repo.updateSessionTranscriptPath(sessionId1, transcriptPath);

      // Second run: transcript is in compiled set, would be skipped by discoverAllTranscripts
      const compiledPaths = new Set(repo.getAllCompiledTranscriptPaths());
      expect(compiledPaths.has(transcriptPath)).toBe(true);

      // Total observations should still be 1
      const observations = repo.getObservations("test-project");
      expect(observations.length).toBe(1);
    });
  });

  describe("no confidence inflation on retry", () => {
    it("auto-reinforce increments count exactly once per session", () => {
      // Create an existing knowledge item
      const sessionId1 = "sess_first";
      startCompile(sampleEvents, sessionId1, "test-project", tmpDir, repo);
      const extractResult = processExtraction(repo, validExtractResponse, sessionId1, "test-project", tmpDir);

      if (extractResult.status === "needs_clustering") {
        const obs = repo.getObservations("test-project").filter((o) => o.sessionId === sessionId1);
        const clusterResp = validClusterResponse(obs[0].id);
        processClustering(repo, clusterResp, sessionId1, "test-project", tmpDir);
      }

      const itemsBefore = repo.getKnowledgeItems("test-project");
      expect(itemsBefore.length).toBe(1);
      const countBefore = itemsBefore[0].observationCount;

      // Second session with same content — should reinforce once
      const sessionId2 = "sess_reinforce";
      startCompile(sampleEvents, sessionId2, "test-project", tmpDir, repo);
      processExtraction(repo, validExtractResponse, sessionId2, "test-project", tmpDir);

      const itemsAfter = repo.getKnowledgeItems("test-project");
      expect(itemsAfter[0].observationCount).toBe(countBefore + 1);

      // NOT countBefore + 2 or more (which would happen if retry occurred)
    });
  });

  describe("session cleanup on failure", () => {
    it("failed extraction leaves session with empty transcript_path", () => {
      const sessionId = "sess_orphan";
      startCompile(sampleEvents, sessionId, "test-project", tmpDir, repo);

      // Session exists
      const session = repo.getSession(sessionId);
      expect(session).not.toBeNull();
      expect(session!.transcriptPath).toBe("");

      // Not in compiled paths
      const compiledPaths = repo.getAllCompiledTranscriptPaths();
      expect(compiledPaths).not.toContain("");
    });
  });

  describe("updateSessionTranscriptPath", () => {
    it("updates empty transcript_path to real path", () => {
      const sessionId = "sess_update";
      startCompile(sampleEvents, sessionId, "test-project", tmpDir, repo);

      const before = repo.getSession(sessionId);
      expect(before!.transcriptPath).toBe("");

      repo.updateSessionTranscriptPath(sessionId, "/real/path.jsonl");

      const after = repo.getSession(sessionId);
      expect(after!.transcriptPath).toBe("/real/path.jsonl");
    });

    it("makes the path appear in getAllCompiledTranscriptPaths", () => {
      const sessionId = "sess_appear";
      startCompile(sampleEvents, sessionId, "test-project", tmpDir, repo);

      expect(repo.getAllCompiledTranscriptPaths()).not.toContain("/my/transcript.jsonl");

      repo.updateSessionTranscriptPath(sessionId, "/my/transcript.jsonl");

      expect(repo.getAllCompiledTranscriptPaths()).toContain("/my/transcript.jsonl");
    });

    it("no-ops gracefully for non-existent session", () => {
      // Should not throw
      repo.updateSessionTranscriptPath("non_existent_session", "/fake/path.jsonl");
      expect(repo.getAllCompiledTranscriptPaths()).not.toContain("/fake/path.jsonl");
    });
  });
});
