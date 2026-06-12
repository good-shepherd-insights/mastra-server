import {
  MCPClient,
  MCPOAuthClientProvider,
  MCPServer,
  createSimpleTokenProvider,
  auth,
} from "@mastra/mcp";
import { LibSQLOAuthStorage } from "../oauth/storage.js";
import { monitor } from "../../utils/monitor.js";
import type { MCPOAuthHandlers } from "../oauth/routes.js";

const SLACK_MCP_URL = "https://mcp.slack.com/mcp";
const REDIRECT_URL =
  process.env.SLACK_OAUTH_REDIRECT_URL ?? "http://localhost:4111/oauth/slack/callback";

// Bot scopes required by Slack's MCP server for canvases, lists, and remote files access.
// These must match the scopes configured in your Slack app manifest under oauth_config.scopes.bot.
const SLACK_BOT_SCOPE_STRING = "canvases:read canvases:write lists:read lists:write remote_files:read";

const oauthStorage = new LibSQLOAuthStorage("slack-mcp", {
  url: process.env.SLACK_OAUTH_DATABASE_URL ?? "file:./mastra-oauth.db",
  authToken: process.env.SLACK_OAUTH_DATABASE_AUTH_TOKEN,
});

let pendingAuthUrl: string | null = null;

// Per Mastra docs Pattern 2: MCPOAuthClientProvider for OAuth
const oauthProvider = new MCPOAuthClientProvider({
  redirectUrl: REDIRECT_URL,
  clientMetadata: {
    redirect_uris: [REDIRECT_URL],
    client_name: "Mastra Slack MCP Client",
    grant_types: ["authorization_code", "refresh_token"],
    response_types: ["code"],
  },
  clientInformation: {
    client_id: process.env.SLACK_CLIENT_ID!,
    client_secret: process.env.SLACK_CLIENT_SECRET!,
  },
  storage: oauthStorage,
  onRedirectToAuthorization: (url) => {
    pendingAuthUrl = url.toString();
    monitor.slackMcp("oauth-redirect", url.toString());
  },
});

// Per Mastra docs Pattern 4: createSimpleTokenProvider for token rehydration.
// Both awaits are wrapped: DB failure at startup should degrade gracefully, not crash the server.
let _savedToken: string | undefined;
try {
  _savedToken = await oauthStorage.get("tokens");
} catch (err) {
  monitor.slackMcp("storage-read-failed", err instanceof Error ? err.message : String(err));
}

let _accessToken: string | undefined;
if (_savedToken) {
  try {
    _accessToken = JSON.parse(_savedToken)?.access_token;
  } catch {
    monitor.slackMcp("token-parse-failed", "stored token is malformed JSON — OAuth re-flow required");
  }
}

const authProvider = _accessToken
  ? createSimpleTokenProvider(_accessToken, {
      redirectUrl: REDIRECT_URL,
      clientMetadata: {
        redirect_uris: [REDIRECT_URL],
        client_name: "Mastra Slack MCP Client",
      },
      scope: SLACK_BOT_SCOPE_STRING,
    })
  : oauthProvider;

if (_accessToken) {
  monitor.slackMcp("token-reused");
}

// Per Mastra docs Pattern 2: MCPClient with url + authProvider
export const slackMcpClient = new MCPClient({
  servers: {
    slack: {
      url: new URL(SLACK_MCP_URL),
      authProvider,
    },
  },
});

// Per Mastra docs Pattern 1: listToolsets() for dynamic per-request tool resolution.
// listTools() freezes at boot with empty tools when no auth token exists yet.
// listToolsets() fetches tools live from the MCP server on each call,
// so it picks up fresh tokens from storage after OAuth completes.
export const getSlackToolsets = () => slackMcpClient.listToolsets();

// Lazy MCPServer construction: only instantiate after OAuth token is available.
// Call after Mastra construction (for rehydration) and after OAuth completes.
export async function startSlackMCPServer(
  mastra: import("@mastra/core/mastra").Mastra,
): Promise<void> {
  const token = await oauthStorage.get("tokens");
  if (!token) return;

  const slackTools = await slackMcpClient.listTools().catch(() => null);
  if (!slackTools || Object.keys(slackTools).length === 0) return;

  try {
    mastra.addMCPServer(
      new MCPServer({
        id: "slack",
        name: "Slack MCP",
        version: "1.0.0",
        tools: slackTools,
      }),
    );
  } catch (err) {
    monitor.slackMcp("register-failed", err instanceof Error ? err.message : String(err));
  }
}

export const slackOAuthHandlers: MCPOAuthHandlers = {
  async startFlow(): Promise<string> {
    if (pendingAuthUrl !== null) {
      throw new Error(
        "An OAuth flow is already in progress. Complete or cancel the existing flow before starting a new one.",
      );
    }

    await oauthStorage.delete("tokens");
    await oauthStorage.delete("code_verifier");

    let result: "AUTHORIZED" | "REDIRECT";
    try {
      result = await auth(oauthProvider, {
        serverUrl: SLACK_MCP_URL,
        scope: SLACK_BOT_SCOPE_STRING,
      });
    } catch (e) {
      const err = e instanceof Error ? e : new Error(String(e));
      monitor.slackMcp("oauth-discovery-failed", err.message);
      throw new Error(
        `OAuth flow failed: ${err.message}. Check your SLACK_CLIENT_ID and SLACK_CLIENT_SECRET.`,
      );
    }

    if (result === "REDIRECT") {
      return pendingAuthUrl ?? (() => {
        throw new Error("OAuth flow returned REDIRECT but no URL was captured. This is a bug.");
      })();
    }
    throw new Error("OAuth flow returned AUTHORIZED unexpectedly.");
  },

  async completeFlow(
    code: string,
    getMastra: () => import("@mastra/core/mastra").Mastra,
  ): Promise<void> {
    const result = await auth(oauthProvider, {
      serverUrl: SLACK_MCP_URL,
      authorizationCode: code,
      scope: SLACK_BOT_SCOPE_STRING,
    });

    if (result !== "AUTHORIZED") {
      throw new Error(
        `OAuth flow did not complete successfully. Result: ${result}. ` +
        "The authorization code may be invalid or expired.",
      );
    }

    pendingAuthUrl = null;
    monitor.slackMcp("oauth-complete");
    await startSlackMCPServer(getMastra());
  },
};
