import { describe, it, expect } from "vitest";
import { compileKnowledge } from "../../../src/knowledge/passes/6-compile.js";
import type { KnowledgeItem } from "../../../src/storage/repository.js";
import type { KnowledgeCluster } from "../../../src/knowledge/passes/4-clusterer.js";
import type { CanonicalizedObservation } from "../../../src/knowledge/passes/3-canonicalizer.js";

function makeItem(overrides: Partial<KnowledgeItem> = {}): KnowledgeItem {
  return {
    id: "ki_001",
    canonicalHash: "hash1",
    type: "rule",
    title: "Use path aliases",
    content: "Always use path aliases",
    confidence: "medium",
    observationCount: 3,
    authority: "AUTO",
    status: "active",
    supersededById: undefined,
    enforce: false,
    project: "p",
    createdAt: 1000,
    updatedAt: 1000,
    lastSeenAt: 1000,
    metadata: {},
    ...overrides,
  };
}

function makeObs(id: string, content: string): CanonicalizedObservation {
  return {
    id,
    sessionId: "s1",
    timestamp: 5000,
    type: "rule",
    content,
    sourceQuote: "q",
    confidence: "high",
    project: "p",
    canonicalKey: "key",
  };
}

describe("compileKnowledge", () => {
  it("creates new KnowledgeItem for CREATE action", () => {
    const clusters: KnowledgeCluster[] = [
      { observationId: "obs_1", action: "CREATE", reasoning: "new" },
    ];
    const obs = [makeObs("obs_1", "Always run dry-run migrations")];
    const result = compileKnowledge(clusters, [], obs, "p", 5000);

    expect(result.created).toHaveLength(1);
    expect(result.created[0].confidence).toBe("low");
    expect(result.created[0].observationCount).toBe(1);
  });

  it("reinforces existing item", () => {
    const existing = [makeItem()];
    const clusters: KnowledgeCluster[] = [
      { observationId: "obs_1", action: "REINFORCE", targetKnowledgeItemId: "ki_001", reasoning: "same" },
    ];
    const obs = [makeObs("obs_1", "Use path aliases")];
    const result = compileKnowledge(clusters, existing, obs, "p", 5000);

    expect(result.reinforced).toHaveLength(1);
    expect(result.reinforced[0].observationCount).toBe(4);
    expect(result.reinforced[0].lastSeenAt).toBe(5000);
  });

  it("promotes confidence at threshold", () => {
    const existing = [makeItem({ observationCount: 6, confidence: "medium" })];
    const clusters: KnowledgeCluster[] = [
      { observationId: "obs_1", action: "REINFORCE", targetKnowledgeItemId: "ki_001", reasoning: "same" },
    ];
    const obs = [makeObs("obs_1", "path aliases")];
    const result = compileKnowledge(clusters, existing, obs, "p", 5000);

    expect(result.reinforced[0].confidence).toBe("high");
    expect(result.reinforced[0].observationCount).toBe(7);
  });

  it("supersedes an existing item", () => {
    const existing = [makeItem()];
    const clusters: KnowledgeCluster[] = [
      { observationId: "obs_1", action: "SUPERSEDE", targetKnowledgeItemId: "ki_001", reasoning: "replaced" },
    ];
    const obs = [makeObs("obs_1", "Use tsconfig paths instead of aliases")];
    const result = compileKnowledge(clusters, existing, obs, "p", 5000);

    expect(result.superseded).toHaveLength(1);
    expect(result.superseded[0].id).toBe("ki_001");
    expect(result.superseded[0].status).toBe("superseded");
    expect(result.created).toHaveLength(1);
  });

  it("deprecates an existing item", () => {
    const existing = [makeItem()];
    const clusters: KnowledgeCluster[] = [
      { observationId: "obs_1", action: "DEPRECATE", targetKnowledgeItemId: "ki_001", reasoning: "no longer needed" },
    ];
    const obs = [makeObs("obs_1", "removed")];
    const result = compileKnowledge(clusters, existing, obs, "p", 5000);

    expect(result.deprecated).toHaveLength(1);
    expect(result.deprecated[0].status).toBe("deprecated");
  });

  it("ignores IGNORE actions", () => {
    const clusters: KnowledgeCluster[] = [
      { observationId: "obs_1", action: "IGNORE", reasoning: "noise" },
    ];
    const obs = [makeObs("obs_1", "whatever")];
    const result = compileKnowledge(clusters, [], obs, "p", 5000);

    expect(result.created).toHaveLength(0);
    expect(result.ignored).toBe(1);
  });
});
