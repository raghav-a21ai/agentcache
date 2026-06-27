import { findProjectRoot, getDbPath, isLoopInitialized } from "../utils/paths.js";
import { SqliteKnowledgeRepository } from "../storage/sqlite.js";
import { evaluatePolicy } from "../policy/engine.js";

export interface PreToolUseInput {
  tool_name: string;
  tool_input: Record<string, unknown>;
}

export interface PreToolUseOutput {
  decision?: "block";
  reason?: string;
}

export function handlePreToolUse(input: PreToolUseInput): PreToolUseOutput {
  const projectRoot = findProjectRoot();
  if (!isLoopInitialized(projectRoot)) return {};

  const dbPath = getDbPath(projectRoot);
  const repo = new SqliteKnowledgeRepository(dbPath);

  try {
    const project = projectRoot.split("/").pop() || "unknown";
    return evaluatePolicy(repo, project, input.tool_name, input.tool_input);
  } finally {
    repo.close();
  }
}
