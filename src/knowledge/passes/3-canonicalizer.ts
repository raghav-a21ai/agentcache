import { createHash } from "crypto";
import type { Observation } from "../../storage/repository.js";

export interface CanonicalizedObservation extends Observation {
  canonicalKey: string;
}

export interface CanonicalizationResult {
  observations: CanonicalizedObservation[];
  autoReinforced: CanonicalizedObservation[];
  needsClustering: CanonicalizedObservation[];
}

const STOP_WORDS = new Set([
  "a", "an", "the", "is", "are", "was", "were", "be", "been", "being",
  "have", "has", "had", "do", "does", "did", "will", "would", "could",
  "should", "may", "might", "shall", "can", "need", "must",
  "to", "of", "in", "for", "on", "with", "at", "by", "from", "as",
  "into", "through", "during", "before", "after", "above", "below",
  "this", "that", "these", "those", "it", "its",
  "and", "but", "or", "nor", "not", "so", "yet",
  "all", "each", "every", "both", "few", "more", "most",
  "i", "we", "you", "they", "he", "she",
]);

const ANTONYM_MAP: [RegExp, string][] = [
  [/\bnever\b/g, "forbidden"],
  [/\bdon'?t\b/g, "forbidden"],
  [/\bavoid\b/g, "forbidden"],
  [/\bprohibit(ed)?\b/g, "forbidden"],
  [/\balways\b/g, "required"],
  [/\bmust\b/g, "required"],
  [/\brequire(d)?\b/g, "required"],
  [/\buse\b/g, "use"],
  [/\bprefer\b/g, "use"],
];

export function canonicalize(
  observations: Observation[],
  existingCanonicalKeys?: string[]
): CanonicalizationResult {
  const canonicalized: CanonicalizedObservation[] = observations.map((obs) => ({
    ...obs,
    canonicalKey: computeCanonicalKey(obs.content),
  }));

  const existingSet = new Set(existingCanonicalKeys || []);
  const autoReinforced: CanonicalizedObservation[] = [];
  const needsClustering: CanonicalizedObservation[] = [];

  for (const obs of canonicalized) {
    if (existingSet.has(obs.canonicalKey)) {
      autoReinforced.push(obs);
    } else {
      needsClustering.push(obs);
    }
  }

  return { observations: canonicalized, autoReinforced, needsClustering };
}

export function computeCanonicalKey(content: string): string {
  let text = content.toLowerCase().trim();

  for (const [pattern, replacement] of ANTONYM_MAP) {
    text = text.replace(pattern, replacement);
  }

  text = text.replace(/[^\w\s]/g, " ");

  const tokens = text
    .split(/\s+/)
    .filter((t) => !STOP_WORDS.has(t) && t.length > 1)
    .sort();

  return tokens.join(" ");
}

export function computeCanonicalHash(content: string): string {
  const key = computeCanonicalKey(content);
  return createHash("sha256").update(key).digest("hex").slice(0, 16);
}
