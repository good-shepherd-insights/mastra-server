import { Mastra } from "@mastra/core/mastra";
import { PinoLogger } from "@mastra/loggers";
import { LibSQLStore } from "@mastra/libsql";
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
import { AgentId, ProviderId } from "./config/index.js";
import { startSlackMCPServer } from "./mcp/slack-mcp-client.js";
import { createOAuthRoutes } from "./routes/oauth.js";

export const mastra: Mastra = new Mastra({
  gateways: { 'auth-gateway': authGateway },
  tools: { shellTool },
  mcpServers: {},
  agents: { researchManager, operationsManager, qaManager },
  storage: new LibSQLStore({
    id: "mastra-storage",
    url: "file:./mastra.db",
  }),
  logger: new PinoLogger({
    name: "Mastra",
    level: "info",
  }),
  server: {
    auth: new SimpleAuth({
      tokens: {
        [process.env.AUTH_GATEWAY_API_KEY!]: {
          id: 'service',
          name: 'Service',
          role: 'admin',
        },
      },
    }),
    apiRoutes: createOAuthRoutes(() => mastra),
  },
  editor: new MastraEditor({
    builder: {
      enabled: true,
      configuration: {
        agent: {
          models: {
            default: { kind: 'custom', provider: ProviderId.FEATHERLESS, modelId: 'zai-org/GLM-5.1' },
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
