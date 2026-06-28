import { mkdirSync, writeFileSync, existsSync } from "fs";
import { join } from "path";
import { homedir } from "os";
import type { KnowledgeItem } from "../../storage/repository.js";

const MAX_SKILL_TOKENS = 5000;
const AVG_CHARS_PER_TOKEN = 4;
const MAX_SKILL_CHARS = MAX_SKILL_TOKENS * AVG_CHARS_PER_TOKEN;

export function projectToSkills(items: KnowledgeItem[], projectRoot: string): void {
  const active = items.filter((i) => i.status === "active");

  const globalItems = active.filter((i) => i.scope === "global");
  const projectItems = active.filter((i) => i.scope === "project");

  writeGlobalSkill(globalItems);
  writeProjectSkill(projectItems, projectRoot);
}

function writeGlobalSkill(items: KnowledgeItem[]): void {
  const skillDir = join(homedir(), ".agentcache", "skills", "developer-knowledge");
  mkdirSync(skillDir, { recursive: true });

  const rules = items.filter((i) => i.type === "rule").sort(byConfidence);
  const lessons = items.filter((i) => i.type === "lesson").sort(byConfidence);

  const body = buildSkillBody(rules, lessons, [], []);
  const content = buildSkillFile(
    "developer-knowledge",
    "Engineering rules and lessons learned across all projects — compiled automatically from coding sessions by AgentCache",
    body
  );

  writeFileSync(join(skillDir, "SKILL.md"), truncateToLimit(content), "utf-8");
}

function writeProjectSkill(items: KnowledgeItem[], projectRoot: string): void {
  if (!projectRoot || projectRoot === process.cwd()) return;
  if (items.length === 0) return;

  const skillDir = join(projectRoot, ".agentcache", "skills", "project-knowledge");
  mkdirSync(skillDir, { recursive: true });

  const rules = items.filter((i) => i.type === "rule").sort(byConfidence);
  const lessons = items.filter((i) => i.type === "lesson").sort(byConfidence);
  const decisions = items.filter((i) => i.type === "decision").sort(byConfidence);
  const context = items.filter((i) => i.type === "context").sort((a, b) => b.lastSeenAt - a.lastSeenAt);

  const body = buildSkillBody(rules, lessons, decisions, context);
  const content = buildSkillFile(
    "project-knowledge",
    "Project-specific decisions, rules, context, and lessons — compiled automatically from coding sessions by AgentCache",
    body
  );

  writeFileSync(join(skillDir, "SKILL.md"), truncateToLimit(content), "utf-8");
}

function buildSkillFile(name: string, description: string, body: string): string {
  return `---
name: ${name}
description: "${description}"
---

${body}`;
}

function buildSkillBody(
  rules: KnowledgeItem[],
  lessons: KnowledgeItem[],
  decisions: KnowledgeItem[],
  context: KnowledgeItem[]
): string {
  let out = "";

  if (rules.length > 0) {
    out += "## Rules\n\nFollow these without exception:\n\n";
    out += rules.map((r) => `- ${r.content}${enforceTag(r)}`).join("\n") + "\n\n";
  }

  if (lessons.length > 0) {
    out += "## Lessons\n\nPitfalls learned from past sessions:\n\n";
    out += lessons.map((l) => `- ${l.content}`).join("\n") + "\n\n";
  }

  if (decisions.length > 0) {
    out += "## Decisions\n\nArchitectural choices in effect — do not contradict:\n\n";
    out += decisions.map((d) => `- ${d.content}`).join("\n") + "\n\n";
  }

  if (context.length > 0) {
    out += "## Current Context\n\nActive project state (may be temporal):\n\n";
    out += context.map((c) => `- ${c.content}`).join("\n") + "\n\n";
  }

  return out.trimEnd() + "\n";
}

function enforceTag(item: KnowledgeItem): string {
  return item.enforce ? " [ENFORCED]" : "";
}

function byConfidence(a: KnowledgeItem, b: KnowledgeItem): number {
  const order = { high: 3, medium: 2, low: 1 };
  return (order[b.confidence] || 0) - (order[a.confidence] || 0);
}

function truncateToLimit(content: string): string {
  if (content.length <= MAX_SKILL_CHARS) return content;

  const lines = content.split("\n");
  let result = "";
  for (const line of lines) {
    if ((result + line + "\n").length > MAX_SKILL_CHARS - 50) break;
    result += line + "\n";
  }
  result += "\n<!-- Truncated to stay within 5000 token skill budget -->\n";
  return result;
}
