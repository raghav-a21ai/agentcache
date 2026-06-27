import { existsSync, readFileSync } from "fs";
import { join } from "path";
import { homedir } from "os";

export interface ClaudeResponse {
  text: string;
  inputTokens: number;
  outputTokens: number;
}

export interface ClaudeOptions {
  system?: string;
  maxTokens?: number;
}

interface LoopConfig {
  apiKey?: string;
  provider?: "anthropic" | "bedrock";
  bedrockRegion?: string;
  model?: string;
}

function loadConfig(): LoopConfig {
  const configPath = join(homedir(), ".loop", "config.json");
  if (!existsSync(configPath)) return {};
  try {
    return JSON.parse(readFileSync(configPath, "utf-8"));
  } catch {
    return {};
  }
}

export async function callClaude(
  prompt: string,
  options: ClaudeOptions = {}
): Promise<ClaudeResponse> {
  const config = loadConfig();
  const { system, maxTokens = 4096 } = options;

  if (config.apiKey) {
    return callAnthropic(prompt, system, maxTokens, config);
  }
  return callBedrock(prompt, system, maxTokens, config);
}

async function callAnthropic(
  prompt: string,
  system: string | undefined,
  maxTokens: number,
  config: LoopConfig
): Promise<ClaudeResponse> {
  const model = config.model || "claude-sonnet-4-6-20250514";

  const body: Record<string, unknown> = {
    model,
    max_tokens: maxTokens,
    messages: [{ role: "user", content: prompt }],
  };
  if (system) body.system = system;

  const response = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": config.apiKey!,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Anthropic API error ${response.status}: ${text}`);
  }

  const data = await response.json() as any;
  return {
    text: data.content[0].text,
    inputTokens: data.usage?.input_tokens ?? 0,
    outputTokens: data.usage?.output_tokens ?? 0,
  };
}

async function callBedrock(
  prompt: string,
  system: string | undefined,
  maxTokens: number,
  config: LoopConfig
): Promise<ClaudeResponse> {
  const {
    BedrockRuntimeClient,
    InvokeModelCommand,
  } = await import("@aws-sdk/client-bedrock-runtime");

  const region = config.bedrockRegion || "us-east-1";
  const modelId = config.model || "us.anthropic.claude-sonnet-4-6";

  const client = new BedrockRuntimeClient({ region });

  const body: Record<string, unknown> = {
    anthropic_version: "bedrock-2023-05-31",
    max_tokens: maxTokens,
    messages: [{ role: "user", content: prompt }],
  };
  if (system) body.system = system;

  const command = new InvokeModelCommand({
    modelId,
    contentType: "application/json",
    accept: "application/json",
    body: JSON.stringify(body),
  });

  const response = await client.send(command);
  const responseBody = JSON.parse(new TextDecoder().decode(response.body));

  return {
    text: responseBody.content[0].text,
    inputTokens: responseBody.usage?.input_tokens ?? 0,
    outputTokens: responseBody.usage?.output_tokens ?? 0,
  };
}
