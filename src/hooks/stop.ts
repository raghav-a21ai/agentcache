import { findProjectRoot, getDbPath, isLoopInitialized } from "../utils/paths.js";
import { findLatestTranscript, parseTranscript } from "../utils/transcript.js";
import { SqliteKnowledgeRepository } from "../storage/sqlite.js";
import { runCompiler } from "../knowledge/compiler.js";
import { randomUUID } from "crypto";

export async function handleStop(): Promise<void> {
  const projectRoot = findProjectRoot();
  if (!isLoopInitialized(projectRoot)) return;

  const dbPath = getDbPath(projectRoot);
  const repo = new SqliteKnowledgeRepository(dbPath);

  try {
    const transcriptPath = findLatestTranscript();
    if (!transcriptPath) {
      console.error("Loop: no transcript found, skipping compile");
      return;
    }

    const events = parseTranscript(transcriptPath);
    if (events.length === 0) {
      console.error("Loop: empty transcript, skipping compile");
      return;
    }

    const sessionId = `sess_${randomUUID().slice(0, 8)}`;
    const project = projectRoot.split("/").pop() || "unknown";

    const { diagnostics } = await runCompiler({
      repo,
      events,
      sessionId,
      project,
      projectRoot,
    });

    console.error(diagnostics.toString());
  } finally {
    repo.close();
  }
}
