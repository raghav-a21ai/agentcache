import { statSync } from "fs";
import { basename, dirname } from "path";
import { getDbPath, isInitialized, getProjectId } from "../utils/paths.js";
import { findAllClaudeTranscripts, findAllContinueTranscripts } from "../utils/transcript.js";
import { SqliteKnowledgeRepository } from "../storage/sqlite.js";
import { randomUUID } from "crypto";

function inferProjectRootFromTranscriptPath(path: string): string {
  // Claude transcripts: ~/.claude/projects/<slug>/<id>.jsonl
  // The slug is a mangled version of the project path (e.g. "-Users-raghav-project")
  const dir = dirname(path);
  const slug = basename(dir);
  if (slug.startsWith("-")) {
    return slug.replace(/-/g, "/");
  }
  return dir;
}

export async function handleSessionStart(): Promise<void> {
  if (!isInitialized()) return;

  const repo = new SqliteKnowledgeRepository(getDbPath());
  const compiledPaths = new Set(repo.getAllCompiledTranscriptPaths());

  const allTranscripts = [
    ...findAllClaudeTranscripts(),
    ...findAllContinueTranscripts(),
  ];

  const oneMinuteAgo = Date.now() - 60000;
  const uncompiled = allTranscripts.filter((path) => {
    if (compiledPaths.has(path)) return false;
    try {
      return statSync(path).mtimeMs < oneMinuteAgo;
    } catch {
      return false;
    }
  });

  if (uncompiled.length === 0) {
    repo.close();
    return;
  }

  for (const path of uncompiled) {
    const projectRoot = inferProjectRootFromTranscriptPath(path);
    const project = getProjectId(projectRoot);
    repo.queueTranscript({
      id: `pend_${randomUUID().slice(0, 8)}`,
      transcriptPath: path,
      project,
      projectRoot,
      provider: "discovered",
      queuedAt: Date.now(),
    });
  }

  repo.close();
}
