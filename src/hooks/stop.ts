import { appendFileSync, mkdirSync } from "fs";
import { dirname } from "path";
import { findProjectRoot, getPendingQueuePath, isLoopInitialized } from "../utils/paths.js";
import { findLatestTranscript } from "../utils/transcript.js";

export async function handleStop(): Promise<void> {
  const projectRoot = findProjectRoot();
  if (!isLoopInitialized(projectRoot)) return;

  const transcriptPath = findLatestTranscript();
  if (!transcriptPath) return;

  const queuePath = getPendingQueuePath(projectRoot);
  mkdirSync(dirname(queuePath), { recursive: true });

  const entry = JSON.stringify({
    transcriptPath,
    queuedAt: Date.now(),
    project: projectRoot.split("/").pop() || "unknown",
  });

  appendFileSync(queuePath, entry + "\n", "utf-8");
}
