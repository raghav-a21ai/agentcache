import { existsSync } from "fs";
import { join } from "path";
import { homedir } from "os";

export interface IdeConfig {
  name: string;
  detected: boolean;
  mcpConfigPath: string;
  mcpConfigFormat: "claude-settings" | "mcp-json" | "continue-dir" | "codex-toml";
}

function getRooConfigPath(): string {
  const home = homedir();
  if (process.platform === "darwin") {
    return join(home, "Library/Application Support/Code/User/globalStorage/rooveterinaryinc.roo-cline/settings/mcp_settings.json");
  }
  if (process.platform === "win32") {
    return join(process.env.APPDATA || join(home, "AppData/Roaming"), "Code/User/globalStorage/rooveterinaryinc.roo-cline/settings/mcp_settings.json");
  }
  return join(home, ".config/Code/User/globalStorage/rooveterinaryinc.roo-cline/settings/mcp_settings.json");
}

function getWindsurfConfigPath(): string {
  const home = homedir();
  return join(home, ".codeium", "windsurf", "mcp_config.json");
}

function getContinueConfigPath(): string {
  const home = homedir();
  return join(home, ".continue", "mcpServers", "agentcache.json");
}

function getCodexConfigPath(): string {
  const home = homedir();
  return join(home, ".codex", "config.toml");
}

export function detectInstalledIdes(): IdeConfig[] {
  const home = homedir();
  return [
    {
      name: "Claude Code",
      detected: existsSync(join(home, ".claude")),
      mcpConfigPath: join(home, ".claude.json"),
      mcpConfigFormat: "claude-settings",
    },
    {
      name: "Cursor",
      detected: existsSync(join(home, ".cursor")),
      mcpConfigPath: join(home, ".cursor", "mcp.json"),
      mcpConfigFormat: "mcp-json",
    },
    {
      name: "Roo Code",
      detected: existsSync(getRooConfigPath()),
      mcpConfigPath: getRooConfigPath(),
      mcpConfigFormat: "mcp-json",
    },
    {
      name: "Windsurf",
      detected: existsSync(join(home, ".codeium", "windsurf")) || existsSync(join(home, ".windsurf")),
      mcpConfigPath: getWindsurfConfigPath(),
      mcpConfigFormat: "mcp-json",
    },
    {
      name: "Continue",
      detected: existsSync(join(home, ".continue")),
      mcpConfigPath: getContinueConfigPath(),
      mcpConfigFormat: "continue-dir",
    },
    {
      name: "Codex",
      detected: existsSync(join(home, ".codex")),
      mcpConfigPath: getCodexConfigPath(),
      mcpConfigFormat: "codex-toml",
    },
  ];
}
