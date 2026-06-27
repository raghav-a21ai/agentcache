import type { Observation } from "../../storage/repository.js";
import type { TranscriptEvent } from "../../utils/transcript.js";
import { randomUUID } from "crypto";

export const EXTRACT_PROMPT_VERSION = "extract-v1";

export function buildExtractionPrompt(events: TranscriptEvent[]): string {
  const transcript = events
    .filter((e) => e.content || e.tool_name)
    .map((e) => {
      if (e.role) return `[${e.role}]: ${e.content}`;
      if (e.tool_name) return `[tool:${e.tool_name}]: ${JSON.stringify(e.tool_input).slice(0, 500)}`;
      return "";
    })
    .filter(Boolean)
    .join("\n");

  return `You are a knowledge extraction engine. Analyze this coding session transcript and extract distinct learnings.

Extract into four types:
- rule: a standing instruction or constraint the developer expressed
- lesson: a mistake made and what fixed it
- decision: an architectural or design choice with rationale
- context: current task state, open threads, what was left in progress

Return ONLY valid JSON: { "observations": [{ "type": "rule"|"lesson"|"decision"|"context", "content": "...", "sourceQuote": "...", "confidence": "high"|"medium" }] }

Only return high and medium confidence items. Ignore conversational noise, tool outputs, and implementation details that aren't generalizable.

<transcript>
${transcript}
</transcript>`;
}

export function parseExtractionResponse(
  text: string,
  sessionId: string,
  project: string
): Observation[] {
  const jsonMatch = text.match(/\{[\s\S]*\}/);
  if (!jsonMatch) return [];

  const parsed = JSON.parse(jsonMatch[0]);
  if (!parsed.observations || !Array.isArray(parsed.observations)) return [];

  const now = Date.now();
  return parsed.observations
    .filter((o: any) => o.type && o.content && o.confidence)
    .filter((o: any) => ["high", "medium"].includes(o.confidence))
    .map((o: any) => ({
      id: `obs_${randomUUID().slice(0, 8)}`,
      sessionId,
      timestamp: now,
      type: o.type as Observation["type"],
      content: o.content,
      sourceQuote: o.sourceQuote || "",
      confidence: o.confidence as Observation["confidence"],
      project,
      scope: (o.scope || ((o.type === "rule" || o.type === "lesson") ? "global" : "project")) as Observation["scope"],
    }));
}
