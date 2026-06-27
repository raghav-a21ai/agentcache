import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import { findProjectRoot, getDbPath, getInjectedContextPath, getPendingQueuePath, isLoopInitialized } from "./utils/paths.js";
import { parseTranscript } from "./utils/transcript.js";
import { SqliteKnowledgeRepository } from "./storage/sqlite.js";
import { startCompile, processExtraction, processClustering } from "./knowledge/compiler.js";
import { computeCanonicalHash } from "./knowledge/passes/3-canonicalizer.js";
import { readFileSync, existsSync, unlinkSync, writeFileSync } from "fs";
import { randomUUID } from "crypto";
import type { Observation } from "./storage/repository.js";

export async function startMcpServer(): Promise<void> {
  const server = new Server(
    { name: "loop", version: "0.1.0" },
    { capabilities: { tools: {} } }
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: [
      {
        name: "loop_compile_extract",
        description: "Start compiling a pending session. Returns an extraction prompt for you to process. Call loop_compile_submit with the results.",
        inputSchema: { type: "object" as const, properties: {}, required: [] },
      },
      {
        name: "loop_compile_submit",
        description: "Submit extracted observations from the extraction prompt. Loop processes them locally and either finalizes or returns a clustering prompt.",
        inputSchema: {
          type: "object" as const,
          properties: {
            sessionId: { type: "string", description: "Session ID from loop_compile_extract" },
            observations: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  type: { type: "string", enum: ["rule", "lesson", "decision", "context"] },
                  content: { type: "string" },
                  sourceQuote: { type: "string" },
                  confidence: { type: "string", enum: ["high", "medium"] },
                },
                required: ["type", "content", "confidence"],
              },
            },
          },
          required: ["sessionId", "observations"],
        },
      },
      {
        name: "loop_compile_cluster",
        description: "Submit clustering decisions for observations that need LLM classification. Finalizes compilation.",
        inputSchema: {
          type: "object" as const,
          properties: {
            sessionId: { type: "string", description: "Session ID from loop_compile_submit" },
            clusters: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  observationId: { type: "string" },
                  action: { type: "string", enum: ["CREATE", "REINFORCE", "SUPERSEDE", "DEPRECATE", "IGNORE"] },
                  targetKnowledgeItemId: { type: "string" },
                  reasoning: { type: "string" },
                },
                required: ["observationId", "action", "reasoning"],
              },
            },
          },
          required: ["sessionId", "clusters"],
        },
      },
      {
        name: "loop_save_observation",
        description: "Save a manual observation to Loop's knowledge base (authority: USER, never overwritten by compiler)",
        inputSchema: {
          type: "object" as const,
          properties: {
            type: { type: "string", enum: ["rule", "lesson", "decision", "context"] },
            content: { type: "string", description: "The observation content" },
            enforce: { type: "boolean", description: "Whether this rule should block tool use" },
          },
          required: ["type", "content"],
        },
      },
      {
        name: "loop_get_knowledge",
        description: "Get knowledge items from Loop's compiled database",
        inputSchema: {
          type: "object" as const,
          properties: {
            type: { type: "string", enum: ["rule", "lesson", "decision", "context"] },
            status: { type: "string", enum: ["active", "deprecated", "superseded", "archived"] },
          },
          required: [],
        },
      },
      {
        name: "loop_inject_context",
        description: "Get the compiled Loop context for the current project",
        inputSchema: { type: "object" as const, properties: {}, required: [] },
      },
    ],
  }));

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const projectRoot = findProjectRoot();
    if (!isLoopInitialized(projectRoot)) {
      return { content: [{ type: "text" as const, text: "Loop not initialized. Run: loop init" }], isError: true };
    }

    const repo = new SqliteKnowledgeRepository(getDbPath(projectRoot));
    const project = projectRoot.split("/").pop() || "unknown";

    try {
      switch (request.params.name) {
        case "loop_compile_extract": {
          const queuePath = getPendingQueuePath(projectRoot);
          if (!existsSync(queuePath)) {
            return { content: [{ type: "text" as const, text: "No pending sessions to compile." }] };
          }

          const raw = readFileSync(queuePath, "utf-8");
          const entries = raw.split("\n").filter(Boolean).map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
          if (entries.length === 0) {
            unlinkSync(queuePath);
            return { content: [{ type: "text" as const, text: "No pending sessions to compile." }] };
          }

          // Take the first pending entry
          const entry = entries[0];
          if (!existsSync(entry.transcriptPath)) {
            return { content: [{ type: "text" as const, text: `Transcript not found: ${entry.transcriptPath}` }], isError: true };
          }

          const events = parseTranscript(entry.transcriptPath);
          if (events.length === 0) {
            return { content: [{ type: "text" as const, text: "Empty transcript, nothing to extract." }] };
          }

          const sessionId = `sess_${randomUUID().slice(0, 8)}`;
          const state = startCompile(events, sessionId, project, projectRoot, repo);

          // Remove processed entry from queue
          const remaining = entries.slice(1);
          if (remaining.length === 0) {
            unlinkSync(queuePath);
          } else {
            writeFileSync(queuePath, remaining.map((e: any) => JSON.stringify(e)).join("\n") + "\n");
          }

          return {
            content: [{ type: "text" as const, text: JSON.stringify({ sessionId: state.sessionId, prompt: state.prompt }) }],
          };
        }

        case "loop_compile_submit": {
          const args = request.params.arguments as { sessionId: string; observations: any[] };
          const responseText = JSON.stringify({ observations: args.observations });
          const result = processExtraction(repo, responseText, args.sessionId, project, projectRoot);

          if (result.status === "complete") {
            return { content: [{ type: "text" as const, text: JSON.stringify({ status: "complete", diagnostics: result.diagnostics }) }] };
          }

          return {
            content: [{ type: "text" as const, text: JSON.stringify({ status: "needs_clustering", sessionId: result.sessionId, prompt: result.clusteringPrompt }) }],
          };
        }

        case "loop_compile_cluster": {
          const args = request.params.arguments as { sessionId: string; clusters: any[] };
          const responseText = JSON.stringify({ clusters: args.clusters });
          const result = processClustering(repo, responseText, args.sessionId, project, projectRoot);
          return { content: [{ type: "text" as const, text: JSON.stringify({ status: "complete", diagnostics: result.diagnostics }) }] };
        }

        case "loop_save_observation": {
          const args = request.params.arguments as { type: string; content: string; enforce?: boolean };
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
            createdAt: Date.now(),
            updatedAt: Date.now(),
            lastSeenAt: Date.now(),
            metadata: { source: "mcp" },
          });

          return { content: [{ type: "text" as const, text: `Saved: ${args.content}` }] };
        }

        case "loop_get_knowledge": {
          const args = (request.params.arguments || {}) as { type?: string; status?: string };
          const items = repo.getKnowledgeItems(project, {
            type: args.type as any,
            status: (args.status || "active") as any,
          });
          const summary = items.map((i) => `[${i.confidence}] ${i.content}`).join("\n");
          return { content: [{ type: "text" as const, text: summary || "No knowledge items found." }] };
        }

        case "loop_inject_context": {
          const contextPath = getInjectedContextPath(projectRoot);
          try {
            const content = readFileSync(contextPath, "utf-8");
            return { content: [{ type: "text" as const, text: content }] };
          } catch {
            return { content: [{ type: "text" as const, text: "No compiled context yet. Run a session first." }] };
          }
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
