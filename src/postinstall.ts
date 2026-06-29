import { mkdirSync } from "fs";
import { join } from "path";
import { homedir } from "os";
import { spawnSync } from "child_process";
import { getDataDir, getDbPath, migrateFromLegacy } from "./utils/paths.js";
import { SqliteKnowledgeRepository } from "./storage/sqlite.js";
import { detectInstalledIdes } from "./utils/ide-detector.js";
import { registerMcpServer, registerClaudeHooks } from "./utils/ide-registrar.js";
import { spawnCompileAll } from "./utils/background-compile.js";

if (process.env.CI) {
  process.exit(0);
}

try {
  migrateFromLegacy();
  mkdirSync(getDataDir(), { recursive: true });
  const repo = new SqliteKnowledgeRepository(getDbPath());
  repo.close();

  const ides = detectInstalledIdes().filter((i) => i.detected);
  const registered: string[] = [];

  for (const ide of ides) {
    if (registerMcpServer(ide)) {
      registered.push(ide.name);
    }
  }

  mkdirSync(join(homedir(), ".claude"), { recursive: true });
  registerClaudeHooks();

  if (registered.length > 0) {
    console.log(`agentcache: registered with ${registered.join(", ")}`);
  }
  console.log("agentcache: ready. Knowledge compiles automatically across all sessions.");

  // Check for LLM backend before spawning compile-all
  const hasBackend = ["claude", "codex", "gemini", "copilot", "aider", "goose"].some((cmd) => {
    try { return spawnSync("which", [cmd], { encoding: "utf-8", timeout: 3000 }).status === 0; } catch { return false; }
  }) || process.env.ANTHROPIC_API_KEY || process.env.OPENAI_API_KEY;

  if (hasBackend) {
    const spawned = spawnCompileAll();
    if (spawned) {
      console.log("agentcache: background compilation started for existing transcripts.");
    }
  } else {
    console.log("agentcache: no LLM backend detected for batch compilation.");
    console.log("  Install one of: claude, codex, gemini, copilot, aider, goose");
    console.log("  Or set ANTHROPIC_API_KEY / OPENAI_API_KEY. Knowledge compiles via MCP in the meantime.");
  }
} catch (err: any) {
  console.log(`agentcache postinstall: ${err.message}. Run 'agentcache setup' manually.`);
}
