import { readFileSync, readdirSync, statSync } from "fs";
import { join } from "path";
import { homedir } from "os";

export interface TranscriptEvent {
  type: string;
  role?: string;
  content?: string;
  tool_name?: string;
  tool_input?: Record<string, unknown>;
}

export function getTranscriptsDir(): string {
  return join(homedir(), ".claude", "projects");
}

export function findLatestTranscript(projectHash?: string): string | null {
  const baseDir = getTranscriptsDir();

  let searchDirs: string[];
  if (projectHash) {
    const dir = join(baseDir, projectHash);
    searchDirs = [dir];
  } else {
    try {
      searchDirs = readdirSync(baseDir)
        .map((d) => join(baseDir, d))
        .filter((d) => statSync(d).isDirectory());
    } catch {
      return null;
    }
  }

  let latest: { path: string; mtime: number } | null = null;

  for (const dir of searchDirs) {
    try {
      const files = readdirSync(dir).filter((f) => f.endsWith(".jsonl"));
      for (const file of files) {
        const fullPath = join(dir, file);
        const mtime = statSync(fullPath).mtimeMs;
        if (!latest || mtime > latest.mtime) {
          latest = { path: fullPath, mtime };
        }
      }
    } catch {
      continue;
    }
  }

  return latest?.path ?? null;
}

export function parseTranscript(path: string): TranscriptEvent[] {
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
