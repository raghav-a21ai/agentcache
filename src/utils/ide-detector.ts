import { existsSync } from "fs";
import { join } from "path";
import { homedir } from "os";

export interface IdeConfig {
  name: string;
  detected: boolean;
  mcpConfigPath: string;
  mcpConfigFormat: "claude-settings" | "mcp-json" | "yaml";
}

export function detectInstalledIdes(): IdeConfig[] {
  const home = homedir();
  return [
    {
      name: "Claude Code",
      detected: existsSync(join(home, ".claude")),
      mcpConfigPath: join(home, ".claude", "settings.json"),
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
      detected: existsSync(join(home, ".roo")),
      mcpConfigPath: join(home, ".roo", "mcp.json"),
      mcpConfigFormat: "mcp-json",
    },
    {
      name: "Windsurf",
      detected: existsSync(join(home, ".windsurf")),
      mcpConfigPath: join(home, ".windsurf", "mcp.json"),
      mcpConfigFormat: "mcp-json",
    },
    {
      name: "Continue",
      detected: existsSync(join(home, ".continue")),
      mcpConfigPath: join(home, ".continue", "mcp.json"),
      mcpConfigFormat: "mcp-json",
    },
    {
      name: "Codex",
      detected: existsSync(join(home, ".codex")),
      mcpConfigPath: join(home, ".codex", "mcp.json"),
      mcpConfigFormat: "mcp-json",
    },
  ];
}
