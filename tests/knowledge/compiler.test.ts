import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { SqliteKnowledgeRepository } from "../../src/storage/sqlite.js";
import { mkdirSync, existsSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { mkdtempSync, rmSync } from "fs";

vi.mock("../../src/utils/bedrock.js", () => ({
  callClaude: vi.fn(async (prompt: string) => {
    // Pass 1: Extraction — match the extractor's prompt structure
    if (prompt.includes("Extract distinct learnings") || prompt.includes("<transcript>")) {
      return {
        text: JSON.stringify({
          observations: [
            { type: "rule", content: "Always use path aliases instead of relative imports", sourceQuote: "Use path aliases", confidence: "high" },
            { type: "lesson", content: "Database migration failed because we didn't run dry-run first", sourceQuote: "broke prod", confidence: "high" },
          ],
        }),
        inputTokens: 100,
        outputTokens: 50,
      };
    }
    // Pass 4: Clustering — parse obs IDs from the JSON in the prompt
    if (prompt.includes("determine the action") || prompt.includes("CREATE    —")) {
      const obsMatches = prompt.match(/"id":\s*"(obs_[^"]+)"/g) || [];
      const obsIds = obsMatches.map((m) => m.match(/"(obs_[^"]+)"/)?.[1]).filter(Boolean);
      return {
        text: JSON.stringify({
          clusters: obsIds.map((id) => ({
            observationId: id,
            action: "CREATE",
            reasoning: "new knowledge item",
          })),
        }),
        inputTokens: 100,
        outputTokens: 50,
      };
    }
    // Pass 5: Contradiction detection — return no contradictions
    if (prompt.includes("superseded") || prompt.includes("contradictions")) {
      return { text: '{ "contradictions": [] }', inputTokens: 10, outputTokens: 10 };
    }
    // Default fallback
    return { text: '{ "observations": [] }', inputTokens: 10, outputTokens: 10 };
  }),
}));

vi.mock("../../src/utils/git.js", () => ({
  getGitContext: vi.fn(() => ({
    branch: "main",
    commit: "abc1234",
    recentCommits: ["abc1234 test commit"],
    modifiedFiles: ["src/test.ts"],
  })),
  getGitRoot: vi.fn(() => null),
}));

describe("Compiler Integration", () => {
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

  it("full pipeline: extract -> normalize -> canonicalize -> cluster -> compile -> project", async () => {
    const { runCompiler } = await import("../../src/knowledge/compiler.js");

    const sampleEvents = [
      { type: "message", role: "user", content: "Always use path aliases in this project, never relative imports" },
      { type: "message", role: "assistant", content: "Got it, I'll use path aliases instead of relative imports." },
      { type: "message", role: "user", content: "We broke prod last week because we didn't run dry-run first on migrations." },
      { type: "message", role: "assistant", content: "Noted. I'll always do a dry-run before applying migrations." },
    ];

    const result = await runCompiler({
      repo,
      events: sampleEvents,
      sessionId: "test_session_1",
      project: "test-project",
      projectRoot: tmpDir,
    });

    // Verify compile run recorded with correct version
    expect(result.run.compilerVersion).toBe("0.1.0");
    expect(result.run.observationsProcessed).toBeGreaterThan(0);
    expect(result.run.project).toBe("test-project");
    expect(result.run.sessionId).toBe("test_session_1");

    // Verify diagnostics
    expect(result.diagnostics.observationsExtracted).toBeGreaterThan(0);
    expect(result.diagnostics.observationsNormalized).toBeGreaterThan(0);

    // Verify observations saved to DB
    const obs = repo.getObservations("test-project");
    expect(obs.length).toBeGreaterThan(0);
    expect(obs[0].project).toBe("test-project");
    expect(obs[0].sessionId).toBe("test_session_1");

    // Verify compile run persisted in DB
    const runs = repo.getCompileRuns("test-project");
    expect(runs).toHaveLength(1);
    expect(runs[0].compilerVersion).toBe("0.1.0");
    expect(runs[0].observationsProcessed).toBeGreaterThan(0);

    // Verify knowledge items created
    const items = repo.getKnowledgeItems("test-project");
    expect(items.length).toBeGreaterThan(0);
    expect(items[0].status).toBe("active");
    expect(items[0].project).toBe("test-project");
    expect(items[0].authority).toBe("AUTO");

    // Verify session saved
    const session = repo.getSession("test_session_1");
    expect(session).not.toBeNull();
    expect(session!.project).toBe("test-project");
    expect(session!.gitBranch).toBe("main");
    expect(session!.gitCommit).toBe("abc1234");

    // Verify projector wrote markdown files
    expect(existsSync(join(tmpDir, ".loop", "generated", "RULES.md"))).toBe(true);
    expect(existsSync(join(tmpDir, ".loop", "generated", "LESSONS.md"))).toBe(true);
    expect(existsSync(join(tmpDir, ".loop", "generated", "DECISIONS.md"))).toBe(true);
    expect(existsSync(join(tmpDir, ".loop", "generated", "CONTEXT.md"))).toBe(true);

    // Verify diagnostics have correct counts
    expect(result.diagnostics.knowledgeCreated).toBe(items.length);
    expect(result.diagnostics.contradictionsDetected).toBe(0);
  });
});
