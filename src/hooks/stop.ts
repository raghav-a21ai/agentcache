import { getDbPath, isInitialized, findProjectRoot, getProjectId } from "../utils/paths.js";
import { SqliteKnowledgeRepository } from "../storage/sqlite.js";
import { randomUUID } from "crypto";

export async function handleStop(payload?: { transcript_path?: string }): Promise<void> {
  if (!isInitialized()) return;

  const transcriptPath = payload?.transcript_path;
  if (!transcriptPath) return;

  const repo = new SqliteKnowledgeRepository(getDbPath());
  const projectRoot = findProjectRoot();
  const project = getProjectId(projectRoot);

  const compiledPaths = new Set(repo.getAllCompiledTranscriptPaths());
  if (compiledPaths.has(transcriptPath)) {
    repo.close();
    return;
  }

  repo.queueTranscript({
    id: `pend_${randomUUID().slice(0, 8)}`,
    transcriptPath,
    project,
    projectRoot,
    provider: "claude",
    queuedAt: Date.now(),
  });
  repo.close();
}
