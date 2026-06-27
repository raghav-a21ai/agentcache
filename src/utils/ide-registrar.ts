import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import { join, dirname } from "path";
import { homedir } from "os";
import { execSync } from "child_process";
import type { IdeConfig } from "./ide-detector.js";

function findNodeBinary(): string {
  try {
    return execSync("which node", { encoding: "utf-8" }).trim();
  } catch {
    return "node";
  }
}

function findAgentcacheScript(): string {
  try {
    const binPath = execSync("which agentcache", { encoding: "utf-8" }).trim();
    return binPath;
  } catch {
    return join(dirname(dirname(__dirname)), "dist", "cli.js");
  }
}

function isVscodeExtensionIde(ide: IdeConfig): boolean {
  return ide.name === "Roo Code";
}

const ALL_TOOLS = [
  "loop_inject_context",
  "loop_compile_submit",
  "loop_compile_cluster",
  "loop_compile_extract",
  "loop_enforce",
  "loop_save_observation",
  "loop_get_knowledge",
  "loop_deprecate_knowledge",
];

export function registerMcpServer(ide: IdeConfig): boolean {
  if (!ide.detected) return false;

  if (ide.mcpConfigFormat === "claude-settings") {
    const claudeJsonPath = join(homedir(), ".claude.json");
    let config: Record<string, any> = {};
    if (existsSync(claudeJsonPath)) {
      try { config = JSON.parse(readFileSync(claudeJsonPath, "utf-8")); } catch { config = {}; }
    }
    if (!config.mcpServers) config.mcpServers = {};
    if (config.mcpServers.agentcache) return false;
    config.mcpServers.agentcache = {
      type: "stdio",
      command: "agentcache",
      args: ["serve"],
      env: {},
    };
    writeFileSync(claudeJsonPath, JSON.stringify(config, null, 2));

    // Auto-allow all agentcache MCP tools in Claude Code permissions
    const settingsPath = join(homedir(), ".claude", "settings.json");
    if (existsSync(join(homedir(), ".claude"))) {
      let settings: Record<string, any> = {};
      if (existsSync(settingsPath)) {
        try { settings = JSON.parse(readFileSync(settingsPath, "utf-8")); } catch { settings = {}; }
      }
      if (!settings.permissions) settings.permissions = {};
      if (!settings.permissions.allow) settings.permissions.allow = [];
      const allowList = settings.permissions.allow as string[];
      const mcpPerms = ALL_TOOLS.map(t => `mcp__agentcache__${t}`);
      for (const perm of mcpPerms) {
        if (!allowList.includes(perm)) {
          allowList.push(perm);
        }
      }
      writeFileSync(settingsPath, JSON.stringify(settings, null, 2));
    }

    return true;
  }

  if (ide.mcpConfigFormat === "mcp-json") {
    let config: Record<string, any> = {};
    if (existsSync(ide.mcpConfigPath)) {
      try { config = JSON.parse(readFileSync(ide.mcpConfigPath, "utf-8")); } catch { config = {}; }
    }
    if (!config.mcpServers) config.mcpServers = {};
    if (config.mcpServers.agentcache) return false;

    if (isVscodeExtensionIde(ide)) {
      const nodeBin = findNodeBinary();
      const script = findAgentcacheScript();
      config.mcpServers.agentcache = {
        command: nodeBin,
        args: [script, "serve"],
        alwaysAllow: ALL_TOOLS,
        disabled: false,
      };
    } else {
      config.mcpServers.agentcache = {
        command: "agentcache",
        args: ["serve"],
      };
    }

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
