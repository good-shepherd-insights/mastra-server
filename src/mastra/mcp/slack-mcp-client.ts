import { MCPClient, MCPOAuthClientProvider, MCPServer, OAuthStorage, createSimpleTokenProvider, auth } from "@mastra/mcp";
import { createClient, type Client } from "@libsql/client";

const SLACK_MCP_URL = "https://mcp.slack.com/mcp";
const REDIRECT_URL =
  process.env.SLACK_OAUTH_REDIRECT_URL ?? "http://localhost:4111/oauth/callback";

// Bot scopes required by Slack's MCP server for canvases, lists, and remote files access.
// These must match the scopes configured in your Slack app manifest under oauth_config.scopes.bot.
const SLACK_BOT_SCOPES = [
  "canvases:read",
  "canvases:write",
  "lists:read",
  "lists:write",
  "remote_files:read",
] as const;
const SLACK_BOT_SCOPE_STRING = SLACK_BOT_SCOPES.join(" ");
const DATABASE_URL = process.env.SLACK_OAUTH_DATABASE_URL ?? "file:./mastra-oauth.db";
const DATABASE_AUTH_TOKEN = process.env.SLACK_OAUTH_DATABASE_AUTH_TOKEN;

// Per Mastra docs Pattern 3: implement OAuthStorage backed by a database.
// Uses the same libsql DB the project's LibSQLStore is configured against.
class LibSQLOAuthStorage implements OAuthStorage {
  private ready: Promise<void>;
  constructor(private client: Client, private userId: string) {
    this.ready = this.init();
  }

  private async init(): Promise<void> {
    await this.client.execute(
      `CREATE TABLE IF NOT EXISTS oauth_tokens (
         user_id TEXT NOT NULL,
         key TEXT NOT NULL,
         value TEXT NOT NULL,
         PRIMARY KEY (user_id, key)
       )`
    );
  }

  async set(key: string, value: string): Promise<void> {
    await this.ready;
    await this.client.execute({
      sql: `INSERT INTO oauth_tokens (user_id, key, value) VALUES (?, ?, ?)
            ON CONFLICT(user_id, key) DO UPDATE SET value = excluded.value`,
      args: [this.userId, key, value],
    });
  }

  async get(key: string): Promise<string | undefined> {
    await this.ready;
    const rs = await this.client.execute({
      sql: `SELECT value FROM oauth_tokens WHERE user_id = ? AND key = ?`,
      args: [this.userId, key],
    });
    const row = rs.rows[0];
    return row ? String(row.value) : undefined;
  }

  async delete(key: string): Promise<void> {
    await this.ready;
    await this.client.execute({
      sql: `DELETE FROM oauth_tokens WHERE user_id = ? AND key = ?`,
      args: [this.userId, key],
    });
  }
}

const libsqlClient = createClient({ url: DATABASE_URL, authToken: DATABASE_AUTH_TOKEN });
const oauthStorage = new LibSQLOAuthStorage(libsqlClient, "slack-mcp");
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
  // Per Mastra docs: onRedirectToAuthorization handles sending user to Slack's auth page
  onRedirectToAuthorization: (url) => {
    pendingAuthUrl = url.toString();
    console.log(`[Slack MCP] OAuth required. Visit: ${url}`);
  },
});

// Per Mastra docs Pattern 4: createSimpleTokenProvider for token rehydration
const savedToken = await oauthStorage.get("tokens");
const authProvider = savedToken
  ? createSimpleTokenProvider(JSON.parse(savedToken).access_token, {
      redirectUrl: REDIRECT_URL,
      clientMetadata: {
        redirect_uris: [REDIRECT_URL],
        client_name: "Mastra Slack MCP Client",
      },
      scope: SLACK_BOT_SCOPE_STRING,
    })
  : oauthProvider;

if (savedToken) {
  console.log("[Slack MCP] Found saved token — reusing session.");
}

// Per Mastra docs Pattern 2: MCPClient with url + authProvider
export const slackMcpClient = new MCPClient({
  servers: {
    slack: {
      url: new URL(SLACK_MCP_URL),
      authProvider: authProvider,
    },
  },
});

// Per Mastra docs Pattern 1: listToolsets() for dynamic per-request tool resolution.
// listTools() freezes at boot with empty tools when no auth token exists yet.
// listToolsets() fetches tools live from the MCP server on each call,
// so it picks up fresh tokens from storage after OAuth completes.
// Use this in agent.stream()/generate() calls via the `toolsets` option.
export const getSlackToolsets = () => slackMcpClient.listToolsets();

// Lazy MCPServer construction: only instantiate after OAuth token is available.
// Call after Mastra construction (for rehydration) and after OAuth completes.
export async function startSlackMCPServer(mastra: import("@mastra/core/mastra").Mastra): Promise<void> {
  const token = await oauthStorage.get("tokens");
  if (!token) return;

  const slackTools = await slackMcpClient.listTools().catch(() => null);
  if (!slackTools || Object.keys(slackTools).length === 0) return;

  try {
    mastra.addMCPServer(new MCPServer({
      id: "slack",
      name: "Slack MCP",
      version: "1.0.0",
      tools: slackTools,
    }));
  } catch {}
}

export async function completeOAuth(code: string): Promise<"AUTHORIZED"> {
  const result = await auth(oauthProvider, {
    serverUrl: SLACK_MCP_URL,
    authorizationCode: code,
    scope: SLACK_BOT_SCOPE_STRING,
  });

  if (result !== "AUTHORIZED") {
    throw new Error(
      `OAuth flow did not complete successfully. Result: ${result}. ` +
      "The authorization code may be invalid or expired."
    );
  }

  pendingAuthUrl = null;
  console.log("[Slack MCP] OAuth complete. Tokens saved to persistent storage.");
  return result;
}

export async function startOAuthFlow(): Promise<string> {
  // Clear any stale tokens so we always start a fresh OAuth flow
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
