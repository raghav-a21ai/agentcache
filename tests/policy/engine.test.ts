import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { evaluatePolicy } from "../../src/policy/engine.js";
import { SqliteKnowledgeRepository } from "../../src/storage/sqlite.js";

describe("Policy Engine", () => {
  let repo: SqliteKnowledgeRepository;

  beforeEach(() => {
    repo = new SqliteKnowledgeRepository(":memory:");
  });

  afterEach(() => {
    repo.close();
  });

  it("blocks force-push to main", () => {
    const result = evaluatePolicy({ tool_name: "Bash", tool_input: { command: "git push --force origin main" } }, []);
    expect(result.decision).toBe("block");
    expect(result.reason).toContain("Force-push");
  });

  it("blocks rm -rf /", () => {
    const result = evaluatePolicy({ tool_name: "Bash", tool_input: { command: "rm -rf /" } }, []);
    expect(result.decision).toBe("block");
  });

  it("blocks writes to .env files", () => {
    const result = evaluatePolicy({ tool_name: "Write", tool_input: { file_path: "/project/.env" } }, []);
    expect(result.decision).toBe("block");
  });

  it("allows normal commands", () => {
    const result = evaluatePolicy({ tool_name: "Bash", tool_input: { command: "npm test" } }, []);
    expect(result.decision).toBeUndefined();
  });

  it("blocks commands matching enforced knowledge items", () => {
    repo.saveKnowledgeItem({
      id: "ki_1",
      canonicalHash: "h1",
      type: "rule",
      title: "No prisma migrate deploy",
      content: "Never run prisma migrate deploy in production",
      confidence: "high",
      observationCount: 5,
      authority: "AUTO",
      status: "active",
      enforce: true,
      project: "p",
      scope: "global",
      createdAt: 1000,
      updatedAt: 1000,
      lastSeenAt: 1000,
      metadata: {},
    });

    const enforced = repo.getEnforcedRules("p");
    const result = evaluatePolicy({ tool_name: "Bash", tool_input: { command: "npx prisma migrate deploy" } }, enforced);
    expect(result.decision).toBe("block");
    expect(result.reason).toContain("enforced rule");
  });

  it("allows commands not matching enforced rules", () => {
    repo.saveKnowledgeItem({
      id: "ki_1",
      canonicalHash: "h1",
      type: "rule",
      title: "No migrations without dry-run",
      content: "Never run database migrations without dry-run flag",
      confidence: "high",
      observationCount: 5,
      authority: "AUTO",
      status: "active",
      enforce: true,
      project: "p",
      scope: "global",
      createdAt: 1000,
      updatedAt: 1000,
      lastSeenAt: 1000,
      metadata: {},
    });

    const enforced = repo.getEnforcedRules("p");
    const result = evaluatePolicy({ tool_name: "Bash", tool_input: { command: "npm install express" } }, enforced);
    expect(result.decision).toBeUndefined();
  });
});
