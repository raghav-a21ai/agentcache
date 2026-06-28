import { readFileSync } from "fs";
import type { TranscriptEvent } from "../transcript.js";

export function canParse(path: string): boolean {
  if (!path.endsWith(".jsonl")) return false;
  return path.includes(".codex/sessions/");
}

export function parse(path: string): TranscriptEvent[] {
  const content = readFileSync(path, "utf-8");
  const events: TranscriptEvent[] = [];

  for (const line of content.split("\n")) {
    if (!line.trim()) continue;
    try {
      const obj = JSON.parse(line);

      if (obj.type === "response_item" && obj.payload) {
        const p = obj.payload;
        if (p.role === "developer" && Array.isArray(p.content)) {
          const text = p.content
            .filter((c: any) => c.type === "input_text")
            .map((c: any) => c.text)
            .join("\n");
          if (text) events.push({ type: "message", role: "user", content: text });
        } else if (p.role === "assistant" && Array.isArray(p.content)) {
          for (const block of p.content) {
            if (block.type === "output_text" && block.text) {
              events.push({ type: "message", role: "assistant", content: block.text });
            } else if (block.type === "function_call") {
              events.push({
                type: "tool_use",
                tool_name: block.name,
                tool_input: { arguments: block.arguments },
              });
            }
          }
        }
      }
    } catch {
      continue;
    }
  }

  return events;
}
