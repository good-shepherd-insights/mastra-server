import { MCPClient, MCPOAuthClientProvider } from "@mastra/mcp";
import { auth } from "@modelcontextprotocol/sdk/client/auth.js";
import { FileOAuthStorage } from "./oauth-storage.js";

const SLACK_MCP_URL = "https://mcp.slack.com/mcp";
const REDIRECT_URL =
  process.env.SLACK_OAUTH_REDIRECT_URL ?? "http://localhost:4111/oauth/callback";
const DEFAULT_OAUTH_STORAGE_PATH = `${process.cwd()}/.oauth/slack.json`;
const OAUTH_STORAGE_PATH = process.env.SLACK_OAUTH_STORAGE_PATH ?? DEFAULT_OAUTH_STORAGE_PATH;

// IMPORTANT: must NOT live inside .mastra/ — Mastra's bundler empties that
// directory on every `mastra dev` start, which deletes saved tokens.
// In production, this path must be on persistent storage (e.g. Render disk mount).
if (process.env.NODE_ENV === "production" && !process.env.SLACK_OAUTH_STORAGE_PATH) {
  console.warn(
    `[Slack MCP] SLACK_OAUTH_STORAGE_PATH is not set. Tokens are stored at ${DEFAULT_OAUTH_STORAGE_PATH}, which may be ephemeral across deploys/restarts.`,
  );
}
const storage = new FileOAuthStorage(OAUTH_STORAGE_PATH);

let pendingAuthUrl: string | null = null;

export { storage };

/**
 * OAuth provider handles the full OAuth 2.1 + PKCE flow including dynamic
 * client registration, token persistence, and refresh.
 */
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
  storage,
  onRedirectToAuthorization: (url) => {
    pendingAuthUrl = url.toString();
    console.log(`[Slack MCP] OAuth required. Visit:\n${url}`);
  },
});

// Custom logger that suppresses connection error spam before OAuth
const silentLogger: import("@mastra/mcp").LogHandler = (msg) => {
  // Suppress all error/fatal/warn logs that are connection-related
  if (['error', 'fatal', 'warn'].includes(msg.level)) {
    const str = JSON.stringify(msg);
    if (str.includes('connect') || str.includes('MCP') || str.includes('Unauthorized') || str.includes('401')) {
      return; // Silently drop connection errors
    }
  }
  // Only log info/debug or non-connection errors
  if (msg.level === 'info' || msg.level === 'debug') {
    console.log(`[MCP] ${msg.level}: ${msg.message}`);
  }
};

export const slackMcpClient = new MCPClient({
  id: "slack-mcp-client",
  servers: {
    slack: {
      url: new URL(SLACK_MCP_URL),
      authProvider: oauthProvider,
      enableServerLogs: false,
      logger: silentLogger,
    },
  },
});

/**
 * Completes the OAuth flow by exchanging the authorization code for tokens.
 * Called from the /oauth/callback route handler.
 *
 * This calls the MCP SDK's `auth()` function with the authorization code,
 * which exchanges it for access tokens and saves them to the FileOAuthStorage.
 * After calling this, the Slack MCP client will connect successfully on next use.
 */
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

/**
 * Initiates the OAuth flow by calling the MCP SDK's `auth()` function.
 * This triggers dynamic client registration (if needed) and redirects to
 * the authorization URL. The resulting URL is stored for the callback handler.
 *
 * Returns the authorization URL the user should visit.
 */
export async function startOAuthFlow(): Promise<string> {
  let result: 'AUTHORIZED' | 'REDIRECT';
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
  // auth() returns "REDIRECT" when onRedirectToAuthorization is called.
  // The URL was captured by the callback and stored in pendingAuthUrl.
  if (result === 'REDIRECT') {
    return pendingAuthUrl ?? (function() {
      throw new Error('OAuth flow returned REDIRECT but no URL was captured. This is a bug.');
    })();
  }
  // If we got here without REDIRECT, something unexpected happened
  throw new Error('OAuth flow returned AUTHORIZED unexpectedly.');
}

/** Check whether valid OAuth tokens are already stored. */
export async function hasSlackTokens(): Promise<boolean> {
  const tokens = await oauthProvider.tokens();
  return !!tokens?.access_token;
}
