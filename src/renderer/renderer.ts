import { callClaude } from "../utils/bedrock.js";
import { getGitContext } from "../utils/git.js";
import type { KnowledgeItem } from "../storage/repository.js";

export const RENDER_PROMPT_VERSION = "render-v1";

const SYSTEM_PROMPT = `You are a context renderer. You select the most relevant knowledge items for an upcoming coding session and render them as a compact markdown document. Prioritize actionable information. Be concise.`;

export async function renderContext(
  items: KnowledgeItem[],
  projectRoot: string
): Promise<string> {
  if (items.length === 0) {
    return `<!-- Loop context — no knowledge items yet -->\n\nNo knowledge compiled yet. Run a session and let Loop compile observations.\n`;
  }

  const git = getGitContext(projectRoot);

  const itemsSummary = items
    .filter((i) => i.status === "active")
    .map((i) => ({
      type: i.type,
      content: i.content,
      confidence: i.confidence,
      enforce: i.enforce,
      lastSeen: new Date(i.lastSeenAt).toISOString().split("T")[0],
    }));

  const prompt = `Given this project's git context and knowledge base, select the most relevant items for the upcoming session. Return a compact markdown injection under 150 lines.

Prioritize:
- Enforced rules (always include)
- High-confidence rules
- Context items (current state)
- Lessons relevant to the modified files
- Recent decisions

Exclude:
- Items not relevant to the current branch/files
- Low-confidence lessons about unrelated topics

Format the output as markdown with these sections (omit empty sections):
## Active Rules
## Recent Lessons
## Key Decisions
## In Progress

Git context:
- Branch: ${git.branch || "unknown"}
- Recent commits: ${git.recentCommits.slice(0, 5).join("; ") || "none"}
- Modified files: ${git.modifiedFiles.slice(0, 10).join(", ") || "none"}

Knowledge base (${itemsSummary.length} items):
${JSON.stringify(itemsSummary, null, 2)}`;

  const response = await callClaude(prompt, { system: SYSTEM_PROMPT, maxTokens: 2048 });

  const timestamp = new Date().toISOString();
  return `<!-- Loop context — compiled ${timestamp} — do not edit -->\n\n${response.text.trim()}\n`;
}
