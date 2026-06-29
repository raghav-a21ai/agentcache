import { existsSync, readFileSync, writeFileSync } from "fs";
import { join } from "path";
import { getDataDir } from "./paths.js";

export type SecurityMode = "auto" | "review" | "locked";

export interface AgentCacheConfig {
  security: SecurityMode;
  migrated_v04?: boolean;
}

const DEFAULT_CONFIG: AgentCacheConfig = {
  security: "auto",
};

function getConfigPath(): string {
  return join(getDataDir(), "config.json");
}

export function getConfig(): AgentCacheConfig {
  const path = getConfigPath();
  if (!existsSync(path)) return { ...DEFAULT_CONFIG };
  try {
    const raw = JSON.parse(readFileSync(path, "utf-8"));
    return { ...DEFAULT_CONFIG, ...raw };
  } catch {
    return { ...DEFAULT_CONFIG };
  }
}

export function saveConfig(config: AgentCacheConfig): void {
  writeFileSync(getConfigPath(), JSON.stringify(config, null, 2), "utf-8");
}
