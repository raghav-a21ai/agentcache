import { existsSync } from "fs";
import { join } from "path";
import { homedir } from "os";
import type { TranscriptEvent } from "../transcript.js";

export function canParse(path: string): boolean {
  return path.endsWith("goose-sessions.db") || path.includes("goose/sessions/sessions.db");
}

export function getGooseDbPath(): string {
  return join(homedir(), ".local", "share", "goose", "sessions", "sessions.db");
}

export function hasGooseSessions(): boolean {
  return existsSync(getGooseDbPath());
}

export function parseSession(db: any, sessionId: string): TranscriptEvent[] {
  const events: TranscriptEvent[] = [];

  const rows = db
    .prepare("SELECT role, content_json FROM messages WHERE session_id = ? ORDER BY created_timestamp ASC")
    .all(sessionId);

  for (const row of rows) {
    try {
      const content = JSON.parse(row.content_json as string);
      if (!Array.isArray(content)) continue;

      for (const block of content) {
        if (row.role === "user" && block.type === "text" && block.text) {
          events.push({ type: "message", role: "user", content: block.text });
        } else if (row.role === "assistant" && block.type === "text" && block.text) {
          events.push({ type: "message", role: "assistant", content: block.text });
        } else if (row.role === "assistant" && block.type === "toolRequest") {
          events.push({
            type: "tool_use",
            tool_name: block.toolCall?.value?.name || "unknown",
            tool_input: block.toolCall?.value?.arguments ? { arguments: block.toolCall.value.arguments } : {},
          });
        }
      }
    } catch {
      continue;
    }
  }

  return events;
}

export function parse(_path: string): TranscriptEvent[] {
  return [];
}
