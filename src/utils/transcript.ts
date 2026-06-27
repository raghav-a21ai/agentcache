import { readdirSync, statSync, existsSync } from "fs";
import { join } from "path";
import { getClaudeTranscriptsDir, getContinueSessionsDir } from "./paths.js";
import { parseTranscriptAuto } from "./transcript-parsers/index.js";

export interface TranscriptEvent {
  type: string;
  role?: string;
  content?: string;
  tool_name?: string;
  tool_input?: Record<string, unknown>;
}

export function parseTranscript(path: string): TranscriptEvent[] {
  return parseTranscriptAuto(path);
}

export function findLatestTranscript(): string | null {
  const baseDir = getClaudeTranscriptsDir();
  if (!existsSync(baseDir)) return null;

  let latest: { path: string; mtime: number } | null = null;

  try {
    const dirs = readdirSync(baseDir)
      .map((d) => join(baseDir, d))
      .filter((d) => statSync(d).isDirectory());

    for (const dir of dirs) {
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
  } catch {
    return null;
  }

  return latest?.path ?? null;
}

export function findAllClaudeTranscripts(): string[] {
  const baseDir = getClaudeTranscriptsDir();
  if (!existsSync(baseDir)) return [];

  const transcripts: string[] = [];
  try {
    const dirs = readdirSync(baseDir)
      .map((d) => join(baseDir, d))
      .filter((d) => statSync(d).isDirectory());

    for (const dir of dirs) {
      try {
        const files = readdirSync(dir).filter((f) => f.endsWith(".jsonl"));
        for (const file of files) {
          const fullPath = join(dir, file);
          if (statSync(fullPath).size > 100) {
            transcripts.push(fullPath);
          }
        }
      } catch {
        continue;
      }
    }
  } catch {}

  return transcripts;
}

export function findAllContinueTranscripts(): string[] {
  const dir = getContinueSessionsDir();
  if (!existsSync(dir)) return [];

  try {
    return readdirSync(dir)
      .filter((f) => f.endsWith(".json") && f !== "sessions.json")
      .map((f) => join(dir, f))
      .filter((f) => statSync(f).size > 100);
  } catch {
    return [];
  }
}
