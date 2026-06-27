#!/usr/bin/env node
import { Command } from "commander";

const program = new Command();

program
  .name("agentcache")
  .description("Engineering Knowledge Compiler — universal, zero-config")
  .version("0.3.0");

program
  .command("setup")
  .description("Detect IDEs and register Loop (runs automatically on install)")
  .action(async () => {
    const { runSetup } = await import("./setup.js");
    await runSetup();
  });

program
  .command("serve")
  .description("Start Loop MCP server (spawned by IDEs automatically)")
  .action(async () => {
    const { startMcpServer } = await import("./mcp.js");
    await startMcpServer();
  });

program
  .command("compile-session")
  .description("Stop hook: queue transcript for compilation")
  .action(async () => {
    const { handleStop } = await import("./hooks/stop.js");
    let payload: { transcript_path?: string } | undefined;
    try {
      let data = "";
      for await (const chunk of process.stdin) {
        data += chunk;
      }
      if (data.trim()) {
        payload = JSON.parse(data);
      }
    } catch {}
    await handleStop(payload);
  });

program
  .command("discover")
  .description("SessionStart hook: discover uncompiled transcripts")
  .action(async () => {
    const { handleSessionStart } = await import("./hooks/session-start.js");
    await handleSessionStart();
  });

program
  .command("enforce")
  .description("PreToolUse hook: policy enforcement")
  .action(async () => {
    const { handlePreToolUse } = await import("./hooks/pre-tool-use.js");
    let data = "";
    for await (const chunk of process.stdin) {
      data += chunk;
    }
    try {
      const input = JSON.parse(data);
      const result = handlePreToolUse(input);
      process.stdout.write(JSON.stringify(result));
    } catch {
      process.stdout.write("{}");
    }
  });

program
  .command("status")
  .description("Show Loop knowledge stats")
  .action(async () => {
    const { getDbPath, isLoopInitialized, findProjectRoot, getProjectId, getProjectDisplayName } = await import("./utils/paths.js");
    if (!isLoopInitialized()) {
      console.log("Loop not initialized. Run: agentcache setup");
      return;
    }
    const { SqliteKnowledgeRepository } = await import("./storage/sqlite.js");
    const repo = new SqliteKnowledgeRepository(getDbPath());
    const projectRoot = findProjectRoot();
    const project = getProjectId(projectRoot);
    const displayName = getProjectDisplayName(projectRoot);
    const items = repo.getKnowledgeForContext(project);
    const rules = items.filter((i) => i.type === "rule");
    const lessons = items.filter((i) => i.type === "lesson");
    const decisions = items.filter((i) => i.type === "decision");
    const context = items.filter((i) => i.type === "context");
    const globalItems = items.filter((i) => i.scope === "global");
    const projectItems = items.filter((i) => i.scope === "project");
    const pending = repo.getPendingCount();
    repo.close();

    console.log(`Loop — ${displayName} (${project})`);
    console.log(`  ${items.length} items (${globalItems.length} global, ${projectItems.length} project)`);
    console.log(`  ${rules.length} rules | ${lessons.length} lessons | ${decisions.length} decisions | ${context.length} context`);
    if (pending > 0) console.log(`  ${pending} sessions pending compilation`);
  });

program.parse();
