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
import { startOAuthFlow, completeOAuth, slackMcpClient } from "./mcp/slack-mcp-client";
import { MCPServer } from "@mastra/mcp";

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
// Register Slack MCP using toMCPServerProxies() per Mastra docs
// (reference/tools/mcp-client): spread proxies into mcpServers
// for Studio visibility. After OAuth, the real MCPServer is added
// via mastra.addMCPServer() to handle transport.
let slackProxies: Record<string, any> = {};
try {
  slackProxies = await slackMcpClient.toMCPServerProxies();
  console.log("[Slack MCP] Proxy registered — server visible in Studio");
} catch (err) {
  const message = err instanceof Error ? err.message : String(err);
  console.log(`[Slack MCP] Failed to create proxy: ${message}`);
}

// If tokens already exist (e.g. server restarted after in-memory auth),
// create the real MCPServer immediately.
try {
  const tools = await slackMcpClient.listTools();
  if (Object.keys(tools).length > 0) {
    const slackMCPServer = new MCPServer({
      id: "slack",
      name: "Slack MCP Server",
      version: "1.0.0",
      tools,
    });
    // Per Mastra docs (reference/mastra-platform/api): addMCPServer registers
    // a server that handles transport. This replaces the proxy for the 'slack' key.
    // The proxy is no longer needed once the real server is registered.
    Object.assign(slackProxies, { slack: slackMCPServer });
    console.log("[Slack MCP] Real MCPServer registered — transport endpoints available");
  }
} catch {
  // No tokens yet — proxy handles Studio visibility until OAuth completes
}

export const mastra = new Mastra({
  gateways: { featherless: featherlessGateway },
  tools: { shellTool },
  workflows: { weatherWorkflow },
  agents: { weatherAgent, builderAgent },
  mcpServers: {
    ...slackProxies,
  },
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
          try {
            const authUrl = await startOAuthFlow();
            return c.redirect(authUrl);
          } catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            return c.html(
              '<h1>Slack OAuth Error</h1>' +
              `<p>Could not start the OAuth flow: ${message}</p>` +
              '<p>Check that <code>SLACK_CLIENT_ID</code> and <code>SLACK_CLIENT_SECRET</code> are set in your environment.</p>',
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
          if (result === "AUTHORIZED") {
            // After OAuth, create a real MCPServer with Slack tools and register it.
            // Per Mastra docs, mastra.addMCPServer() dynamically registers a server
            // that handles the /mcp transport endpoint.
            try {
              const tools = await slackMcpClient.listTools();
              const slackMCPServer = new MCPServer({
                id: "slack",
                name: "Slack MCP Server",
                version: "1.0.0",
                tools,
              });
              mastra.addMCPServer(slackMCPServer, "slack");
              console.log("[Slack MCP] Real MCPServer registered — transport endpoints available");
            } catch (err) {
              console.log(`[Slack MCP] Failed to create MCPServer after OAuth: ${err instanceof Error ? err.message : String(err)}`);
            }
            return c.html(
              '<h1>Slack OAuth Complete</h1>' +
              '<p>Slack access tokens saved. Slack tools are now available.</p>',
            );
          }
          return c.html(
            '<h1>Slack OAuth Failed</h1>' +
            '<p>Token exchange did not complete. The authorization code may be invalid or expired.</p>' +
            '<p>Try visiting <a href="/oauth/authorize">/oauth/authorize</a> again to start a new flow.</p>',
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
