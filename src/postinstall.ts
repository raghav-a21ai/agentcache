import { mkdirSync } from "fs";
import { getGlobalLoopDir, getDbPath } from "./utils/paths.js";
import { SqliteKnowledgeRepository } from "./storage/sqlite.js";
import { detectInstalledIdes } from "./utils/ide-detector.js";
import { registerMcpServer, registerClaudeHooks } from "./utils/ide-registrar.js";

if (process.env.CI) {
  process.exit(0);
}

try {
  mkdirSync(getGlobalLoopDir(), { recursive: true });
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
    console.error(`Loop: registered with ${registered.join(", ")}`);
  }
  console.error("Loop: ready. Knowledge compiles automatically across all sessions.");
} catch (err: any) {
  console.error(`Loop postinstall: ${err.message}. Run 'loop-eng setup' manually.`);
}
