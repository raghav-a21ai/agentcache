import { findProjectRoot, getDbPath, isInitialized, getProjectId } from "../utils/paths.js";
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
  if (!isInitialized()) return {};

  const projectRoot = findProjectRoot();
  const repo = new SqliteKnowledgeRepository(getDbPath());

  try {
    const project = getProjectId(projectRoot);
    const enforcedRules = repo.getEnforcedRules(project);
    return evaluatePolicy(input, enforcedRules);
  } finally {
    repo.close();
  }
}
