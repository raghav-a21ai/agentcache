import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import { join, dirname } from "path";
import { homedir } from "os";
import type { IdeConfig } from "./ide-detector.js";

const MCP_ENTRY_STDIO = {
  type: "stdio",
  command: "agentcache",
  args: ["serve"],
  env: {},
};

const MCP_ENTRY_SIMPLE = {
  command: "agentcache",
  args: ["serve"],
};

export function registerMcpServer(ide: IdeConfig): boolean {
  if (!ide.detected) return false;

  if (ide.mcpConfigFormat === "claude-settings") {
    // Claude Code CLI reads MCP servers from ~/.claude.json, not ~/.claude/settings.json
    const claudeJsonPath = join(homedir(), ".claude.json");
    let config: Record<string, any> = {};
    if (existsSync(claudeJsonPath)) {
      try { config = JSON.parse(readFileSync(claudeJsonPath, "utf-8")); } catch { config = {}; }
    }
    if (!config.mcpServers) config.mcpServers = {};
    if (config.mcpServers.agentcache) return false;
    config.mcpServers.agentcache = MCP_ENTRY_STDIO;
    writeFileSync(claudeJsonPath, JSON.stringify(config, null, 2));
    return true;
  }

  if (ide.mcpConfigFormat === "mcp-json") {
    let config: Record<string, any> = {};
    if (existsSync(ide.mcpConfigPath)) {
      try { config = JSON.parse(readFileSync(ide.mcpConfigPath, "utf-8")); } catch { config = {}; }
    }
    if (!config.mcpServers) config.mcpServers = {};
    if (config.mcpServers.agentcache) return false;
    config.mcpServers.agentcache = MCP_ENTRY_SIMPLE;
    mkdirSync(dirname(ide.mcpConfigPath), { recursive: true });
    writeFileSync(ide.mcpConfigPath, JSON.stringify(config, null, 2));
    return true;
  }

  return false;
}

export function registerClaudeHooks(): boolean {
  const settingsPath = join(homedir(), ".claude", "settings.json");
  if (!existsSync(join(homedir(), ".claude"))) return false;

  let settings: Record<string, any> = {};
  if (existsSync(settingsPath)) {
    try { settings = JSON.parse(readFileSync(settingsPath, "utf-8")); } catch { settings = {}; }
  }

  if (!settings.hooks) settings.hooks = {};
  const hooks = settings.hooks as Record<string, unknown[]>;

  const loopHooks: Record<string, unknown[]> = {
    Stop: [{ matcher: "", hooks: [{ type: "command", command: "agentcache compile-session" }] }],
    SessionStart: [{ matcher: "", hooks: [{ type: "command", command: "agentcache discover" }] }],
    PreToolUse: [{ matcher: "", hooks: [{ type: "command", command: "agentcache enforce" }] }],
  };

  let registered = false;
  for (const [event, hookConfig] of Object.entries(loopHooks)) {
    if (!hooks[event]) hooks[event] = [];
    const existing = hooks[event] as Array<{ hooks?: Array<{ command?: string }> }>;
    const hasLoop = existing.some((h) => h.hooks?.some((hh) => hh.command?.includes("agentcache")));
    if (!hasLoop) {
      hooks[event].push(...hookConfig);
      registered = true;
    }
  }

  if (registered) {
    writeFileSync(settingsPath, JSON.stringify(settings, null, 2));
  }
  return registered;
}
