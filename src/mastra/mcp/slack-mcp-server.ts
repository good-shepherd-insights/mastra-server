import { MCPServer } from "@mastra/mcp";
import { slackMcpClient } from "./slack-mcp-client.js";
const SLACK_SERVER_ID = "slack";
const SLACK_SERVER_NAME = "Slack MCP Server";
const SLACK_SERVER_VERSION = "1.0.0";
const SLACK_SERVER_DESCRIPTION =
  "Slack workspace tools — send messages, search, read channels, and more. Requires OAuth.";

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
export function createSlackMCPServer(): MCPServer {

  return new MCPServer({
    id: SLACK_SERVER_ID,
    name: SLACK_SERVER_NAME,
    version: SLACK_SERVER_VERSION,
    description: SLACK_SERVER_DESCRIPTION,
    tools: {},
  });
}

/**
 * Refreshes the tool registry of an already-registered Slack MCPServer instance.
 *
 * Mastra snapshots the mcpServers map during Mastra construction, so replacing
 * the object later has no effect. This updates the existing server in place.
 */
export async function refreshSlackMCPServerTools(server: MCPServer): Promise<number> {
  const tools = await slackMcpClient.listTools();
  server.convertedTools = server.convertTools(tools);
  return await getSlackMCPServerToolCount(server);
}

export async function getSlackMCPServerToolCount(server: MCPServer): Promise<number> {
  const toolListInfo = await server.getToolListInfo();
  return Array.isArray(toolListInfo?.tools) ? toolListInfo.tools.length : 0;
}
