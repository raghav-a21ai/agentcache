import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtempSync, rmSync, existsSync, readFileSync } from "fs";
import { join } from "path";
import { tmpdir, homedir } from "os";
import type { KnowledgeItem } from "../../../src/storage/repository.js";

// Mock homedir to use temp dir for global skills
let tmpHome: string;
vi.mock("os", async () => {
  const actual = await vi.importActual("os");
  return { ...actual, homedir: () => tmpHome };
});

describe("Skill Projector", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "agentcache-test-skill-"));
    tmpHome = tmpDir;
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
    vi.resetModules();
  });

  function makeItem(overrides: Partial<KnowledgeItem>): KnowledgeItem {
    return {
      id: "ki_" + Math.random().toString(36).slice(2, 8),
      canonicalHash: "hash",
      type: "rule",
      title: "Test",
      content: "Test content",
      confidence: "high",
      observationCount: 5,
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

  it("writes global skill to ~/.agentcache/skills/developer-knowledge/SKILL.md", async () => {
    const { projectToSkills } = await import("../../../src/knowledge/passes/7b-skill-projector.js");

    const items = [
      makeItem({ type: "rule", content: "Always use TypeScript strict mode", scope: "global" }),
      makeItem({ type: "lesson", content: "Never mock DB in integration tests", scope: "global" }),
    ];

    projectToSkills(items, join(tmpDir, "myproject"));

    const skillPath = join(tmpDir, ".agentcache", "skills", "developer-knowledge", "SKILL.md");
    expect(existsSync(skillPath)).toBe(true);

    const content = readFileSync(skillPath, "utf-8");
    expect(content).toContain("---");
    expect(content).toContain("name: developer-knowledge");
    expect(content).toContain("description:");
    expect(content).toContain("## Rules");
    expect(content).toContain("Always use TypeScript strict mode");
    expect(content).toContain("## Lessons");
    expect(content).toContain("Never mock DB in integration tests");
  });

  it("writes project skill to <projectRoot>/.agentcache/skills/project-knowledge/SKILL.md", async () => {
    const { projectToSkills } = await import("../../../src/knowledge/passes/7b-skill-projector.js");
    const projectRoot = join(tmpDir, "myproject");

    const items = [
      makeItem({ type: "decision", content: "Using Drizzle ORM", scope: "project" }),
      makeItem({ type: "context", content: "Migrating to GraphQL", scope: "project" }),
    ];

    projectToSkills(items, projectRoot);

    const skillPath = join(projectRoot, ".agentcache", "skills", "project-knowledge", "SKILL.md");
    expect(existsSync(skillPath)).toBe(true);

    const content = readFileSync(skillPath, "utf-8");
    expect(content).toContain("name: project-knowledge");
    expect(content).toContain("## Decisions");
    expect(content).toContain("Using Drizzle ORM");
    expect(content).toContain("## Current Context");
    expect(content).toContain("Migrating to GraphQL");
  });

  it("includes enforced tag for enforced rules", async () => {
    const { projectToSkills } = await import("../../../src/knowledge/passes/7b-skill-projector.js");

    const items = [
      makeItem({ type: "rule", content: "Never force-push to main", scope: "global", enforce: true }),
    ];

    projectToSkills(items, join(tmpDir, "p"));

    const content = readFileSync(
      join(tmpDir, ".agentcache", "skills", "developer-knowledge", "SKILL.md"),
      "utf-8"
    );
    expect(content).toContain("[ENFORCED]");
  });

  it("does not write project skill when no project-scoped items", async () => {
    const { projectToSkills } = await import("../../../src/knowledge/passes/7b-skill-projector.js");
    const projectRoot = join(tmpDir, "myproject");

    const items = [
      makeItem({ type: "rule", content: "Global rule", scope: "global" }),
    ];

    projectToSkills(items, projectRoot);

    const skillPath = join(projectRoot, ".agentcache", "skills", "project-knowledge", "SKILL.md");
    expect(existsSync(skillPath)).toBe(false);
  });

  it("respects 5000 token limit by truncating", async () => {
    const { projectToSkills } = await import("../../../src/knowledge/passes/7b-skill-projector.js");

    const items = Array.from({ length: 200 }, (_, i) =>
      makeItem({
        type: "rule",
        content: `This is a very long rule number ${i} that contains plenty of text to push the total over the 5000 token limit which is approximately 20000 characters when using 4 chars per token`,
        scope: "global",
      })
    );

    projectToSkills(items, join(tmpDir, "p"));

    const content = readFileSync(
      join(tmpDir, ".agentcache", "skills", "developer-knowledge", "SKILL.md"),
      "utf-8"
    );
    expect(content.length).toBeLessThanOrEqual(20050);
    expect(content).toContain("Truncated to stay within 5000 token skill budget");
  });

  it("has valid YAML frontmatter", async () => {
    const { projectToSkills } = await import("../../../src/knowledge/passes/7b-skill-projector.js");

    const items = [
      makeItem({ type: "rule", content: "Test rule", scope: "global" }),
    ];

    projectToSkills(items, join(tmpDir, "p"));

    const content = readFileSync(
      join(tmpDir, ".agentcache", "skills", "developer-knowledge", "SKILL.md"),
      "utf-8"
    );
    const frontmatter = content.split("---")[1];
    expect(frontmatter).toContain("name:");
    expect(frontmatter).toContain("description:");
  });

  it("sorts by confidence (high first)", async () => {
    const { projectToSkills } = await import("../../../src/knowledge/passes/7b-skill-projector.js");

    const items = [
      makeItem({ type: "rule", content: "Low confidence rule", scope: "global", confidence: "low" }),
      makeItem({ type: "rule", content: "High confidence rule", scope: "global", confidence: "high" }),
      makeItem({ type: "rule", content: "Medium confidence rule", scope: "global", confidence: "medium" }),
    ];

    projectToSkills(items, join(tmpDir, "p"));

    const content = readFileSync(
      join(tmpDir, ".agentcache", "skills", "developer-knowledge", "SKILL.md"),
      "utf-8"
    );
    const highIdx = content.indexOf("High confidence rule");
    const medIdx = content.indexOf("Medium confidence rule");
    const lowIdx = content.indexOf("Low confidence rule");
    expect(highIdx).toBeLessThan(medIdx);
    expect(medIdx).toBeLessThan(lowIdx);
  });
});
