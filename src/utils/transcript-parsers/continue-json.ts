import { readFileSync } from "fs";
import type { TranscriptEvent } from "../transcript.js";

export function canParse(path: string): boolean {
  if (!path.endsWith(".json")) return false;
  try {
    const content = readFileSync(path, "utf-8");
    const parsed = JSON.parse(content);
    return parsed.history && Array.isArray(parsed.history);
  } catch {
    return false;
  }
}

export function parse(path: string): TranscriptEvent[] {
  const content = readFileSync(path, "utf-8");
  const session = JSON.parse(content);
  const events: TranscriptEvent[] = [];

  if (!session.history || !Array.isArray(session.history)) return events;

  for (const entry of session.history) {
    const msg = entry.message;
    if (!msg) continue;

    const role = msg.role === "user" ? "user" : msg.role === "assistant" ? "assistant" : null;
    if (!role) continue;

    let text = "";
    if (typeof msg.content === "string") {
      text = msg.content;
    } else if (Array.isArray(msg.content)) {
      text = msg.content
        .filter((b: any) => b.type === "text" && b.text)
        .map((b: any) => b.text)
        .join("\n");
    }

    if (text) {
      events.push({ type: "message", role, content: text });
    }
  }

  return events;
}
