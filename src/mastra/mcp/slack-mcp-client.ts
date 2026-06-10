import { MCPClient, MCPOAuthClientProvider, auth } from "@mastra/mcp";

const SLACK_MCP_URL = "https://mcp.slack.com/mcp";
const REDIRECT_URL =
  process.env.SLACK_OAUTH_REDIRECT_URL ?? "http://localhost:4111/oauth/callback";

let pendingAuthUrl: string | null = null;

// Per Mastra docs (reference/tools/mcp-client), omitting storage
// defaults to InMemoryOAuthStorage. No custom storage needed.
export const oauthProvider = new MCPOAuthClientProvider({
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
  onRedirectToAuthorization: (url) => {
    pendingAuthUrl = url.toString();
    console.log(`[Slack MCP] OAuth required. Visit:\n${url}`);
  },
});

export const slackMcpClient = new MCPClient({
  id: "slack-mcp-client",
  servers: {
    slack: {
      url: new URL(SLACK_MCP_URL),
      authProvider: oauthProvider,
    },
  },
});

export async function completeOAuth(code: string): Promise<"AUTHORIZED"> {
  const result = await auth(oauthProvider, {
    serverUrl: SLACK_MCP_URL,
    authorizationCode: code,
  });

  if (result !== "AUTHORIZED") {
    throw new Error(
      `OAuth flow did not complete successfully. Result: ${result}. ` +
      "The authorization code may be invalid or expired."
    );
  }

  pendingAuthUrl = null;
  console.log("[Slack MCP] OAuth complete. Tokens saved.");
  return result;
}

export async function startOAuthFlow(): Promise<string> {
  let result: "AUTHORIZED" | "REDIRECT";
  try {
    result = await auth(oauthProvider, {
      serverUrl: SLACK_MCP_URL,
    });
  } catch (e) {
    const err = e instanceof Error ? e : new Error(String(e));
    console.error(`[Slack MCP] OAuth discovery/auth failed:`, err.message);
    throw new Error(
      `OAuth flow failed: ${err.message}. Check your SLACK_CLIENT_ID and SLACK_CLIENT_SECRET.`
    );
  }
  if (result === "REDIRECT") {
    return pendingAuthUrl ?? (function() {
      throw new Error("OAuth flow returned REDIRECT but no URL was captured. This is a bug.");
    })();
  }
  throw new Error("OAuth flow returned AUTHORIZED unexpectedly.");
}
