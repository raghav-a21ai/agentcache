import type { KnowledgeRepository, KnowledgeItem } from "../storage/repository.js";

export interface PolicyResult {
  decision?: "block";
  reason?: string;
}

const HARDCODED_BLOCKS: Array<{ pattern: RegExp; reason: string }> = [
  { pattern: /git\s+push\s+--force\s+(origin\s+)?(main|master)/i, reason: "Force-push to main/master is blocked by Loop policy" },
  { pattern: /rm\s+-rf\s+[\/~]/i, reason: "Destructive rm -rf on root or home is blocked by Loop policy" },
  { pattern: />\s*(.*\.(env|pem|key))/i, reason: "Writing to sensitive files (.env, .pem, .key) is blocked by Loop policy" },
];

export function evaluatePolicy(
  repo: KnowledgeRepository,
  project: string,
  toolName: string,
  toolInput: Record<string, unknown>
): PolicyResult {
  const command = extractCommand(toolName, toolInput);
  if (!command) return {};

  for (const block of HARDCODED_BLOCKS) {
    if (block.pattern.test(command)) {
      return { decision: "block", reason: block.reason };
    }
  }

  const enforced = repo.getKnowledgeItems(project, { enforce: true, status: "active" });
  for (const item of enforced) {
    if (matchesRule(item, toolName, command)) {
      return { decision: "block", reason: `Blocked by enforced rule: ${item.content}` };
    }
  }

  return {};
}

function extractCommand(toolName: string, toolInput: Record<string, unknown>): string | null {
  if (toolName === "Bash" && typeof toolInput.command === "string") {
    return toolInput.command;
  }
  if (toolName === "Write" && typeof toolInput.file_path === "string") {
    return `> ${toolInput.file_path}`;
  }
  if (toolName === "Edit" && typeof toolInput.file_path === "string") {
    return `edit ${toolInput.file_path}`;
  }
  return null;
}

function matchesRule(item: KnowledgeItem, _toolName: string, command: string): boolean {
  const content = item.content.toLowerCase();
  const cmd = command.toLowerCase();

  const keywords = content
    .replace(/never|always|don't|do not|avoid|must not/gi, "")
    .split(/\s+/)
    .filter((w) => w.length > 3);

  if (keywords.length === 0) return false;
  const matchCount = keywords.filter((k) => cmd.includes(k)).length;
  return matchCount >= Math.ceil(keywords.length * 0.5);
}
