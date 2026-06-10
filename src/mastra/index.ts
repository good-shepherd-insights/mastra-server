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
import { oauthProvider, startOAuthFlow, completeOAuth, hasSlackTokens, slackMcpClient } from "./mcp/slack-mcp-client";

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
// Mutable registry for dynamic MCP server registration.
const mcpServerRegistry: Record<string, any> = {};

// Always attempt to register Slack MCP so it appears in Studio.
// Connection errors (401 from missing tokens) are caught and logged as info.
// Wrap proxy to suppress connection error logs from Studio polling.
// Preserves prototype chain by wrapping methods on the original object.
function wrapSlackProxy(proxy: any) {
  const methodsToWrap = ['fetchToolList', 'fetchToolInfo', 'executeTool', 'fetchResourceList', 'fetchPromptList'];
  
  for (const method of methodsToWrap) {
    if (typeof proxy[method] === 'function') {
      const original = proxy[method].bind(proxy);
      Object.defineProperty(proxy, method, {
        value: async (...args: any[]) => {
          try {
            return await original(...args);
          } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            if (msg.includes('Unauthorized') || msg.includes('401') || msg.includes('Could not connect')) {
              // Return empty result instead of throwing to suppress Mastra ERROR logs
              if (method === 'fetchToolList') return { tools: [] };
              if (method === 'fetchResourceList') return { resources: [] };
              if (method === 'fetchPromptList') return { prompts: [] };
              return null;
            }
            throw err;
          }
        },
        writable: true,
        configurable: true,
      });
    }
  }
  return proxy;
}

try {
  const proxies = await slackMcpClient.toMCPServerProxies();
  if (proxies.slack) {
    mcpServerRegistry.slack = wrapSlackProxy(proxies.slack);
  }
  if (await hasSlackTokens()) {
    console.log("[Slack MCP] Connected — tools available in Studio");
  } else {
    console.log("[Slack MCP] OAuth required — visit /oauth/authorize to connect");
  }
} catch (err) {
  // Suppress auth/connection errors — user just needs to complete OAuth
  const message = err instanceof Error ? err.message : String(err);
  if (message.includes("unauthorized") || message.includes("401") || message.includes("connect")) {
    console.log("[Slack MCP] OAuth required — visit /oauth/authorize to connect");
  } else {
    console.log("[Slack MCP] Connection pending — visit /oauth/authorize to connect");
  }
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
            // Tokens saved — ensure Slack MCP proxy is registered.
            // If it wasn't registered at startup (due to missing tokens), add it now.
            if (!mcpServerRegistry.slack) {
              try {
                const proxies = await slackMcpClient.toMCPServerProxies();
                if (proxies.slack) {
                  mcpServerRegistry.slack = wrapSlackProxy(proxies.slack);
                }
                console.log("[Slack MCP] Connected after OAuth — tools available");
              } catch (err) {
                console.log("[Slack MCP] OAuth completed but proxy registration failed — restart server");
              }
            }
            return c.html(
              '<h1>OAuth Complete</h1><p>Slack MCP connected. Tools are now available in Studio.</p>',
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
