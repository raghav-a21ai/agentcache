import { mkdirSync } from "fs";
import { getDataDir, getDbPath, migrateFromLegacy } from "./utils/paths.js";
import { SqliteKnowledgeRepository } from "./storage/sqlite.js";
import { detectInstalledIdes } from "./utils/ide-detector.js";
import { registerMcpServer, registerClaudeHooks } from "./utils/ide-registrar.js";

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

  registerClaudeHooks();

  if (registered.length > 0) {
    console.error(`agentcache: registered with ${registered.join(", ")}`);
  }
  console.error("agentcache: ready. Knowledge compiles automatically across all sessions.");
} catch (err: any) {
  console.error(`agentcache postinstall: ${err.message}. Run 'agentcache setup' manually.`);
}
