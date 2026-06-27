import type { Observation } from "../../storage/repository.js";

const FILLER_PATTERNS = [
  /^i (noticed|realized|learned|found|discovered|think) that /i,
  /^it (seems|appears|looks) (like|that) /i,
  /^we should /i,
  /^you should /i,
  /^basically,? /i,
  /^essentially,? /i,
  /^actually,? /i,
];

const IMPERATIVE_RULES: [RegExp, string][] = [
  [/^you should never /i, "Never "],
  [/^we should never /i, "Never "],
  [/^don't ever /i, "Never "],
  [/^never /i, "Never "],
  [/^you should always /i, "Always "],
  [/^we should always /i, "Always "],
  [/^always /i, "Always "],
];

export function normalize(observations: Observation[]): Observation[] {
  const normalized = observations.map((obs) => ({
    ...obs,
    content: normalizeContent(obs.content, obs.type),
  }));

  const seen = new Set<string>();
  return normalized.filter((obs) => {
    const key = obs.content.toLowerCase().trim();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function normalizeContent(content: string, type: string): string {
  let text = content.trim();

  for (const pattern of FILLER_PATTERNS) {
    text = text.replace(pattern, "");
  }

  if (type === "rule") {
    for (const [pattern, replacement] of IMPERATIVE_RULES) {
      if (pattern.test(text)) {
        text = text.replace(pattern, replacement);
        break;
      }
    }
  }

  text = text.charAt(0).toUpperCase() + text.slice(1);

  const firstSentenceEnd = text.search(/\. [A-Z]/);
  if (firstSentenceEnd > 0) {
    text = text.slice(0, firstSentenceEnd + 1);
  }

  return text;
}
