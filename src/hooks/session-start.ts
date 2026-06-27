import { writeFileSync, mkdirSync } from "fs";
import { dirname } from "path";
import { findProjectRoot, getDbPath, getInjectedContextPath, isLoopInitialized } from "../utils/paths.js";
import { SqliteKnowledgeRepository } from "../storage/sqlite.js";
import { renderContext } from "../renderer/renderer.js";

export async function handleSessionStart(): Promise<void> {
  const projectRoot = findProjectRoot();
  if (!isLoopInitialized(projectRoot)) return;

  const dbPath = getDbPath(projectRoot);
  const repo = new SqliteKnowledgeRepository(dbPath);

  try {
    const project = projectRoot.split("/").pop() || "unknown";
    const items = repo.getKnowledgeItems(project, { status: "active" });
    const rendered = await renderContext(items, projectRoot);
    const outPath = getInjectedContextPath(projectRoot);
    mkdirSync(dirname(outPath), { recursive: true });
    writeFileSync(outPath, rendered, "utf-8");
  } finally {
    repo.close();
  }
}
