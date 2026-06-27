import { callClaude } from "../../utils/bedrock.js";
import type { KnowledgeItem } from "../../storage/repository.js";
import type { CanonicalizedObservation } from "./3-canonicalizer.js";

export const CLUSTER_PROMPT_VERSION = "cluster-v1";

export interface KnowledgeCluster {
  observationId: string;
  action: "CREATE" | "REINFORCE" | "SUPERSEDE" | "DEPRECATE" | "IGNORE";
  targetKnowledgeItemId?: string;
  reasoning: string;
}

const SYSTEM_PROMPT = `You are a knowledge clustering engine. You determine whether new observations create new knowledge or relate to existing items. Be conservative — only REINFORCE when the meaning is clearly the same, only SUPERSEDE when the new observation explicitly contradicts or replaces the old.`;

export async function cluster(
  observations: CanonicalizedObservation[],
  existingItems: KnowledgeItem[]
): Promise<KnowledgeCluster[]> {
  if (observations.length === 0) return [];

  const obsJson = observations.map((o) => ({
    id: o.id,
    type: o.type,
    content: o.content,
    canonicalKey: o.canonicalKey,
  }));

  const itemsJson = existingItems
    .filter((i) => i.status === "active")
    .map((i) => ({
      id: i.id,
      type: i.type,
      content: i.content,
      canonicalHash: i.canonicalHash,
    }));

  const prompt = `Given these new observations and existing knowledge items, determine the action for each observation:

CREATE    — genuinely new knowledge, no existing item covers it
REINFORCE — confirms an existing item (provide targetKnowledgeItemId)
SUPERSEDE — replaces/corrects an existing item (provide targetKnowledgeItemId)
DEPRECATE — makes an existing item irrelevant (provide targetKnowledgeItemId)
IGNORE    — duplicate, trivial, or too vague to keep

New observations:
${JSON.stringify(obsJson, null, 2)}

Existing knowledge items:
${JSON.stringify(itemsJson, null, 2)}

Return ONLY valid JSON: { "clusters": [{ "observationId": "...", "action": "CREATE"|"REINFORCE"|"SUPERSEDE"|"DEPRECATE"|"IGNORE", "targetKnowledgeItemId": "..." (only if action is not CREATE/IGNORE), "reasoning": "..." }] }`;

  const response = await callClaude(prompt, { system: SYSTEM_PROMPT, maxTokens: 4096 });

  const jsonMatch = response.text.match(/\{[\s\S]*\}/);
  if (!jsonMatch) return observations.map((o) => ({ observationId: o.id, action: "CREATE" as const, reasoning: "LLM parse failure — defaulting to CREATE" }));

  const parsed = JSON.parse(jsonMatch[0]);
  if (!parsed.clusters || !Array.isArray(parsed.clusters)) {
    return observations.map((o) => ({ observationId: o.id, action: "CREATE" as const, reasoning: "LLM parse failure — defaulting to CREATE" }));
  }

  return parsed.clusters.map((c: any) => ({
    observationId: c.observationId,
    action: c.action || "CREATE",
    targetKnowledgeItemId: c.targetKnowledgeItemId || undefined,
    reasoning: c.reasoning || "",
  }));
}
