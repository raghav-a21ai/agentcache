#!/usr/bin/env node
import { Command } from "commander";

const program = new Command();

program
  .name("agentcache")
  .description("Engineering Knowledge Compiler — universal, zero-config")
  .version("0.3.1");

program
  .command("setup")
  .description("Detect IDEs and register AgentCache (runs automatically on install)")
  .action(async () => {
    const { runSetup } = await import("./setup.js");
    await runSetup();
  });

program
  .command("serve")
  .description("Start AgentCache MCP server (spawned by IDEs automatically)")
  .action(async () => {
    const { startMcpServer } = await import("./mcp.js");
    await startMcpServer();
  });

program
  .command("compile-session")
  .description("Stop hook: queue transcript for compilation")
  .action(async () => {
    try {
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
    } catch (err: any) {
      process.stderr.write(`agentcache compile-session: ${err.message}\n`);
    }
  });

program
  .command("discover")
  .description("SessionStart hook: discover uncompiled transcripts")
  .action(async () => {
    try {
      const { handleSessionStart } = await import("./hooks/session-start.js");
      await handleSessionStart();
    } catch (err: any) {
      process.stderr.write(`agentcache discover: ${err.message}\n`);
    }
  });

program
  .command("enforce")
  .description("PreToolUse hook: policy enforcement")
  .action(async () => {
    let data = "";
    for await (const chunk of process.stdin) {
      data += chunk;
    }
    try {
      const { handlePreToolUse } = await import("./hooks/pre-tool-use.js");
      const input = JSON.parse(data);
      const result = handlePreToolUse(input);
      process.stdout.write(JSON.stringify(result));
    } catch (err: any) {
      process.stderr.write(`agentcache enforce: ${err.message}\n`);
      process.stdout.write("{}");
    }
  });

program
  .command("review")
  .description("Review quarantined observations — approve or reject before they're injected")
  .option("--approve-all", "Approve all pending items")
  .option("--reject-all", "Reject (archive) all pending items")
  .action(async (opts) => {
    const { getDbPath, isInitialized, findProjectRoot, getProjectId } = await import("./utils/paths.js");
    if (!isInitialized()) {
      console.log("AgentCache not initialized. Run: agentcache setup");
      return;
    }
    const { SqliteKnowledgeRepository } = await import("./storage/sqlite.js");
    const repo = new SqliteKnowledgeRepository(getDbPath());
    const project = getProjectId(findProjectRoot());
    const items = repo.getQuarantinedItems(project);

    if (items.length === 0) {
      console.log("No quarantined items. All observations are either approved or auto-promoted.");
      repo.close();
      return;
    }

    if (opts.approveAll) {
      for (const item of items) {
        repo.promoteItem(item.id);
      }
      console.log(`Approved ${items.length} items. They will now be injected into future sessions.`);
      repo.close();
      return;
    }

    if (opts.rejectAll) {
      for (const item of items) {
        repo.updateKnowledgeItem(item.id, { status: "archived", updatedAt: Date.now() });
      }
      console.log(`Rejected ${items.length} items. They will not be injected.`);
      repo.close();
      return;
    }

    console.log(`${items.length} quarantined observation(s):\n`);
    for (const item of items) {
      const age = Math.round((Date.now() - item.createdAt) / (1000 * 60 * 60));
      console.log(`  [${item.id}] (${item.type}/${item.scope}) ${age}h ago`);
      console.log(`    ${item.content.slice(0, 120)}`);
      console.log("");
    }
    console.log("Actions:");
    console.log("  agentcache review --approve-all    Approve all and inject into sessions");
    console.log("  agentcache review --reject-all     Archive all (won't be injected)");
    console.log("  agentcache promote <id>            Approve a specific item");
    repo.close();
  });

program
  .command("promote <id>")
  .description("Promote a specific quarantined item to approved (USER authority)")
  .action(async (id) => {
    const { getDbPath, isInitialized } = await import("./utils/paths.js");
    if (!isInitialized()) {
      console.log("AgentCache not initialized. Run: agentcache setup");
      return;
    }
    const { SqliteKnowledgeRepository } = await import("./storage/sqlite.js");
    const repo = new SqliteKnowledgeRepository(getDbPath());
    const item = repo.getKnowledgeItem(id);
    if (!item) {
      console.log(`Item not found: ${id}`);
      repo.close();
      return;
    }
    repo.promoteItem(id);
    console.log(`Promoted: ${item.content.slice(0, 80)}`);
    repo.close();
  });

program
  .command("add-rule <content>")
  .description("Add an enforced policy rule (human-only, blocks tool calls that violate it)")
  .option("--global", "Apply to all projects (default: current project only)")
  .action(async (content, opts) => {
    const { getDbPath, isInitialized, findProjectRoot, getProjectId } = await import("./utils/paths.js");
    const { randomUUID } = await import("crypto");
    if (!isInitialized()) {
      console.log("AgentCache not initialized. Run: agentcache setup");
      return;
    }
    const { SqliteKnowledgeRepository } = await import("./storage/sqlite.js");
    const { computeCanonicalHash } = await import("./knowledge/passes/3-canonicalizer.js");
    const repo = new SqliteKnowledgeRepository(getDbPath());
    const project = getProjectId(findProjectRoot());
    const scope = opts.global ? "global" : "project";

    repo.saveKnowledgeItem({
      id: `ki_${randomUUID().slice(0, 8)}`,
      canonicalHash: computeCanonicalHash(content),
      type: "rule",
      title: content.slice(0, 80),
      content,
      confidence: "high",
      observationCount: 1,
      authority: "USER",
      status: "active",
      enforce: true,
      project,
      scope,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      lastSeenAt: Date.now(),
      metadata: { source: "cli" },
    });

    console.log(`Enforced rule added (${scope}): ${content}`);
    repo.close();
  });

program
  .command("doctor")
  .description("Diagnose AgentCache installation and report problems")
  .action(async () => {
    const { existsSync, readFileSync } = await import("fs");
    const { join } = await import("path");
    const { homedir } = await import("os");
    const { spawnSync } = await import("child_process");
    const { getDataDir, getDbPath, isInitialized } = await import("./utils/paths.js");

    let ok = 0;
    let warn = 0;
    let fail = 0;

    function pass(msg: string) { console.log(`  ✓ ${msg}`); ok++; }
    function warning(msg: string) { console.log(`  ⚠ ${msg}`); warn++; }
    function error(msg: string) { console.log(`  ✗ ${msg}`); fail++; }

    console.log("AgentCache Doctor\n");

    // 1. Data directory
    console.log("Storage:");
    const dataDir = getDataDir();
    if (existsSync(dataDir)) {
      pass(`Data directory exists: ${dataDir}`);
    } else {
      error(`Data directory missing: ${dataDir}`);
    }

    // 2. SQLite
    const dbPath = getDbPath();
    if (existsSync(dbPath)) {
      try {
        const { SqliteKnowledgeRepository } = await import("./storage/sqlite.js");
        const repo = new SqliteKnowledgeRepository(dbPath);
        repo.close();
        pass(`Database accessible: ${dbPath}`);
      } catch (err: any) {
        if (err.message?.includes("NODE_MODULE_VERSION") || err.message?.includes("was compiled against")) {
          error(`Native module ABI mismatch — run: npm rebuild better-sqlite3 -g`);
        } else {
          error(`Database broken: ${err.message}`);
        }
      }
    } else if (isInitialized()) {
      warning("Database file missing but data directory exists");
    } else {
      warning("Not initialized yet — run: agentcache setup");
    }

    // 3. IDE registrations
    console.log("\nIDE registrations:");
    const claudeJson = join(homedir(), ".claude.json");
    if (existsSync(claudeJson)) {
      try {
        const config = JSON.parse(readFileSync(claudeJson, "utf-8"));
        if (config.mcpServers?.agentcache) {
          pass("Claude Code: registered");
        } else {
          warning("Claude Code: ~/.claude.json exists but no agentcache server");
        }
      } catch {
        warning("Claude Code: ~/.claude.json unreadable");
      }
    } else {
      warning("Claude Code: not registered");
    }

    const settingsPath = join(homedir(), ".claude", "settings.json");
    if (existsSync(settingsPath)) {
      try {
        const settings = JSON.parse(readFileSync(settingsPath, "utf-8"));
        const perms = settings.permissions?.allow || [];
        if (perms.some((p: string) => p.includes("agentcache"))) {
          pass("Claude Code permissions: auto-approved");
        } else {
          warning("Claude Code permissions: not in allow list");
        }
        if (settings.hooks?.Stop?.some((h: any) => JSON.stringify(h).includes("agentcache"))) {
          pass("Claude Code hooks: registered");
        } else {
          warning("Claude Code hooks: not registered");
        }
      } catch {
        warning("Claude Code settings: unreadable");
      }
    }

    // 4. LLM backends
    console.log("\nLLM backends (for compile-all):");
    const backends = ["claude", "codex", "gemini", "copilot", "aider", "goose"];
    const found: string[] = [];
    for (const cmd of backends) {
      try {
        if (spawnSync("which", [cmd], { encoding: "utf-8", timeout: 3000 }).status === 0) {
          found.push(cmd);
        }
      } catch {}
    }
    if (process.env.ANTHROPIC_API_KEY) found.push("Anthropic API (env)");
    if (process.env.OPENAI_API_KEY) found.push("OpenAI API (env)");

    if (found.length > 0) {
      pass(`Available: ${found.join(", ")}`);
    } else {
      warning("No LLM backend found — compile-all won't work");
    }

    // 5. Node version
    console.log("\nRuntime:");
    const nodeVersion = process.version;
    const major = parseInt(nodeVersion.slice(1));
    if (major >= 20) {
      pass(`Node ${nodeVersion}`);
    } else {
      error(`Node ${nodeVersion} — requires >=20.12.0`);
    }

    // Summary
    console.log(`\n${ok} passed, ${warn} warnings, ${fail} errors`);
    if (fail > 0) process.exit(1);
  });

program
  .command("compile-all")
  .description("Batch-compile all unprocessed transcripts using an available LLM CLI")
  .action(async () => {
    const { runCompileAll } = await import("./compile-all.js");
    await runCompileAll();
  });

program
  .command("status")
  .description("Show AgentCache knowledge stats")
  .action(async () => {
    const { getDbPath, isInitialized, findProjectRoot, getProjectId, getProjectDisplayName } = await import("./utils/paths.js");
    if (!isInitialized()) {
      console.log("AgentCache not initialized. Run: agentcache setup");
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

    console.log(`AgentCache — ${displayName} (${project})`);
    console.log(`  ${items.length} items (${globalItems.length} global, ${projectItems.length} project)`);
    console.log(`  ${rules.length} rules | ${lessons.length} lessons | ${decisions.length} decisions | ${context.length} context`);
    if (pending > 0) console.log(`  ${pending} sessions pending compilation`);

    const allProjects = repo.getProjectStats();
    if (allProjects.length > 1) {
      console.log("");
      console.log("All projects:");
      for (const p of allProjects) {
        const marker = p.project === project ? " ← current" : "";
        console.log(`  ${p.project}: ${p.count} items${marker}`);
      }
    }

    repo.close();
  });

program.parse();
