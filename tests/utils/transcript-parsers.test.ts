import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, writeFileSync, rmSync, mkdirSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import * as codexParser from "../../src/utils/transcript-parsers/codex-jsonl.js";
import * as rooParser from "../../src/utils/transcript-parsers/roo-code-json.js";

describe("Codex JSONL Parser", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "agentcache-test-codex-"));
    mkdirSync(join(tmpDir, ".codex", "sessions", "s1"), { recursive: true });
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("canParse returns true for .codex/sessions/ paths", () => {
    expect(codexParser.canParse(join(tmpDir, ".codex/sessions/s1/transcript.jsonl"))).toBe(true);
  });

  it("canParse returns false for other .jsonl paths", () => {
    expect(codexParser.canParse("/home/user/.claude/projects/abc/session.jsonl")).toBe(false);
  });

  it("parses developer messages as user events", () => {
    const path = join(tmpDir, ".codex", "sessions", "s1", "transcript.jsonl");
    const lines = [
      JSON.stringify({
        type: "response_item",
        payload: {
          role: "developer",
          content: [{ type: "input_text", text: "Fix the bug in auth.ts" }],
        },
      }),
    ];
    writeFileSync(path, lines.join("\n"));

    const events = codexParser.parse(path);
    expect(events).toHaveLength(1);
    expect(events[0].role).toBe("user");
    expect(events[0].content).toBe("Fix the bug in auth.ts");
  });

  it("parses assistant output_text and function_call", () => {
    const path = join(tmpDir, ".codex", "sessions", "s1", "transcript.jsonl");
    const lines = [
      JSON.stringify({
        type: "response_item",
        payload: {
          role: "assistant",
          content: [
            { type: "output_text", text: "I'll fix auth.ts" },
            { type: "function_call", name: "edit_file", arguments: '{"path":"auth.ts"}' },
          ],
        },
      }),
    ];
    writeFileSync(path, lines.join("\n"));

    const events = codexParser.parse(path);
    expect(events).toHaveLength(2);
    expect(events[0]).toEqual({ type: "message", role: "assistant", content: "I'll fix auth.ts" });
    expect(events[1]).toEqual({
      type: "tool_use",
      tool_name: "edit_file",
      tool_input: { arguments: '{"path":"auth.ts"}' },
    });
  });

  it("skips malformed lines gracefully", () => {
    const path = join(tmpDir, ".codex", "sessions", "s1", "transcript.jsonl");
    writeFileSync(path, "not json\n{}\n" + JSON.stringify({
      type: "response_item",
      payload: { role: "developer", content: [{ type: "input_text", text: "hello" }] },
    }));

    const events = codexParser.parse(path);
    expect(events).toHaveLength(1);
    expect(events[0].content).toBe("hello");
  });
});

describe("Roo Code JSON Parser", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "agentcache-test-roo-"));
    mkdirSync(join(tmpDir, "roo-cline", "tasks", "task1"), { recursive: true });
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("canParse returns true for roo-cline task history files", () => {
    expect(rooParser.canParse(join(tmpDir, "roo-cline/tasks/task1/api_conversation_history.json"))).toBe(true);
  });

  it("canParse returns false for other json paths", () => {
    expect(rooParser.canParse("/home/user/.continue/sessions/abc.json")).toBe(false);
  });

  it("parses user messages with content array", () => {
    const path = join(tmpDir, "roo-cline", "tasks", "task1", "api_conversation_history.json");
    const messages = [
      { role: "user", content: [{ type: "text", text: "Add logging to main.ts" }] },
    ];
    writeFileSync(path, JSON.stringify(messages));

    const events = rooParser.parse(path);
    expect(events).toHaveLength(1);
    expect(events[0]).toEqual({ type: "message", role: "user", content: "Add logging to main.ts" });
  });

  it("parses assistant string content", () => {
    const path = join(tmpDir, "roo-cline", "tasks", "task1", "api_conversation_history.json");
    const messages = [
      { role: "assistant", content: "I'll add logging now." },
    ];
    writeFileSync(path, JSON.stringify(messages));

    const events = rooParser.parse(path);
    expect(events).toHaveLength(1);
    expect(events[0]).toEqual({ type: "message", role: "assistant", content: "I'll add logging now." });
  });

  it("parses assistant content array with text and tool_use", () => {
    const path = join(tmpDir, "roo-cline", "tasks", "task1", "api_conversation_history.json");
    const messages = [
      {
        role: "assistant",
        content: [
          { type: "text", text: "Let me edit that file." },
          { type: "tool_use", name: "write_to_file", input: { path: "main.ts", content: "code" } },
        ],
      },
    ];
    writeFileSync(path, JSON.stringify(messages));

    const events = rooParser.parse(path);
    expect(events).toHaveLength(2);
    expect(events[0].type).toBe("message");
    expect(events[1]).toEqual({
      type: "tool_use",
      tool_name: "write_to_file",
      tool_input: { path: "main.ts", content: "code" },
    });
  });

  it("returns empty array for invalid JSON", () => {
    const path = join(tmpDir, "roo-cline", "tasks", "task1", "api_conversation_history.json");
    writeFileSync(path, "not json at all");

    const events = rooParser.parse(path);
    expect(events).toEqual([]);
  });

  it("returns empty array for non-array JSON", () => {
    const path = join(tmpDir, "roo-cline", "tasks", "task1", "api_conversation_history.json");
    writeFileSync(path, JSON.stringify({ messages: [] }));

    const events = rooParser.parse(path);
    expect(events).toEqual([]);
  });
});
