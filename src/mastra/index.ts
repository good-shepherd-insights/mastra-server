import { Mastra } from "@mastra/core/mastra";
import { PinoLogger } from "@mastra/loggers";
import { PostgresStore } from "@mastra/pg";
import { MastraEditor } from "@mastra/editor";
import { SimpleAuth } from "@mastra/core/server";
import {
  Observability,
  DefaultExporter,
  CloudExporter,
  SensitiveDataFilter,
} from "@mastra/observability";
import { authGateway } from "./gateways/index.js";
import { researchManager, operationsManager, qaManager } from "./agents/index.js";
import { shellTool } from "./tools/index.js";
import { AgentId, ProviderId, PROVIDER_REGISTRY } from "./config/index.js";
import { startSlackMCPServer, slackOAuthHandlers } from "./mcp/slack/index.js";
import { createMCPOAuthRoutes } from "./mcp/oauth/routes.js";

const authToken = process.env.AUTH_GATEWAY_API_KEY;
if (!authToken) throw new Error('AUTH_GATEWAY_API_KEY environment variable is required.');

export const mastra: Mastra = new Mastra({
  gateways: { 'auth-gateway': authGateway },
  tools: { shellTool },
  agents: { researchManager, operationsManager, qaManager },
  storage: new PostgresStore({
    id: "mastra-storage",
    connectionString: process.env.DATABASE_URL!,
  }),
  logger: new PinoLogger({
    name: "Mastra",
    level: "info",
  }),
  server: {
    auth: new SimpleAuth({
      tokens: {
        [authToken]: {
          id: 'service',
          name: 'Service',
          role: 'admin',
        },
      },
    }),
    apiRoutes: createMCPOAuthRoutes('slack', slackOAuthHandlers, () => mastra),
  },
  editor: new MastraEditor({
    builder: {
      enabled: true,
      configuration: {
        agent: {
          models: {
            default: { kind: 'custom', provider: ProviderId.FEATHERLESS, modelId: PROVIDER_REGISTRY[ProviderId.FEATHERLESS].models[0] },
          },
          tools: { allowed: ["execute-shell"] },
          agents: { allowed: [AgentId.RESEARCH_MANAGER, AgentId.OPERATIONS_MANAGER, AgentId.QA_MANAGER] },
          memory: { observationalMemory: true },
        },
      },
    },
  }),
  observability: new Observability({
    configs: {
      default: {
        serviceName: "mastra",
        exporters: [
          new DefaultExporter(),
          new CloudExporter(),
        ],
        spanOutputProcessors: [
          new SensitiveDataFilter(),
        ],
      },
    },
  }),
});

// If a saved OAuth token exists from a previous session, register the native Slack MCPServer now.
await startSlackMCPServer(mastra);
