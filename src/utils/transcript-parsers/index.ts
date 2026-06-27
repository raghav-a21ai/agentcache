import * as claudeJsonl from "./claude-jsonl.js";
import * as continueJson from "./continue-json.js";
import type { TranscriptEvent } from "../transcript.js";

const parsers = [claudeJsonl, continueJson];

export function parseTranscriptAuto(path: string): TranscriptEvent[] {
  for (const parser of parsers) {
    if (parser.canParse(path)) return parser.parse(path);
  }
  return [];
}

export { claudeJsonl, continueJson };
