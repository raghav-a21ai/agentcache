import { readFileSync } from "fs";
import type { TranscriptEvent } from "../transcript.js";

export function canParse(path: string): boolean {
  return path.endsWith(".jsonl");
}

export function parse(path: string): TranscriptEvent[] {
  const content = readFileSync(path, "utf-8");
  const events: TranscriptEvent[] = [];

  for (const line of content.split("\n")) {
    if (!line.trim()) continue;
    try {
      const obj = JSON.parse(line);

      if (obj.type === "user" && obj.message?.content) {
        events.push({
          type: "message",
          role: "user",
          content:
            typeof obj.message.content === "string"
              ? obj.message.content
              : JSON.stringify(obj.message.content),
        });
      } else if (obj.type === "assistant" && obj.message?.content) {
        const blocks = Array.isArray(obj.message.content)
          ? obj.message.content
          : [{ type: "text", text: obj.message.content }];

        for (const block of blocks) {
          if (block.type === "text" && block.text) {
            events.push({ type: "message", role: "assistant", content: block.text });
          } else if (block.type === "tool_use") {
            events.push({
              type: "tool_use",
              tool_name: block.name,
              tool_input: block.input,
            });
          }
        }
      }
    } catch {
      continue;
    }
  }

  return events;
}
