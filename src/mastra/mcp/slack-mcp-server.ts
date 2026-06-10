import { MCPServer } from "@mastra/mcp";
import { slackMcpClient } from "./slack-mcp-client.js";

/**
 * Creates an MCPServer that exposes Slack MCP tools via the
 * streamable HTTP transport endpoint (/api/mcp/slack/mcp).
 *
 * MCPClientServerProxy (from toMCPServerProxies()) only supports
 * the REST tool-list/execute API. A real MCPServer is needed
 * to handle MCP transport protocol connections.
 *
 * @see https://mastra.ai/reference/tools/mcp-server
 */
export async function createSlackMCPServer(): Promise<MCPServer> {
  const tools = await slackMcpClient.listTools();

  return new MCPServer({
    id: "slack",
    name: "Slack MCP Server",
    version: "1.0.0",
    description:
      "Slack workspace tools — send messages, search, read channels, and more. Requires OAuth.",
    tools,
  });
}
