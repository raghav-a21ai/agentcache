import { mkdirSync } from "fs";
import { getGlobalLoopDir, getDbPath } from "./utils/paths.js";
import { SqliteKnowledgeRepository } from "./storage/sqlite.js";
import { detectInstalledIdes } from "./utils/ide-detector.js";
import { registerMcpServer, registerClaudeHooks } from "./utils/ide-registrar.js";

export async function runSetup(): Promise<void> {
  mkdirSync(getGlobalLoopDir(), { recursive: true });
  const repo = new SqliteKnowledgeRepository(getDbPath());
  repo.close();

  const ides = detectInstalledIdes();
  const detected = ides.filter((i) => i.detected);

  console.log(`\nLoop setup complete.`);
  console.log(`  Central DB: ${getDbPath()}\n`);

  if (detected.length === 0) {
    console.log(`  No IDEs detected. MCP server can still be used manually: loop-eng serve\n`);
    return;
  }

  console.log(`IDEs:`);
  for (const ide of detected) {
    const registered = registerMcpServer(ide);
    console.log(`  ${ide.name}: ${registered ? "MCP registered" : "already registered"}`);
  }

  const hooksRegistered = registerClaudeHooks();
  if (hooksRegistered) {
    console.log(`\n  Claude Code hooks: registered (Stop, SessionStart, PreToolUse)`);
  }

  console.log(`\nDone. Loop compiles knowledge across all sessions and IDEs.`);
}
