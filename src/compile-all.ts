import { execSync, spawnSync } from "child_process";
import { existsSync, writeFileSync, unlinkSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { getDbPath, isInitialized, getProjectId } from "./utils/paths.js";
import { SqliteKnowledgeRepository } from "./storage/sqlite.js";
import {
  parseTranscript,
  findAllClaudeTranscripts,
  findAllContinueTranscripts,
  findAllCodexTranscripts,
  findAllRooCodeTranscripts,
  getGooseDbPath,
} from "./utils/transcript.js";
import { startCompile, processExtraction, processClustering } from "./knowledge/compiler.js";
import { acquireLock, releaseLock } from "./utils/background-compile.js";
import { randomUUID } from "crypto";

interface LlmBackend {
  name: string;
  invoke(prompt: string): string | null;
}

function detectBackend(): LlmBackend | null {
  const backends: { cmd: string; name: string; buildInvoke: () => (prompt: string) => string | null }[] = [
    {
      cmd: "claude",
      name: "Claude Code",
      buildInvoke: () => (prompt) => {
        const result = spawnSync("claude", ["-p", "-", "--output-format", "text"], {
          input: prompt,
          encoding: "utf-8",
          timeout: 120000,
          maxBuffer: 10 * 1024 * 1024,
        });
        return result.status === 0 ? result.stdout : null;
      },
    },
    {
      cmd: "codex",
      name: "Codex",
      buildInvoke: () => (prompt) => {
        const tmpFile = join(tmpdir(), `agentcache-prompt-${Date.now()}.txt`);
        writeFileSync(tmpFile, prompt);
        const result = spawnSync("codex", ["exec", "-", "--skip-git-repo-check"], {
          input: prompt,
          encoding: "utf-8",
          timeout: 120000,
          maxBuffer: 10 * 1024 * 1024,
        });
        try { unlinkSync(tmpFile); } catch {}
        return result.status === 0 ? result.stdout : null;
      },
    },
    {
      cmd: "gemini",
      name: "Gemini CLI",
      buildInvoke: () => (prompt) => {
        const result = spawnSync("gemini", ["-p", "-"], {
          input: prompt,
          encoding: "utf-8",
          timeout: 120000,
          maxBuffer: 10 * 1024 * 1024,
        });
        return result.status === 0 ? result.stdout : null;
      },
    },
    {
      cmd: "copilot",
      name: "Copilot CLI",
      buildInvoke: () => (prompt) => {
        const result = spawnSync("copilot", ["-p", "-"], {
          input: prompt,
          encoding: "utf-8",
          timeout: 120000,
          maxBuffer: 10 * 1024 * 1024,
        });
        return result.status === 0 ? result.stdout : null;
      },
    },
    {
      cmd: "aider",
      name: "Aider",
      buildInvoke: () => (prompt) => {
        const tmpFile = join(tmpdir(), `agentcache-prompt-${Date.now()}.txt`);
        writeFileSync(tmpFile, prompt);
        const result = spawnSync("aider", ["--message-file", tmpFile, "--yes", "--no-stream", "--no-git"], {
          encoding: "utf-8",
          timeout: 120000,
          maxBuffer: 10 * 1024 * 1024,
        });
        try { unlinkSync(tmpFile); } catch {}
        return result.status === 0 ? result.stdout : null;
      },
    },
    {
      cmd: "goose",
      name: "Goose",
      buildInvoke: () => (prompt) => {
        const tmpFile = join(tmpdir(), `agentcache-prompt-${Date.now()}.txt`);
        writeFileSync(tmpFile, prompt);
        const result = spawnSync("goose", ["run", "--instructions", tmpFile], {
          encoding: "utf-8",
          timeout: 120000,
          maxBuffer: 10 * 1024 * 1024,
        });
        try { unlinkSync(tmpFile); } catch {}
        return result.status === 0 ? result.stdout : null;
      },
    },
  ];

  for (const b of backends) {
    try {
      const which = spawnSync("which", [b.cmd], { encoding: "utf-8" });
      if (which.status === 0 && which.stdout.trim()) {
        return { name: b.name, invoke: b.buildInvoke() };
      }
    } catch {}
  }

  // Fallback 1: Ollama running locally
  try {
    const ollamaCheck = spawnSync("curl", ["-s", "http://localhost:11434/api/tags"], {
      encoding: "utf-8",
      timeout: 3000,
    });
    if (ollamaCheck.status === 0 && ollamaCheck.stdout.includes("models")) {
      const models = JSON.parse(ollamaCheck.stdout)?.models || [];
      const model = models.find((m: any) => /qwen|llama|mistral|gemma/i.test(m.name))?.name || models[0]?.name;
      if (model) {
        return {
          name: `Ollama (${model})`,
          invoke: (prompt: string) => {
            const result = spawnSync("curl", [
              "-s", "http://localhost:11434/api/generate",
              "-d", JSON.stringify({ model, prompt, stream: false }),
            ], { encoding: "utf-8", timeout: 120000, maxBuffer: 10 * 1024 * 1024 });
            if (result.status !== 0) return null;
            try { return JSON.parse(result.stdout)?.response || null; } catch { return null; }
          },
        };
      }
    }
  } catch {}

  // Fallback 2: ANTHROPIC_API_KEY env var
  const anthropicKey = process.env.ANTHROPIC_API_KEY;
  if (anthropicKey) {
    return {
      name: "Anthropic API (env)",
      invoke: (prompt: string) => {
        const result = spawnSync("curl", [
          "-s", "https://api.anthropic.com/v1/messages",
          "-H", "content-type: application/json",
          "-H", `x-api-key: ${anthropicKey}`,
          "-H", "anthropic-version: 2023-06-01",
          "-d", JSON.stringify({
            model: "claude-sonnet-4-20250514",
            max_tokens: 4096,
            messages: [{ role: "user", content: prompt }],
          }),
        ], { encoding: "utf-8", timeout: 120000, maxBuffer: 10 * 1024 * 1024 });
        if (result.status !== 0) return null;
        try { return JSON.parse(result.stdout)?.content?.[0]?.text || null; } catch { return null; }
      },
    };
  }

  // Fallback 3: OPENAI_API_KEY env var
  const openaiKey = process.env.OPENAI_API_KEY;
  if (openaiKey) {
    return {
      name: "OpenAI API (env)",
      invoke: (prompt: string) => {
        const result = spawnSync("curl", [
          "-s", "https://api.openai.com/v1/chat/completions",
          "-H", "content-type: application/json",
          "-H", `Authorization: Bearer ${openaiKey}`,
          "-d", JSON.stringify({
            model: "gpt-4o-mini",
            messages: [{ role: "user", content: prompt }],
          }),
        ], { encoding: "utf-8", timeout: 120000, maxBuffer: 10 * 1024 * 1024 });
        if (result.status !== 0) return null;
        try { return JSON.parse(result.stdout)?.choices?.[0]?.message?.content || null; } catch { return null; }
      },
    };
  }

  return null;
}

function discoverAllTranscripts(repo: SqliteKnowledgeRepository): { path: string; project: string; projectRoot: string }[] {
  const compiledPaths = new Set(repo.getAllCompiledTranscriptPaths());
  const results: { path: string; project: string; projectRoot: string }[] = [];

  const allPaths = [
    ...findAllClaudeTranscripts(),
    ...findAllContinueTranscripts(),
    ...findAllCodexTranscripts(),
    ...findAllRooCodeTranscripts(),
  ];

  for (const path of allPaths) {
    if (compiledPaths.has(path)) continue;
    const projectRoot = inferProjectRoot(path);
    const project = getProjectId(projectRoot);
    results.push({ path, project, projectRoot });
  }

  return results;
}

function inferProjectRoot(path: string): string {
  if (path.includes(".claude/projects/")) {
    const slug = path.split(".claude/projects/")[1]?.split("/")[0] || "";
    if (slug.startsWith("-")) return slug.replace(/-/g, "/");
  }
  if (path.includes(".codex/sessions/")) return process.cwd();
  if (path.includes("roo-cline/tasks/")) return process.cwd();
  return process.cwd();
}

function processOneTranscript(
  repo: SqliteKnowledgeRepository,
  path: string,
  project: string,
  projectRoot: string,
  backend: LlmBackend
): { created: number; reinforced: number; skipped: boolean } {
  const events = parseTranscript(path);
  if (events.length < 3) return { created: 0, reinforced: 0, skipped: true };

  const sessionId = `sess_${randomUUID().slice(0, 8)}`;
  const state = startCompile(events, sessionId, project, projectRoot, repo, path);

  const extractionResponse = backend.invoke(state.prompt);
  if (!extractionResponse) return { created: 0, reinforced: 0, skipped: true };

  const extractResult = processExtraction(repo, extractionResponse, sessionId, project, projectRoot);

  if (extractResult.status === "complete") {
    return { created: 0, reinforced: 0, skipped: false };
  }

  const clusterResponse = backend.invoke(extractResult.clusteringPrompt);
  if (!clusterResponse) return { created: 0, reinforced: 0, skipped: true };

  const clusterResult = processClustering(repo, clusterResponse, sessionId, project, projectRoot);
  const diag = clusterResult.diagnostics;
  const createdMatch = diag.match(/(\d+) new knowledge/);
  const reinforcedMatch = diag.match(/(\d+) reinforced/);

  return {
    created: createdMatch ? parseInt(createdMatch[1]) : 0,
    reinforced: reinforcedMatch ? parseInt(reinforcedMatch[1]) : 0,
    skipped: false,
  };
}

function processGooseSessions(
  repo: SqliteKnowledgeRepository,
  backend: LlmBackend
): { processed: number; created: number } {
  const dbPath = getGooseDbPath();
  if (!existsSync(dbPath)) return { processed: 0, created: 0 };

  let Database: any;
  try {
    Database = require("better-sqlite3");
  } catch {
    return { processed: 0, created: 0 };
  }

  const gooseDb = new Database(dbPath, { readonly: true });
  const compiledPaths = new Set(repo.getAllCompiledTranscriptPaths());

  const sessions = gooseDb.prepare("SELECT id, working_dir FROM sessions").all() as any[];
  let processed = 0;
  let totalCreated = 0;

  for (const session of sessions) {
    const markerPath = `goose:${session.id}`;
    if (compiledPaths.has(markerPath)) continue;

    const { parseSession } = require("./utils/transcript-parsers/goose-sqlite.js");
    const events = parseSession(gooseDb, session.id);
    if (events.length < 3) continue;

    const projectRoot = session.working_dir || process.cwd();
    const project = getProjectId(projectRoot);
    const sessionId = `sess_${randomUUID().slice(0, 8)}`;

    const state = startCompile(events, sessionId, project, projectRoot, repo, markerPath);
    const extractionResponse = backend.invoke(state.prompt);
    if (!extractionResponse) continue;

    const extractResult = processExtraction(repo, extractionResponse, sessionId, project, projectRoot);
    if (extractResult.status === "needs_clustering") {
      const clusterResponse = backend.invoke(extractResult.clusteringPrompt);
      if (clusterResponse) {
        processClustering(repo, clusterResponse, sessionId, project, projectRoot);
      }
    }

    processed++;
    totalCreated++;
  }

  gooseDb.close();
  return { processed, created: totalCreated };
}

export async function runCompileAll(): Promise<void> {
  if (!isInitialized()) {
    console.error("AgentCache not initialized. Run: npm install -g agentcache");
    process.exit(1);
  }

  if (!acquireLock()) {
    console.error("Another compile-all process is already running. Exiting.");
    process.exit(0);
  }
  process.on("exit", releaseLock);
  process.on("SIGINT", () => { releaseLock(); process.exit(130); });
  process.on("SIGTERM", () => { releaseLock(); process.exit(143); });

  const backend = detectBackend();
  if (!backend) {
    releaseLock();
    console.error("No LLM backend found. Install one of: claude, codex, gemini, copilot, aider, goose");
    process.exit(1);
  }

  console.log(`AgentCache compile-all`);
  console.log(`LLM backend: ${backend.name}`);
  console.log("");

  const repo = new SqliteKnowledgeRepository(getDbPath());

  // Discover all uncompiled transcripts
  const transcripts = discoverAllTranscripts(repo);
  const gooseAvailable = existsSync(getGooseDbPath());

  const total = transcripts.length + (gooseAvailable ? 1 : 0);
  if (total === 0 && !gooseAvailable) {
    console.log("No uncompiled transcripts found. Knowledge is up to date.");
    repo.close();
    return;
  }

  const estimatedMinutes = Math.ceil(transcripts.length * 0.7);
  console.log(`Found ${transcripts.length} transcripts to process`);
  if (gooseAvailable) console.log(`+ Goose sessions available`);
  console.log(`Estimated time: ~${estimatedMinutes} minutes`);
  console.log(`Started: ${new Date().toLocaleTimeString()}`);
  console.log("─".repeat(50));

  let processed = 0;
  let totalCreated = 0;
  let totalReinforced = 0;
  let errors = 0;

  for (const t of transcripts) {
    processed++;
    const label = t.path.split("/").slice(-2).join("/");
    process.stdout.write(`[${processed}/${transcripts.length}] ${label.slice(0, 40)}... `);

    try {
      const result = processOneTranscript(repo, t.path, t.project, t.projectRoot, backend);
      if (result.skipped) {
        console.log("skipped");
      } else {
        totalCreated += result.created;
        totalReinforced += result.reinforced;
        console.log(`+${result.created} new, ${result.reinforced} reinforced`);
      }
    } catch (err: any) {
      errors++;
      console.log(`error: ${err.message?.slice(0, 50)}`);
    }
  }

  if (gooseAvailable) {
    process.stdout.write("Processing Goose sessions... ");
    try {
      const gooseResult = processGooseSessions(repo, backend);
      console.log(`${gooseResult.processed} sessions processed`);
    } catch (err: any) {
      console.log(`error: ${err.message?.slice(0, 50)}`);
    }
  }

  repo.close();

  console.log("─".repeat(50));
  console.log(`Done: ${new Date().toLocaleTimeString()}`);
  console.log(`  ${processed} transcripts processed`);
  console.log(`  ${totalCreated} knowledge items created`);
  console.log(`  ${totalReinforced} reinforced`);
  if (errors > 0) console.log(`  ${errors} errors`);
}
