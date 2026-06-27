import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { CallToolRequestSchema, ListToolsRequestSchema, RootsListChangedNotificationSchema } from "@modelcontextprotocol/sdk/types.js";
import { getDbPath, findProjectRoot, getProjectId, getProjectDisplayName, isLoopInitialized } from "./utils/paths.js";
import { parseTranscript } from "./utils/transcript.js";
import { SqliteKnowledgeRepository } from "./storage/sqlite.js";
import { startCompile, processExtraction, processClustering } from "./knowledge/compiler.js";
import { computeCanonicalHash } from "./knowledge/passes/3-canonicalizer.js";
import { evaluatePolicy } from "./policy/engine.js";
import { existsSync } from "fs";
import { randomUUID } from "crypto";
import type { Observation } from "./storage/repository.js";

function defaultScope(type: string): "global" | "project" {
  return (type === "rule" || type === "lesson") ? "global" : "project";
}

let cachedProjectRoot: string | null = null;

async function resolveRoots(server: Server): Promise<void> {
  try {
    const result = await server.listRoots();
    if (result.roots.length > 0) {
      const uri = result.roots[0].uri;
      if (uri.startsWith("file://")) {
        cachedProjectRoot = uri.slice(7);
      }
    }
  } catch {
    // Client doesn't support roots — fall back to cwd
  }
}

function getResolvedProjectRoot(): string {
  return cachedProjectRoot || findProjectRoot();
}

function getResolvedProjectId(): string {
  return getProjectId(getResolvedProjectRoot());
}

export async function startMcpServer(): Promise<void> {
  const server = new Server(
    { name: "agentcache", version: "0.1.0" },
    {
      capabilities: { tools: {} },
      instructions: "AgentCache is your knowledge cache. At the START of every session, call loop_inject_context to load compiled rules, lessons, decisions, and context. Submit observations INCREMENTALLY via loop_compile_submit as you learn them — do not wait until session end.",
    }
  );

  server.oninitialized = async () => {
    await resolveRoots(server);
  };

  server.setNotificationHandler(RootsListChangedNotificationSchema, async () => {
    await resolveRoots(server);
  });

  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: [
      {
        name: "loop_inject_context",
        description: "Get compiled engineering knowledge for this project. Returns global rules/lessons (apply everywhere) + project-specific decisions/context. Call this at the START of every session.",
        inputSchema: {
          type: "object" as const,
          properties: {
            project: { type: "string", description: "Project identifier. Auto-detected from workspace roots if omitted." },
          },
          required: [],
        },
      },
      {
        name: "loop_compile_submit",
        description: "Submit observations extracted from your session. Call this INCREMENTALLY — each time you learn a rule, lesson, decision, or context item. Do NOT batch until end of session; sessions can terminate without warning.",
        inputSchema: {
          type: "object" as const,
          properties: {
            observations: {
              type: "array",
              description: "Observations extracted from the session",
              items: {
                type: "object",
                properties: {
                  type: { type: "string", enum: ["rule", "lesson", "decision", "context"], description: "rule=standing constraint, lesson=mistake+fix, decision=arch choice+rationale, context=current state" },
                  content: { type: "string", description: "The observation content" },
                  sourceQuote: { type: "string", description: "Optional quote from conversation that triggered this" },
                  confidence: { type: "string", enum: ["high", "medium"], description: "How confident: high=explicitly stated, medium=inferred" },
                  scope: { type: "string", enum: ["global", "project"], description: "global=applies to all projects, project=this project only. Defaults: rule/lesson->global, decision/context->project" },
                },
                required: ["type", "content", "confidence"],
              },
            },
            project: { type: "string", description: "Project identifier. Auto-detected if omitted." },
          },
          required: ["observations"],
        },
      },
      {
        name: "loop_compile_cluster",
        description: "Submit clustering decisions when loop_compile_submit returns needs_clustering. Determines whether observations create new knowledge or relate to existing items.",
        inputSchema: {
          type: "object" as const,
          properties: {
            sessionId: { type: "string", description: "Session ID from loop_compile_submit response" },
            clusters: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  observationId: { type: "string" },
                  action: { type: "string", enum: ["CREATE", "REINFORCE", "SUPERSEDE", "DEPRECATE", "IGNORE"] },
                  targetKnowledgeItemId: { type: "string", description: "Required for REINFORCE, SUPERSEDE, DEPRECATE" },
                  reasoning: { type: "string" },
                },
                required: ["observationId", "action", "reasoning"],
              },
            },
            project: { type: "string", description: "Project identifier. Auto-detected if omitted." },
          },
          required: ["sessionId", "clusters"],
        },
      },
      {
        name: "loop_compile_extract",
        description: "For PREVIOUS sessions stored as transcript files. Reads a queued transcript and returns an extraction prompt for you to process. After processing, call loop_compile_submit with the results.",
        inputSchema: {
          type: "object" as const,
          properties: {
            project: { type: "string", description: "Project identifier. Auto-detected if omitted." },
          },
          required: [],
        },
      },
      {
        name: "loop_enforce",
        description: "Check if a tool call is allowed by Loop's policy rules. Call this BEFORE executing risky operations (file deletions, force pushes, etc). Returns allow or block with reason.",
        inputSchema: {
          type: "object" as const,
          properties: {
            tool_name: { type: "string", description: "Name of the tool being called (e.g. 'Bash', 'Write')" },
            tool_input: { type: "object", description: "The tool's input parameters" },
            project: { type: "string", description: "Project identifier. Auto-detected if omitted." },
          },
          required: ["tool_name"],
        },
      },
      {
        name: "loop_save_observation",
        description: "Save a single observation immediately with USER authority (never overwritten by compiler). Use for important rules or decisions that should persist permanently.",
        inputSchema: {
          type: "object" as const,
          properties: {
            type: { type: "string", enum: ["rule", "lesson", "decision", "context"] },
            content: { type: "string", description: "The observation content" },
            enforce: { type: "boolean", description: "If true, this rule will BLOCK tool calls that violate it" },
            scope: { type: "string", enum: ["global", "project"], description: "Defaults: rule/lesson->global, decision/context->project" },
            project: { type: "string", description: "Project identifier. Auto-detected if omitted." },
          },
          required: ["type", "content"],
        },
      },
      {
        name: "loop_get_knowledge",
        description: "Query knowledge items from Loop's compiled database.",
        inputSchema: {
          type: "object" as const,
          properties: {
            type: { type: "string", enum: ["rule", "lesson", "decision", "context"] },
            status: { type: "string", enum: ["active", "deprecated", "superseded", "archived"] },
            scope: { type: "string", enum: ["global", "project"] },
            project: { type: "string", description: "Filter by project. Omit to see all." },
          },
          required: [],
        },
      },
      {
        name: "loop_deprecate_knowledge",
        description: "Mark a knowledge item as deprecated. Use when a rule, lesson, or decision is no longer valid. Works on both auto-compiled and user-saved items.",
        inputSchema: {
          type: "object" as const,
          properties: {
            id: { type: "string", description: "Knowledge item ID to deprecate" },
            reason: { type: "string", description: "Why this item is being deprecated" },
          },
          required: ["id", "reason"],
        },
      },
    ],
  }));

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    if (!isLoopInitialized()) {
      return { content: [{ type: "text" as const, text: "Loop not initialized. Run: agentcache setup" }], isError: true };
    }

    const repo = new SqliteKnowledgeRepository(getDbPath());
    const projectRoot = getResolvedProjectRoot();
    const detectedProject = getResolvedProjectId();

    try {
      switch (request.params.name) {
        case "loop_inject_context": {
          const args = (request.params.arguments || {}) as { project?: string };
          const project = args.project || detectedProject;
          const items = repo.getKnowledgeForContext(project);

          const rules = items.filter((i) => i.type === "rule").slice(0, 20);
          const lessons = items.filter((i) => i.type === "lesson").slice(0, 10);
          const decisions = items.filter((i) => i.type === "decision").slice(0, 10);
          const context = items.filter((i) => i.type === "context").slice(0, 5);

          let output = "";
          if (rules.length) {
            output += "# Rules\n" + rules.map((r) => `- ${r.content}`).join("\n") + "\n\n";
          }
          if (lessons.length) {
            output += "# Lessons\n" + lessons.map((l) => `- ${l.content}`).join("\n") + "\n\n";
          }
          if (decisions.length) {
            output += "# Decisions\n" + decisions.map((d) => `- ${d.content}`).join("\n") + "\n\n";
          }
          if (context.length) {
            output += "# Context\n" + context.map((c) => `- ${c.content}`).join("\n") + "\n\n";
          }

          if (!output) output = "No compiled knowledge yet. This will populate as you use Loop across sessions.\n";

          const pendingCount = repo.getPendingCount();
          if (pendingCount > 0) {
            output = `<!-- ${pendingCount} previous session(s) pending compilation. Call loop_compile_extract to process. -->\n\n` + output;
          }

          output += "\n---\nIMPORTANT: Submit observations incrementally as they happen during this session.\nWhen you learn something (rule, lesson, decision, context), call loop_compile_submit immediately.\nDo NOT wait until the end — sessions can terminate without warning.\n";

          return { content: [{ type: "text" as const, text: output.trim() }] };
        }

        case "loop_compile_submit": {
          const args = request.params.arguments as { observations: any[]; project?: string };
          const project = args.project || detectedProject;
          const sessionId = `sess_${randomUUID().slice(0, 8)}`;

          const observationsWithScope = args.observations.map((o: any) => ({
            ...o,
            scope: o.scope || defaultScope(o.type),
          }));

          const responseText = JSON.stringify({ observations: observationsWithScope });
          startCompile([], sessionId, project, projectRoot, repo);
          const result = processExtraction(repo, responseText, sessionId, project, projectRoot);

          if (result.status === "complete") {
            return { content: [{ type: "text" as const, text: JSON.stringify({ status: "complete", diagnostics: result.diagnostics }) }] };
          }

          return {
            content: [{ type: "text" as const, text: JSON.stringify({ status: "needs_clustering", sessionId: result.sessionId, clusteringContext: result.clusteringPrompt }) }],
          };
        }

        case "loop_compile_cluster": {
          const args = request.params.arguments as { sessionId: string; clusters: any[]; project?: string };
          const project = args.project || detectedProject;
          const responseText = JSON.stringify({ clusters: args.clusters });
          const result = processClustering(repo, responseText, args.sessionId, project, projectRoot);
          return { content: [{ type: "text" as const, text: JSON.stringify({ status: "complete", diagnostics: result.diagnostics }) }] };
        }

        case "loop_compile_extract": {
          const args = (request.params.arguments || {}) as { project?: string };
          const entry = repo.popPendingTranscript();
          if (!entry) {
            return { content: [{ type: "text" as const, text: JSON.stringify({ message: "No pending sessions to compile." }) }] };
          }

          if (!existsSync(entry.transcriptPath)) {
            return { content: [{ type: "text" as const, text: JSON.stringify({ message: `Transcript not found: ${entry.transcriptPath}, skipped.` }) }] };
          }

          const events = parseTranscript(entry.transcriptPath);
          if (events.length === 0) {
            return { content: [{ type: "text" as const, text: JSON.stringify({ message: "Empty transcript, skipped." }) }] };
          }

          const sessionId = `sess_${randomUUID().slice(0, 8)}`;
          const project = entry.project || (args.project || detectedProject);
          const state = startCompile(events, sessionId, project, entry.projectRoot || projectRoot, repo, entry.transcriptPath);

          return { content: [{ type: "text" as const, text: JSON.stringify({ sessionId: state.sessionId, prompt: state.prompt }) }] };
        }

        case "loop_enforce": {
          const args = request.params.arguments as { tool_name: string; tool_input?: Record<string, unknown>; project?: string };
          const project = args.project || detectedProject;
          const input = { tool_name: args.tool_name, tool_input: args.tool_input || {} };
          const result = evaluatePolicy(input, repo.getEnforcedRules(project));
          return { content: [{ type: "text" as const, text: JSON.stringify(result) }] };
        }

        case "loop_save_observation": {
          const args = request.params.arguments as { type: string; content: string; enforce?: boolean; scope?: string; project?: string };
          const project = args.project || detectedProject;
          const scope = (args.scope || defaultScope(args.type)) as "global" | "project";
          const sessionId = `manual_${randomUUID().slice(0, 8)}`;

          repo.saveSession({
            id: sessionId,
            project,
            startedAt: Date.now(),
            endedAt: Date.now(),
            gitBranch: "",
            gitCommit: "",
            provider: "manual",
            model: "manual",
            transcriptPath: "",
            observationCount: 1,
          });

          const obs: Observation = {
            id: `obs_${randomUUID().slice(0, 8)}`,
            sessionId,
            timestamp: Date.now(),
            type: args.type as Observation["type"],
            content: args.content,
            sourceQuote: "manual entry via MCP",
            confidence: "high",
            project,
            scope,
          };
          repo.saveObservation(obs);

          repo.saveKnowledgeItem({
            id: `ki_${randomUUID().slice(0, 8)}`,
            canonicalHash: computeCanonicalHash(args.content),
            type: args.type as Observation["type"],
            title: args.content.slice(0, 80),
            content: args.content,
            confidence: "high",
            observationCount: 1,
            authority: "USER",
            status: "active",
            enforce: args.enforce || false,
            project,
            scope,
            createdAt: Date.now(),
            updatedAt: Date.now(),
            lastSeenAt: Date.now(),
            metadata: { source: "mcp" },
          });

          return { content: [{ type: "text" as const, text: JSON.stringify({ saved: true, scope }) }] };
        }

        case "loop_get_knowledge": {
          const args = (request.params.arguments || {}) as { type?: string; status?: string; scope?: string; project?: string };
          const project = args.project || detectedProject;
          const items = repo.getKnowledgeItems(project, {
            type: args.type as any,
            status: (args.status || "active") as any,
          });
          const filtered = args.scope ? items.filter((i) => i.scope === args.scope) : items;
          const summary = filtered.map((i) => `[${i.id}] [${i.scope}/${i.confidence}] (${i.type}) ${i.content}`).join("\n");
          return { content: [{ type: "text" as const, text: summary || "No knowledge items found." }] };
        }

        case "loop_deprecate_knowledge": {
          const args = request.params.arguments as { id: string; reason: string };
          const item = repo.getKnowledgeItem(args.id);
          if (!item) {
            return { content: [{ type: "text" as const, text: JSON.stringify({ error: `Item not found: ${args.id}` }) }], isError: true };
          }
          repo.updateKnowledgeItem(args.id, { status: "deprecated", updatedAt: Date.now() });
          return { content: [{ type: "text" as const, text: JSON.stringify({ deprecated: true, id: args.id, content: item.content, reason: args.reason }) }] };
        }

        default:
          return { content: [{ type: "text" as const, text: `Unknown tool: ${request.params.name}` }], isError: true };
      }
    } finally {
      repo.close();
    }
  });

  const transport = new StdioServerTransport();
  await server.connect(transport);
}
