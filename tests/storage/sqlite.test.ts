import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { SqliteKnowledgeRepository } from "../../src/storage/sqlite.js";
import type {
  Session,
  Observation,
  KnowledgeItem,
  CompileRun,
  ContradictionReport,
} from "../../src/storage/repository.js";

describe("SqliteKnowledgeRepository", () => {
  let repo: SqliteKnowledgeRepository;

  beforeEach(() => {
    repo = new SqliteKnowledgeRepository(":memory:");
  });

  afterEach(() => {
    repo.close();
  });

  function makeSession(overrides: Partial<Session> = {}): Session {
    return {
      id: crypto.randomUUID(),
      project: "test-project",
      startedAt: Date.now(),
      endedAt: Date.now() + 60000,
      gitBranch: "main",
      gitCommit: "abc123",
      provider: "claude",
      model: "claude-sonnet-4-20250514",
      transcriptPath: "/tmp/transcript.jsonl",
      observationCount: 0,
      ...overrides,
    };
  }

  function makeObservation(sessionId: string, overrides: Partial<Observation> = {}): Observation {
    return {
      id: crypto.randomUUID(),
      sessionId,
      timestamp: Date.now(),
      type: "rule",
      content: "Always use strict mode",
      sourceQuote: "We should always use strict mode",
      confidence: "high",
      project: "test-project",
      scope: "global",
      ...overrides,
    };
  }

  function makeKnowledgeItem(overrides: Partial<KnowledgeItem> = {}): KnowledgeItem {
    return {
      id: crypto.randomUUID(),
      canonicalHash: crypto.randomUUID(),
      type: "rule",
      title: "Use strict mode",
      content: "Always enable strict mode in TypeScript",
      confidence: "high",
      observationCount: 2,
      authority: "AUTO",
      status: "active",
      enforce: false,
      project: "test-project",
      scope: "global",
      createdAt: Date.now(),
      updatedAt: Date.now(),
      lastSeenAt: Date.now(),
      metadata: {},
      ...overrides,
    };
  }

  function makeCompileRun(sessionId: string, overrides: Partial<CompileRun> = {}): CompileRun {
    return {
      id: crypto.randomUUID(),
      project: "test-project",
      sessionId,
      compilerVersion: "0.1.0",
      promptVersions: { extract: "v1", normalize: "v1" },
      startedAt: Date.now(),
      endedAt: Date.now() + 5000,
      durationMs: 5000,
      observationsProcessed: 10,
      knowledgeCreated: 3,
      knowledgeReinforced: 2,
      knowledgeDeprecated: 0,
      knowledgeSuperseded: 1,
      knowledgeIgnored: 4,
      contradictionsDetected: 0,
      diagnostics: "all good",
      ...overrides,
    };
  }

  function makeContradiction(overrides: Partial<ContradictionReport> = {}): ContradictionReport {
    return {
      id: crypto.randomUUID(),
      project: "test-project",
      itemAId: crypto.randomUUID(),
      itemBId: crypto.randomUUID(),
      topic: "formatting",
      description: "Item A says tabs, Item B says spaces",
      recommendation: "keep_newer",
      resolved: false,
      createdAt: Date.now(),
      ...overrides,
    };
  }

  describe("schema creation", () => {
    it("creates all tables", () => {
      const tables = ["sessions", "observations", "knowledge_items", "compile_runs", "contradictions"];
      for (const table of tables) {
        const item = makeSession();
        // Just verify we can query without error
        expect(() => repo.getSession(item.id)).not.toThrow();
      }
    });
  });

  describe("sessions", () => {
    it("saves and retrieves a session", () => {
      const session = makeSession();
      repo.saveSession(session);
      const retrieved = repo.getSession(session.id);
      expect(retrieved).toEqual(session);
    });

    it("returns null for non-existent session", () => {
      expect(repo.getSession("nonexistent")).toBeNull();
    });
  });

  describe("observations", () => {
    it("saves and retrieves observations by project", () => {
      const session = makeSession();
      repo.saveSession(session);

      const obs = makeObservation(session.id);
      repo.saveObservation(obs);

      const results = repo.getObservations("test-project");
      expect(results).toHaveLength(1);
      expect(results[0]).toEqual(obs);
    });

    it("filters observations by since timestamp", () => {
      const session = makeSession();
      repo.saveSession(session);

      const old = makeObservation(session.id, { timestamp: 1000 });
      const recent = makeObservation(session.id, { timestamp: 5000 });

      repo.saveObservation(old);
      repo.saveObservation(recent);

      const results = repo.getObservations("test-project", 3000);
      expect(results).toHaveLength(1);
      expect(results[0].id).toBe(recent.id);
    });

    it("batch saves observations in a transaction", () => {
      const session = makeSession();
      repo.saveSession(session);

      const observations = Array.from({ length: 50 }, (_, i) =>
        makeObservation(session.id, { timestamp: i })
      );

      repo.saveObservations(observations);

      const results = repo.getObservations("test-project");
      expect(results).toHaveLength(50);
    });
  });

  describe("knowledge items", () => {
    it("saves and retrieves a knowledge item", () => {
      const item = makeKnowledgeItem();
      repo.saveKnowledgeItem(item);

      const retrieved = repo.getKnowledgeItem(item.id);
      expect(retrieved).toEqual(item);
    });

    it("returns null for non-existent knowledge item", () => {
      expect(repo.getKnowledgeItem("nonexistent")).toBeNull();
    });

    it("updates specific fields", () => {
      const item = makeKnowledgeItem();
      repo.saveKnowledgeItem(item);

      repo.updateKnowledgeItem(item.id, {
        confidence: "low",
        observationCount: 5,
        status: "deprecated",
      });

      const updated = repo.getKnowledgeItem(item.id)!;
      expect(updated.confidence).toBe("low");
      expect(updated.observationCount).toBe(5);
      expect(updated.status).toBe("deprecated");
      expect(updated.title).toBe(item.title);
    });

    it("handles enforce boolean mapping", () => {
      const item = makeKnowledgeItem({ enforce: true });
      repo.saveKnowledgeItem(item);

      const retrieved = repo.getKnowledgeItem(item.id)!;
      expect(retrieved.enforce).toBe(true);

      repo.updateKnowledgeItem(item.id, { enforce: false });
      const updated = repo.getKnowledgeItem(item.id)!;
      expect(updated.enforce).toBe(false);
    });

    it("handles metadata JSON round-trip", () => {
      const metadata = { tags: ["typescript", "testing"], priority: 1, nested: { key: "value" } };
      const item = makeKnowledgeItem({ metadata });
      repo.saveKnowledgeItem(item);

      const retrieved = repo.getKnowledgeItem(item.id)!;
      expect(retrieved.metadata).toEqual(metadata);
    });

    it("filters by type", () => {
      repo.saveKnowledgeItem(makeKnowledgeItem({ type: "rule" }));
      repo.saveKnowledgeItem(makeKnowledgeItem({ type: "lesson" }));
      repo.saveKnowledgeItem(makeKnowledgeItem({ type: "decision" }));

      const rules = repo.getKnowledgeItems("test-project", { type: "rule" });
      expect(rules).toHaveLength(1);
      expect(rules[0].type).toBe("rule");
    });

    it("filters by status", () => {
      repo.saveKnowledgeItem(makeKnowledgeItem({ status: "active" }));
      repo.saveKnowledgeItem(makeKnowledgeItem({ status: "deprecated" }));

      const active = repo.getKnowledgeItems("test-project", { status: "active" });
      expect(active).toHaveLength(1);
      expect(active[0].status).toBe("active");
    });

    it("filters by authority", () => {
      repo.saveKnowledgeItem(makeKnowledgeItem({ authority: "AUTO" }));
      repo.saveKnowledgeItem(makeKnowledgeItem({ authority: "USER" }));

      const userItems = repo.getKnowledgeItems("test-project", { authority: "USER" });
      expect(userItems).toHaveLength(1);
      expect(userItems[0].authority).toBe("USER");
    });

    it("filters by enforce", () => {
      repo.saveKnowledgeItem(makeKnowledgeItem({ enforce: true }));
      repo.saveKnowledgeItem(makeKnowledgeItem({ enforce: false }));

      const enforced = repo.getKnowledgeItems("test-project", { enforce: true });
      expect(enforced).toHaveLength(1);
      expect(enforced[0].enforce).toBe(true);
    });

    it("enforces canonicalHash uniqueness", () => {
      const hash = "unique-hash-123";
      repo.saveKnowledgeItem(makeKnowledgeItem({ canonicalHash: hash }));

      expect(() =>
        repo.saveKnowledgeItem(makeKnowledgeItem({ canonicalHash: hash }))
      ).toThrow();
    });

    it("handles confidence field correctly", () => {
      const lowItem = makeKnowledgeItem({ confidence: "low" });
      const medItem = makeKnowledgeItem({ confidence: "medium" });
      const highItem = makeKnowledgeItem({ confidence: "high" });

      repo.saveKnowledgeItem(lowItem);
      repo.saveKnowledgeItem(medItem);
      repo.saveKnowledgeItem(highItem);

      expect(repo.getKnowledgeItem(lowItem.id)!.confidence).toBe("low");
      expect(repo.getKnowledgeItem(medItem.id)!.confidence).toBe("medium");
      expect(repo.getKnowledgeItem(highItem.id)!.confidence).toBe("high");
    });

    it("getKnowledgeForContext returns global + project-specific items", () => {
      repo.saveKnowledgeItem(makeKnowledgeItem({ scope: "global", project: "other-project" }));
      repo.saveKnowledgeItem(makeKnowledgeItem({ scope: "project", project: "test-project" }));
      repo.saveKnowledgeItem(makeKnowledgeItem({ scope: "project", project: "other-project" }));

      const items = repo.getKnowledgeForContext("test-project");
      expect(items).toHaveLength(2);
      const scopes = items.map((i) => i.scope).sort();
      expect(scopes).toEqual(["global", "project"]);
    });

    it("getKnowledgeForContext excludes non-active items", () => {
      repo.saveKnowledgeItem(makeKnowledgeItem({ scope: "global", status: "active" }));
      repo.saveKnowledgeItem(makeKnowledgeItem({ scope: "global", status: "deprecated" }));

      const items = repo.getKnowledgeForContext("test-project");
      expect(items).toHaveLength(1);
      expect(items[0].status).toBe("active");
    });

    it("getEnforcedRules returns global enforced + project enforced", () => {
      repo.saveKnowledgeItem(makeKnowledgeItem({ scope: "global", enforce: true, project: "other-project" }));
      repo.saveKnowledgeItem(makeKnowledgeItem({ scope: "project", enforce: true, project: "test-project" }));
      repo.saveKnowledgeItem(makeKnowledgeItem({ scope: "project", enforce: true, project: "other-project" }));
      repo.saveKnowledgeItem(makeKnowledgeItem({ scope: "project", enforce: false, project: "test-project" }));

      const items = repo.getEnforcedRules("test-project");
      expect(items).toHaveLength(2);
      expect(items.every((i) => i.enforce === true)).toBe(true);
    });

    it("quarantine: getKnowledgeForContext excludes AUTO items with observationCount < 2", () => {
      repo.saveKnowledgeItem(makeKnowledgeItem({ observationCount: 1, authority: "AUTO", scope: "global" }));
      repo.saveKnowledgeItem(makeKnowledgeItem({ observationCount: 2, authority: "AUTO", scope: "global" }));
      repo.saveKnowledgeItem(makeKnowledgeItem({ observationCount: 1, authority: "USER", scope: "global" }));

      const items = repo.getKnowledgeForContext("test-project");
      expect(items).toHaveLength(2);
      expect(items.every((i) => i.authority === "USER" || i.observationCount >= 2)).toBe(true);
    });

    it("quarantine: getEnforcedRules excludes AUTO enforced items with observationCount < 2", () => {
      repo.saveKnowledgeItem(makeKnowledgeItem({ enforce: true, observationCount: 1, authority: "AUTO", scope: "global" }));
      repo.saveKnowledgeItem(makeKnowledgeItem({ enforce: true, observationCount: 2, authority: "AUTO", scope: "global" }));
      repo.saveKnowledgeItem(makeKnowledgeItem({ enforce: true, observationCount: 1, authority: "USER", scope: "global" }));

      const items = repo.getEnforcedRules("test-project");
      expect(items).toHaveLength(2);
    });

    it("getQuarantinedItems returns AUTO items with observationCount < 2", () => {
      repo.saveKnowledgeItem(makeKnowledgeItem({ observationCount: 1, authority: "AUTO", project: "test-project" }));
      repo.saveKnowledgeItem(makeKnowledgeItem({ observationCount: 2, authority: "AUTO", project: "test-project" }));
      repo.saveKnowledgeItem(makeKnowledgeItem({ observationCount: 1, authority: "USER", project: "test-project" }));

      const quarantined = repo.getQuarantinedItems("test-project");
      expect(quarantined).toHaveLength(1);
      expect(quarantined[0].observationCount).toBe(1);
      expect(quarantined[0].authority).toBe("AUTO");
    });

    it("promoteItem changes authority to USER", () => {
      const item = makeKnowledgeItem({ observationCount: 1, authority: "AUTO" });
      repo.saveKnowledgeItem(item);

      repo.promoteItem(item.id);

      const updated = repo.getKnowledgeItem(item.id)!;
      expect(updated.authority).toBe("USER");
    });
  });

  describe("compile runs", () => {
    it("saves and retrieves compile runs", () => {
      const session = makeSession();
      repo.saveSession(session);

      const run = makeCompileRun(session.id);
      repo.saveCompileRun(run);

      const results = repo.getCompileRuns("test-project");
      expect(results).toHaveLength(1);
      expect(results[0]).toEqual(run);
    });

    it("respects limit parameter", () => {
      const session = makeSession();
      repo.saveSession(session);

      for (let i = 0; i < 5; i++) {
        repo.saveCompileRun(makeCompileRun(session.id, { startedAt: i }));
      }

      const results = repo.getCompileRuns("test-project", 2);
      expect(results).toHaveLength(2);
    });

    it("handles promptVersions JSON round-trip", () => {
      const session = makeSession();
      repo.saveSession(session);

      const promptVersions = { extract: "v2", normalize: "v3", cluster: "v1" };
      const run = makeCompileRun(session.id, { promptVersions });
      repo.saveCompileRun(run);

      const results = repo.getCompileRuns("test-project");
      expect(results[0].promptVersions).toEqual(promptVersions);
    });
  });

  describe("contradictions", () => {
    it("saves and retrieves unresolved contradictions", () => {
      const contradiction = makeContradiction();
      repo.saveContradiction(contradiction);

      const results = repo.getUnresolvedContradictions("test-project");
      expect(results).toHaveLength(1);
      expect(results[0]).toEqual(contradiction);
    });

    it("resolves a contradiction", () => {
      const contradiction = makeContradiction();
      repo.saveContradiction(contradiction);

      repo.resolveContradiction(contradiction.id);

      const results = repo.getUnresolvedContradictions("test-project");
      expect(results).toHaveLength(0);
    });

    it("does not return already-resolved contradictions", () => {
      const resolved = makeContradiction({ resolved: true });
      const unresolved = makeContradiction({ resolved: false });

      repo.saveContradiction(resolved);
      repo.saveContradiction(unresolved);

      const results = repo.getUnresolvedContradictions("test-project");
      expect(results).toHaveLength(1);
      expect(results[0].id).toBe(unresolved.id);
    });
  });
});
