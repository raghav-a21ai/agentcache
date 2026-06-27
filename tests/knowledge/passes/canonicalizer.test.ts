import { describe, it, expect } from "vitest";
import { canonicalize, computeCanonicalKey } from "../../../src/knowledge/passes/3-canonicalizer.js";
import type { Observation } from "../../../src/storage/repository.js";

function makeObs(content: string, id = "obs_1"): Observation {
  return {
    id,
    sessionId: "s1",
    timestamp: 1000,
    type: "rule",
    content,
    sourceQuote: "quote",
    confidence: "high",
    project: "p",
  };
}

describe("canonicalize", () => {
  it("generates canonical keys for observations", () => {
    const obs = [makeObs("Always use path aliases")];
    const result = canonicalize(obs);
    expect(result.observations[0].canonicalKey).toBeDefined();
    expect(typeof result.observations[0].canonicalKey).toBe("string");
  });

  it("assigns same canonical key to semantically similar rules", () => {
    const obs = [
      makeObs("Never use relative imports", "o1"),
      makeObs("Don't use relative imports", "o2"),
    ];
    const result = canonicalize(obs);
    expect(result.observations[0].canonicalKey).toBe(result.observations[1].canonicalKey);
  });

  it("identifies auto-reinforce matches against existing items", () => {
    const obs = [makeObs("Always use path aliases")];
    const existingKeys = [computeCanonicalKey("Always use path aliases")];
    const result = canonicalize(obs, existingKeys);
    expect(result.autoReinforced).toHaveLength(1);
    expect(result.needsClustering).toHaveLength(0);
  });

  it("separates items that need LLM clustering", () => {
    const obs = [makeObs("Database migrations need dry-run")];
    const existingKeys = [computeCanonicalKey("path aliases required")];
    const result = canonicalize(obs, existingKeys);
    expect(result.autoReinforced).toHaveLength(0);
    expect(result.needsClustering).toHaveLength(1);
  });
});
