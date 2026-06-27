#!/usr/bin/env node
import { Command } from "commander";
import { handleStop } from "./hooks/stop.js";
import { handleSessionStart } from "./hooks/session-start.js";
import { handlePreToolUse } from "./hooks/pre-tool-use.js";
import { initProject, setApiKey } from "./init.js";

const program = new Command();

program
  .name("loop")
  .description("Engineering Knowledge Compiler")
  .version("0.1.0");

program
  .command("init")
  .description("Initialize Loop in the current project")
  .option("--cursor", "Also configure Cursor MCP")
  .option("--api-key <key>", "Anthropic API key (stored in ~/.loop/config.json)")
  .action(async (opts) => {
    await initProject(opts);
  });

program
  .command("config")
  .description("Set Loop configuration")
  .option("--api-key <key>", "Set Anthropic API key")
  .action((opts) => {
    if (opts.apiKey) {
      setApiKey(opts.apiKey);
      console.log("API key saved to ~/.loop/config.json");
    } else {
      console.log("Usage: loop config --api-key <your-anthropic-api-key>");
    }
  });

program
  .command("compile")
  .description("Run the knowledge compiler (immediate, no queue)")
  .option("--from-scratch", "Rebuild all knowledge from observations")
  .option("--dry-run", "Print what would happen without writing")
  .action(async () => {
    const { findProjectRoot, getDbPath, isLoopInitialized } = await import("./utils/paths.js");
    const { findLatestTranscript, parseTranscript } = await import("./utils/transcript.js");
    const { SqliteKnowledgeRepository } = await import("./storage/sqlite.js");
    const { runCompiler } = await import("./knowledge/compiler.js");
    const { randomUUID } = await import("crypto");

    const projectRoot = findProjectRoot();
    if (!isLoopInitialized(projectRoot)) {
      console.error("Loop not initialized. Run: loop init");
      process.exit(1);
    }

    const transcriptPath = findLatestTranscript();
    if (!transcriptPath) {
      console.error("No transcript found.");
      process.exit(1);
    }

    const events = parseTranscript(transcriptPath);
    if (events.length === 0) {
      console.error("Empty transcript.");
      process.exit(1);
    }

    const repo = new SqliteKnowledgeRepository(getDbPath(projectRoot));
    try {
      const project = projectRoot.split("/").pop() || "unknown";
      const sessionId = `sess_${randomUUID().slice(0, 8)}`;
      const { diagnostics } = await runCompiler({ repo, events, sessionId, project, projectRoot });
      console.error(diagnostics.toString());
    } finally {
      repo.close();
    }
  });

program
  .command("inject")
  .description("Render context for the upcoming session")
  .action(async () => {
    await handleSessionStart();
  });

program
  .command("enforce")
  .description("Evaluate a PreToolUse event from stdin")
  .action(async () => {
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
  .command("review")
  .argument("[what]", "What to review: contradictions")
  .description("Review contradictions or pending items")
  .action(async (what) => {
    if (what === "contradictions") {
      const { findProjectRoot, getDbPath } = await import("./utils/paths.js");
      const { SqliteKnowledgeRepository } = await import("./storage/sqlite.js");
      const root = findProjectRoot();
      const repo = new SqliteKnowledgeRepository(getDbPath(root));
      const project = root.split("/").pop() || "unknown";
      const contradictions = repo.getUnresolvedContradictions(project);
      if (contradictions.length === 0) {
        console.log("No unresolved contradictions.");
      } else {
        for (const c of contradictions) {
          console.log(`\n[${c.id}] Topic: ${c.topic}`);
          console.log(`  ${c.description}`);
          console.log(`  Recommendation: ${c.recommendation}`);
        }
      }
      repo.close();
    }
  });

program
  .command("serve")
  .description("Start Loop MCP server (for Cursor, Windsurf, Copilot)")
  .action(async () => {
    const { startMcpServer } = await import("./mcp.js");
    await startMcpServer();
  });

program.parse();
