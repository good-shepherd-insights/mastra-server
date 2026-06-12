import { Mastra } from "@mastra/core/mastra";
import { PinoLogger } from "@mastra/loggers";
import { LibSQLStore } from "@mastra/libsql";
import { MastraEditor } from "@mastra/editor";
import { createBuilderAgent } from "@mastra/editor/ee";
import { authGateway } from "./gateways";
import {
  Observability,
  DefaultExporter,
  CloudExporter,
  SensitiveDataFilter,
} from "@mastra/observability";
import { weatherWorkflow } from "./workflows/weather-workflow";
import { weatherAgent } from "./agents/weather-agent";
import { shellTool } from "./tools/shell-tool";
import { registerApiRoute, MastraAuthProvider } from "@mastra/core/server";

class ApiKeyAuth extends MastraAuthProvider<{ id: string }> {
  constructor() {
    super({ name: 'api-key' });
  }
  async authenticateToken(token: string) {
    const key = process.env.AUTH_GATEWAY_API_KEY;
    return key && token === key ? { id: 'service' } : null;
  }
  async authorizeUser() {
    return true;
  }
}
import { startOAuthFlow, completeOAuth, getSlackToolsets, startSlackMCPServer } from "./mcp/slack-mcp-client";

import {
  toolCallAppropriatenessScorer,
  completenessScorer,
  translationScorer,
} from "./scorers/weather-scorer";

export const builderAgent = createBuilderAgent({
  model: 'auth-gateway/featherless/zai-org/GLM-5.1',
});
export const mastra = new Mastra({
  gateways: { 'auth-gateway': authGateway },
  tools: { shellTool },
  mcpServers: {},
  workflows: { weatherWorkflow },
  agents: { weatherAgent, builderAgent },
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
    auth: new ApiKeyAuth(),
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

          try {
            await completeOAuth(code);
            await startSlackMCPServer(mastra);
            return c.html(
              '<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>*{margin:0;padding:0;box-sizing:border-box}body{font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;background:#0a0a0a;color:#e5e5e5;display:flex;align-items:center;justify-content:center;min-height:100vh}.card{background:#1a1a1a;border:1px solid #2a2a2a;border-radius:12px;padding:48px;text-align:center;max-width:420px;width:90%}h1{font-size:24px;margin-bottom:8px;color:#fff}p{font-size:15px;color:#a0a0a0;margin-bottom:32px}button{background:#fff;color:#0a0a0a;border:none;border-radius:8px;padding:12px 32px;font-size:15px;font-weight:600;cursor:pointer;transition:opacity .2s}button:hover{opacity:.85}</style></head><body><div class="card"><h1>Slack Connected</h1><p>Slack access tokens saved. Tools are now available.</p><button onclick="window.close()">Close</button></div></body></html>',
            );
          } catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            return c.html(
              '<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>*{margin:0;padding:0;box-sizing:border-box}body{font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;background:#0a0a0a;color:#e5e5e5;display:flex;align-items:center;justify-content:center;min-height:100vh}.card{background:#1a1a1a;border:1px solid #2a2a2a;border-radius:12px;padding:48px;text-align:center;max-width:420px;width:90%}h1{font-size:24px;margin-bottom:8px;color:#fff}p{font-size:15px;color:#a0a0a0;margin-bottom:32px}button{background:#fff;color:#0a0a0a;border:none;border-radius:8px;padding:12px 32px;font-size:15px;font-weight:600;cursor:pointer;transition:opacity .2s}button:hover{opacity:.85}</style></head><body><div class="card"><h1>Slack OAuth Failed</h1><p>' + message + '</p><button onclick="window.close()">Close</button></div></body></html>',
              500,
            );
          }
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
            default: { kind: 'custom', provider: 'featherless', modelId: 'zai-org/GLM-5.1' },
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

// If a saved OAuth token exists from a previous session, register the native Slack MCPServer now.
await startSlackMCPServer(mastra);
