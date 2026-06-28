import { readFileSync } from "fs";
import type { TranscriptEvent } from "../transcript.js";

export function canParse(path: string): boolean {
  return path.includes("roo-cline/tasks/") && path.endsWith("api_conversation_history.json");
}

export function parse(path: string): TranscriptEvent[] {
  const content = readFileSync(path, "utf-8");
  const events: TranscriptEvent[] = [];

  try {
    const messages = JSON.parse(content);
    if (!Array.isArray(messages)) return [];

    for (const msg of messages) {
      if (msg.role === "user" && Array.isArray(msg.content)) {
        const text = msg.content
          .filter((c: any) => c.type === "text")
          .map((c: any) => c.text)
          .join("\n");
        if (text) events.push({ type: "message", role: "user", content: text });
      } else if (msg.role === "assistant" && typeof msg.content === "string") {
        events.push({ type: "message", role: "assistant", content: msg.content });
      } else if (msg.role === "assistant" && Array.isArray(msg.content)) {
        for (const block of msg.content) {
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
    }
  } catch {
    return [];
  }

  return events;
}
