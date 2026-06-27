import {
  BedrockRuntimeClient,
  InvokeModelCommand,
} from "@aws-sdk/client-bedrock-runtime";

const client = new BedrockRuntimeClient({ region: "us-east-1" });
const MODEL_ID = "us.anthropic.claude-sonnet-4-6-v1";

export interface ClaudeResponse {
  text: string;
  inputTokens: number;
  outputTokens: number;
}

export interface ClaudeOptions {
  system?: string;
  maxTokens?: number;
}

export async function callClaude(
  prompt: string,
  options: ClaudeOptions = {}
): Promise<ClaudeResponse> {
  const { system, maxTokens = 4096 } = options;

  const body: Record<string, unknown> = {
    anthropic_version: "bedrock-2023-05-31",
    max_tokens: maxTokens,
    messages: [{ role: "user", content: prompt }],
  };

  if (system) {
    body.system = system;
  }

  const command = new InvokeModelCommand({
    modelId: MODEL_ID,
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
