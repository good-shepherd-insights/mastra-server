import { Mastra } from "@mastra/core/mastra";
import { PinoLogger } from "@mastra/loggers";
import { LibSQLStore } from "@mastra/libsql";
import { MastraEditor } from "@mastra/editor";
import { createBuilderAgent } from "@mastra/editor/ee";
import { MastraModelGateway } from "@mastra/core/llm";
import type { ProviderConfig } from "@mastra/core/llm";
import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import {
  Observability,
  DefaultExporter,
  CloudExporter,
  SensitiveDataFilter,
} from "@mastra/observability";
import { weatherWorkflow } from "./workflows/weather-workflow";
import { weatherAgent } from "./agents/weather-agent";
import { shellTool } from "./tools/shell-tool";
import { registerApiRoute } from "@mastra/core/server";
import { startOAuthFlow, completeOAuth, hasSlackTokens, slackMcpClient } from "./mcp/slack-mcp-client";
import { createSlackMCPServer } from "./mcp/slack-mcp-server";

import {
  toolCallAppropriatenessScorer,
  completenessScorer,
  translationScorer,
} from "./scorers/weather-scorer";

// Featherless AI — OpenAI-compatible gateway
const FEATHERLESS_BASE_URL = "https://api.featherless.ai/v1";

class FeatherlessGateway extends MastraModelGateway {
  readonly id = "featherless" as const;
  readonly name = "Featherless AI";

  async fetchProviders(): Promise<Record<string, ProviderConfig>> {
    return {
      featherless: {
        name: "Featherless AI",
        models: ["zai-org/GLM-5.1"],
        apiKeyEnvVar: "FEATHERLESS_API_KEY",
        gateway: this.id,
        url: FEATHERLESS_BASE_URL,
      },
    };
  }

  buildUrl(): string {
    return FEATHERLESS_BASE_URL;
  }

  async getApiKey(): Promise<string> {
    const apiKey = process.env.FEATHERLESS_API_KEY;
    if (!apiKey) {
      throw new Error("Missing FEATHERLESS_API_KEY environment variable");
    }
    return apiKey;
  }

  async resolveLanguageModel({
    modelId,
    providerId,
    apiKey,
  }: {
    modelId: string;
    providerId: string;
    apiKey: string;
  }) {
    // Featherless expects the full model ID including the org prefix (e.g. "zai-org/GLM-5.1")
    // Mastra's router may split gateway-qualified IDs like "featherless/zai-org/GLM-5.1"
    // into providerId="zai-org" and modelId="GLM-5.1", so we need to rejoin them.
    // But when called with an explicit modelId like "zai-org/GLM-5.1", it's already complete.
    const fullModelId = modelId.includes('/') ? modelId : `${providerId}/${modelId}`;
    return createOpenAICompatible({
      name: providerId,
      apiKey,
      baseURL: FEATHERLESS_BASE_URL,
    }).chatModel(fullModelId);
  }
}

const featherlessGateway = new FeatherlessGateway();

export const builderAgent = createBuilderAgent({
  model: {
    id: 'featherless/zai-org/GLM-5.1',
    providerId: 'featherless',
    modelId: 'zai-org/GLM-5.1',
    apiKey: process.env.FEATHERLESS_API_KEY!,
  },
});
// Mutable MCP server registry so OAuth callback can refresh the Slack MCP server
// and tool list at runtime without requiring a process restart.
const mcpServerRegistry: Record<string, any> = {};

async function refreshSlackMcpServer(): Promise<{ ok: boolean; toolCount: number; error?: string }> {
  try {
    try {
      await slackMcpClient.reconnectServer("slack");
    } catch {
      // Ignore reconnect failures on first connect / unauthenticated states.
    }
    const server = await createSlackMCPServer();
    mcpServerRegistry.slack = server;
    const toolListInfo = await (server as any).getToolListInfo?.();
    const toolCount = Array.isArray(toolListInfo?.tools) ? toolListInfo.tools.length : 0;
    return { ok: true, toolCount };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { ok: false, toolCount: 0, error: message };
  }
}

const startupRefresh = await refreshSlackMcpServer();
if (!startupRefresh.ok) {
  console.log(`[Slack MCP] Failed to create MCPServer: ${startupRefresh.error}`);
} else if (await hasSlackTokens()) {
  if (startupRefresh.toolCount > 0) {
    console.log(`[Slack MCP] Connected — ${startupRefresh.toolCount} Slack tools available`);
  } else {
    console.log("[Slack MCP] Tokens detected, but Slack returned 0 tools");
  }
} else {
  console.log(
    "[Slack MCP] OAuth required — visit /oauth/authorize to connect (transport endpoints are available)",
  );
}

export const mastra = new Mastra({
  gateways: { featherless: featherlessGateway },
  tools: { shellTool },
  workflows: { weatherWorkflow },
  agents: { weatherAgent, builderAgent },
  mcpServers: mcpServerRegistry,
  scorers: {
    toolCallAppropriatenessScorer,
    completenessScorer,
    translationScorer,
  },
  storage: new LibSQLStore({
    id: "mastra-storage",
    // stores observability, scores, ... into persistent file storage
    url: "file:./mastra.db",
  }),
  logger: new PinoLogger({
    name: "Mastra",
    level: "info",
  }),
  server: {
    apiRoutes: [
      // Starts the OAuth flow — redirects the user to Slack's authorization page.
      registerApiRoute("/oauth/authorize", {
        method: "GET",
        requiresAuth: false,
        handler: async (c) => {
          if (await hasSlackTokens()) {
            const refreshed = await refreshSlackMcpServer();
            if (!refreshed.ok) {
              return c.html(
                `<h1>OAuth Status</h1><p>Slack tokens detected, but MCP tool refresh failed: ${refreshed.error}</p>`,
                500,
              );
            }

            if (refreshed.toolCount > 0) {
              return c.html(
                `<h1>OAuth Status</h1><p>Already connected. ${refreshed.toolCount} Slack tools are currently available.</p>`,
              );
            }

            return c.html(
              "<h1>OAuth Not Usable</h1><p>Tokens are present, but this runtime currently has 0 Slack tools. Re-run /oauth/authorize and verify Slack app scopes/installation.</p>",
              500,
            );
          }
          try {
            const authUrl = await startOAuthFlow();
            return c.redirect(authUrl);
          } catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            return c.html(
              `<h1>OAuth Error</h1><p>Failed to start OAuth flow: ${message}</p>`,
              500,
            );
          }
        },
      }),
      // Handles the OAuth callback from Slack — exchanges the code for tokens.
      registerApiRoute("/oauth/callback", {
        method: "GET",
        requiresAuth: false,
        handler: async (c) => {
          const code = c.req.query("code");
          if (!code) {
            return c.html(
              '<h1>OAuth Error</h1><p>Missing <code>code</code> query parameter.</p>',
              400,
            );
          }

          const result = await completeOAuth(code);
          if (result === "AUTHORIZED" && (await hasSlackTokens())) {
            const refreshed = await refreshSlackMcpServer();
            if (!refreshed.ok) {
              return c.html(
                `<h1>OAuth Not Usable</h1><p>Token exchange completed, but MCP tool refresh failed: ${refreshed.error}</p>`,
                500,
              );
            }

            if (refreshed.toolCount > 0) {
              return c.html(
                `<h1>OAuth Usable</h1><p>Slack MCP is usable on this runtime. Current tool count: ${refreshed.toolCount}.</p>`,
              );
            }

            return c.html(
              "<h1>OAuth Not Usable</h1><p>Token exchange completed, but this runtime still has 0 Slack tools. Treating OAuth as failed for tool access; verify scopes/installation and retry /oauth/authorize.</p>",
              500,
            );
          }
          return c.html(
            '<h1>OAuth Failed</h1><p>Could not exchange code for tokens. Check server logs.</p>',
            500,
          );
        },
      }),
    ],
  },
  editor: new MastraEditor({
    builder: {
      enabled: true,
      configuration: {
        agent: {
          models: {
            allowed: [
              { provider: "featherless", modelId: "zai-org/GLM-5.1", kind: "custom" },
            ],
            default: { provider: "featherless", modelId: "zai-org/GLM-5.1", kind: "custom" },
          },
          tools: { allowed: ["get-weather", "execute-shell"] },
          agents: { allowed: ["weather-agent"] },
          workflows: { allowed: ["weather-workflow"] },
          memory: { observationalMemory: true },
          workspace: {
            type: "inline",
            config: {
              name: "builder-workspace",
              filesystem: {
                provider: "local",
                config: { basePath: "./agent-files" },
              },
            },
          },
        },
      },
    },
  }),
  observability: new Observability({
    configs: {
      default: {
        serviceName: "mastra",
        exporters: [
          new DefaultExporter(), // Persists traces to storage for Mastra Studio
          new CloudExporter(), // Sends traces to Mastra Cloud (if MASTRA_CLOUD_ACCESS_TOKEN is set)
        ],
        spanOutputProcessors: [
          new SensitiveDataFilter(), // Redacts sensitive data like passwords, tokens, keys
        ],
      },
    },
  }),
});
