import type { KnowledgeItem, ContradictionReport } from "../../storage/repository.js";
import type { KnowledgeCluster } from "./4-clusterer.js";
import { randomUUID } from "crypto";

export const CONTRADICTION_PROMPT_VERSION = "contradiction-v1";

export function buildContradictionPrompt(
  clusters: KnowledgeCluster[],
  existingItems: KnowledgeItem[]
): string | null {
  const supersedeActions = clusters.filter((c) => c.action === "SUPERSEDE");
  if (supersedeActions.length === 0) return null;

  const relevantItemIds = new Set(supersedeActions.map((c) => c.targetKnowledgeItemId).filter(Boolean));
  const relevantItems = existingItems.filter((i) => relevantItemIds.has(i.id));
  if (relevantItems.length === 0) return null;

  return `The following knowledge items are being superseded. Identify genuine contradictions (conflicting advice) vs. natural evolution (old approach replaced by better one).

Items being superseded:
${JSON.stringify(relevantItems.map((i) => ({ id: i.id, content: i.content, type: i.type })), null, 2)}

Return ONLY valid JSON:
{ "contradictions": [{ "itemAId": "...", "itemBId": "...", "topic": "...", "description": "...", "recommendation": "keep_newer"|"keep_older"|"flag_for_user" }] }

If no genuine contradictions (just evolution), return: { "contradictions": [] }`;
}

export function parseContradictionResponse(
  text: string,
  project: string
): ContradictionReport[] {
  const jsonMatch = text.match(/\{[\s\S]*\}/);
  if (!jsonMatch) return [];

  const parsed = JSON.parse(jsonMatch[0]);
  if (!parsed.contradictions || !Array.isArray(parsed.contradictions)) return [];

  const now = Date.now();
  return parsed.contradictions.map((c: any) => ({
    id: `con_${randomUUID().slice(0, 8)}`,
    project,
    itemAId: c.itemAId,
    itemBId: c.itemBId,
    topic: c.topic || "unknown",
    description: c.description || "",
    recommendation: c.recommendation || "flag_for_user",
    resolved: false,
    createdAt: now,
  }));
}
