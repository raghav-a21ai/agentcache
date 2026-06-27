import type { KnowledgeItem } from "../../storage/repository.js";
import type { CanonicalizedObservation } from "./3-canonicalizer.js";

export const CLUSTER_PROMPT_VERSION = "cluster-v1";

export interface KnowledgeCluster {
  observationId: string;
  action: "CREATE" | "REINFORCE" | "SUPERSEDE" | "DEPRECATE" | "IGNORE";
  targetKnowledgeItemId?: string;
  reasoning: string;
}

export function buildClusteringPrompt(
  observations: CanonicalizedObservation[],
  existingItems: KnowledgeItem[]
): string {
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

  return `You are a knowledge clustering engine. Determine whether new observations create new knowledge or relate to existing items. Be conservative.

For each observation, assign an action:
CREATE    — genuinely new knowledge, no existing item covers it
REINFORCE — confirms an existing item (provide targetKnowledgeItemId)
SUPERSEDE — replaces/corrects an existing item (provide targetKnowledgeItemId)
DEPRECATE — makes an existing item irrelevant (provide targetKnowledgeItemId)
IGNORE    — duplicate, trivial, or too vague to keep

New observations:
${JSON.stringify(obsJson, null, 2)}

Existing knowledge items:
${JSON.stringify(itemsJson, null, 2)}

Return ONLY valid JSON: { "clusters": [{ "observationId": "...", "action": "CREATE"|"REINFORCE"|"SUPERSEDE"|"DEPRECATE"|"IGNORE", "targetKnowledgeItemId": "..." (only if action targets an existing item), "reasoning": "..." }] }`;
}

export function parseClusteringResponse(
  text: string,
  observations: CanonicalizedObservation[]
): KnowledgeCluster[] {
  const jsonMatch = text.match(/\{[\s\S]*\}/);
  if (!jsonMatch) {
    return observations.map((o) => ({ observationId: o.id, action: "CREATE" as const, reasoning: "Parse failure — defaulting to CREATE" }));
  }

  const parsed = JSON.parse(jsonMatch[0]);
  if (!parsed.clusters || !Array.isArray(parsed.clusters)) {
    return observations.map((o) => ({ observationId: o.id, action: "CREATE" as const, reasoning: "Parse failure — defaulting to CREATE" }));
  }

  return parsed.clusters.map((c: any) => ({
    observationId: c.observationId,
    action: c.action || "CREATE",
    targetKnowledgeItemId: c.targetKnowledgeItemId || undefined,
    reasoning: c.reasoning || "",
  }));
}
