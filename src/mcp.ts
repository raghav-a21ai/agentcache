import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { findProjectRoot, getDbPath, getInjectedContextPath } from "./utils/paths.js";
import { SqliteKnowledgeRepository } from "./storage/sqlite.js";
import { renderContext } from "./renderer/renderer.js";
import { readFileSync } from "fs";
import { randomUUID } from "crypto";
import type { Observation } from "./storage/repository.js";
import { computeCanonicalHash } from "./knowledge/passes/3-canonicalizer.js";

export async function startMcpServer(): Promise<void> {
  const server = new Server(
    { name: "loop", version: "0.1.0" },
    { capabilities: { tools: {} } }
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: [
      {
        name: "loop_inject_context",
        description: "Get the rendered Loop context for the current project",
        inputSchema: { type: "object" as const, properties: {}, required: [] },
      },
      {
        name: "loop_save_observation",
        description: "Save a manual observation to Loop's knowledge base",
        inputSchema: {
          type: "object" as const,
          properties: {
            type: { type: "string", enum: ["rule", "lesson", "decision", "context"] },
            content: { type: "string", description: "The observation content" },
            enforce: { type: "boolean", description: "Whether this should be enforced" },
          },
          required: ["type", "content"],
        },
      },
      {
        name: "loop_get_knowledge",
        description: "Get knowledge items from Loop's database",
        inputSchema: {
          type: "object" as const,
          properties: {
            type: { type: "string", enum: ["rule", "lesson", "decision", "context"] },
            status: { type: "string", enum: ["active", "deprecated", "superseded", "archived"] },
          },
          required: [],
        },
      },
    ],
  }));

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const projectRoot = findProjectRoot();
    const repo = new SqliteKnowledgeRepository(getDbPath(projectRoot));
    const project = projectRoot.split("/").pop() || "unknown";

    try {
      switch (request.params.name) {
        case "loop_inject_context": {
          const contextPath = getInjectedContextPath(projectRoot);
          try {
            const content = readFileSync(contextPath, "utf-8");
            return { content: [{ type: "text" as const, text: content }] };
          } catch {
            const items = repo.getKnowledgeItems(project, { status: "active" });
            const rendered = await renderContext(items, projectRoot);
            return { content: [{ type: "text" as const, text: rendered }] };
          }
        }

        case "loop_save_observation": {
          const args = request.params.arguments as {
            type: string;
            content: string;
            enforce?: boolean;
          };
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
          const args = (request.params.arguments || {}) as {
            type?: string;
            status?: string;
          };
          const items = repo.getKnowledgeItems(project, {
            type: args.type as Observation["type"] | undefined,
            status: (args.status || "active") as "active" | "deprecated" | "superseded" | "archived",
          });
          const summary = items.map((i) => `[${i.confidence}] ${i.content}`).join("\n");
          return { content: [{ type: "text" as const, text: summary || "No knowledge items found." }] };
        }

        default:
          return {
            content: [{ type: "text" as const, text: `Unknown tool: ${request.params.name}` }],
            isError: true,
          };
      }
    } finally {
      repo.close();
    }
  });

  const transport = new StdioServerTransport();
  await server.connect(transport);
}
