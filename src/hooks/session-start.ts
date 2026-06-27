import { writeFileSync, readFileSync, existsSync, unlinkSync, mkdirSync } from "fs";
import { dirname } from "path";
import { randomUUID } from "crypto";
import {
  findProjectRoot,
  getDbPath,
  getInjectedContextPath,
  getPendingQueuePath,
  isLoopInitialized,
} from "../utils/paths.js";
import { parseTranscript } from "../utils/transcript.js";
import { SqliteKnowledgeRepository } from "../storage/sqlite.js";
import { runCompiler } from "../knowledge/compiler.js";
import { renderContext } from "../renderer/renderer.js";

interface PendingEntry {
  transcriptPath: string;
  queuedAt: number;
  project: string;
}

export async function handleSessionStart(): Promise<void> {
  const projectRoot = findProjectRoot();
  if (!isLoopInitialized(projectRoot)) return;

  const dbPath = getDbPath(projectRoot);
  const repo = new SqliteKnowledgeRepository(dbPath);

  try {
    const project = projectRoot.split("/").pop() || "unknown";

    await compilePending(repo, project, projectRoot);

    const items = repo.getKnowledgeItems(project, { status: "active" });
    const rendered = await renderContext(items, projectRoot);
    const outPath = getInjectedContextPath(projectRoot);
    mkdirSync(dirname(outPath), { recursive: true });
    writeFileSync(outPath, rendered, "utf-8");
  } finally {
    repo.close();
  }
}

async function compilePending(
  repo: SqliteKnowledgeRepository,
  project: string,
  projectRoot: string
): Promise<void> {
  const queuePath = getPendingQueuePath(projectRoot);
  if (!existsSync(queuePath)) return;

  const raw = readFileSync(queuePath, "utf-8");
  const entries: PendingEntry[] = raw
    .split("\n")
    .filter(Boolean)
    .map((line) => {
      try { return JSON.parse(line); } catch { return null; }
    })
    .filter(Boolean);

  if (entries.length === 0) {
    unlinkSync(queuePath);
    return;
  }

  // Deduplicate by transcript path
  const seen = new Set<string>();
  const unique = entries.filter((e) => {
    if (seen.has(e.transcriptPath)) return false;
    seen.add(e.transcriptPath);
    return true;
  });

  for (const entry of unique) {
    try {
      if (!existsSync(entry.transcriptPath)) continue;

      const events = parseTranscript(entry.transcriptPath);
      if (events.length === 0) continue;

      const sessionId = `sess_${randomUUID().slice(0, 8)}`;

      const { diagnostics } = await runCompiler({
        repo,
        events,
        sessionId,
        project,
        projectRoot,
      });

      console.error(diagnostics.toString());
    } catch (err) {
      console.error(`Loop: failed to compile ${entry.transcriptPath}: ${err}`);
    }
  }

  unlinkSync(queuePath);
}
