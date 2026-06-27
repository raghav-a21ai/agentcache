import { randomUUID } from "crypto";
import type { KnowledgeItem } from "../../storage/repository.js";
import type { KnowledgeCluster } from "./4-clusterer.js";
import type { CanonicalizedObservation } from "./3-canonicalizer.js";
import { computeCanonicalHash } from "./3-canonicalizer.js";

export interface CompileResult {
  created: KnowledgeItem[];
  reinforced: KnowledgeItem[];
  superseded: KnowledgeItem[];
  deprecated: KnowledgeItem[];
  ignored: number;
}

function calculateConfidence(count: number): KnowledgeItem["confidence"] {
  if (count >= 7) return "high";
  if (count >= 3) return "medium";
  return "low";
}

export function compileKnowledge(
  clusters: KnowledgeCluster[],
  existingItems: KnowledgeItem[],
  observations: CanonicalizedObservation[],
  project: string,
  now: number
): CompileResult {
  const itemMap = new Map(existingItems.map((i) => [i.id, { ...i }]));
  const obsMap = new Map(observations.map((o) => [o.id, o]));

  const result: CompileResult = {
    created: [],
    reinforced: [],
    superseded: [],
    deprecated: [],
    ignored: 0,
  };

  for (const cluster of clusters) {
    const obs = obsMap.get(cluster.observationId);
    if (!obs) continue;

    switch (cluster.action) {
      case "CREATE": {
        const newItem: KnowledgeItem = {
          id: `ki_${randomUUID().slice(0, 8)}`,
          canonicalHash: computeCanonicalHash(obs.content),
          type: obs.type,
          title: obs.content.slice(0, 80),
          content: obs.content,
          confidence: "low",
          observationCount: 1,
          authority: "AUTO",
          status: "active",
          supersededById: undefined,
          enforce: false,
          project,
          scope: (obs as any).scope || ((obs.type === "rule" || obs.type === "lesson") ? "global" : "project"),
          createdAt: now,
          updatedAt: now,
          lastSeenAt: now,
          metadata: {},
        };
        result.created.push(newItem);
        break;
      }

      case "REINFORCE": {
        const target = itemMap.get(cluster.targetKnowledgeItemId!);
        if (!target) break;
        target.observationCount += 1;
        target.lastSeenAt = now;
        target.updatedAt = now;
        target.confidence = calculateConfidence(target.observationCount);
        result.reinforced.push(target);
        break;
      }

      case "SUPERSEDE": {
        const target = itemMap.get(cluster.targetKnowledgeItemId!);
        if (target) {
          const newItem: KnowledgeItem = {
            id: `ki_${randomUUID().slice(0, 8)}`,
            canonicalHash: computeCanonicalHash(obs.content),
            type: obs.type,
            title: obs.content.slice(0, 80),
            content: obs.content,
            confidence: "low",
            observationCount: 1,
            authority: "AUTO",
            status: "active",
            supersededById: undefined,
            enforce: false,
            project,
            scope: (obs as any).scope || ((obs.type === "rule" || obs.type === "lesson") ? "global" : "project"),
            createdAt: now,
            updatedAt: now,
            lastSeenAt: now,
            metadata: {},
          };
          target.status = "superseded";
          target.updatedAt = now;
          target.supersededById = newItem.id;
          result.superseded.push(target);
          result.created.push(newItem);
        }
        break;
      }

      case "DEPRECATE": {
        const target = itemMap.get(cluster.targetKnowledgeItemId!);
        if (target) {
          target.status = "deprecated";
          target.updatedAt = now;
          result.deprecated.push(target);
        }
        break;
      }

      case "IGNORE":
        result.ignored += 1;
        break;
    }
  }

  return result;
}
