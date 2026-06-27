import { describe, it, expect } from "vitest";
import { normalize } from "../../../src/knowledge/passes/2-normalizer.js";
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

describe("normalize", () => {
  it("strips filler phrases", () => {
    const obs = [makeObs("I noticed that we should always use path aliases")];
    const result = normalize(obs);
    expect(result[0].content).toBe("Always use path aliases");
  });

  it("normalizes rules to imperative form", () => {
    const obs = [makeObs("you should never use relative imports")];
    const result = normalize(obs);
    expect(result[0].content).toBe("Never use relative imports");
  });

  it("deduplicates exact matches within session", () => {
    const obs = [makeObs("Always use path aliases", "o1"), makeObs("Always use path aliases", "o2")];
    const result = normalize(obs);
    expect(result).toHaveLength(1);
  });

  it("trims to one sentence", () => {
    const obs = [makeObs("Always use path aliases. This is important because it makes imports cleaner. Also it helps with refactoring.")];
    const result = normalize(obs);
    expect(result[0].content).not.toContain(". This is important");
  });
});
