import { MCPClient, MCPOAuthClientProvider, MCPServer, OAuthStorage, createSimpleTokenProvider, auth } from "@mastra/mcp";
import { readFile, writeFile, mkdir, unlink } from "node:fs/promises";
import { join } from "node:path";

const SLACK_MCP_URL = "https://mcp.slack.com/mcp";
const REDIRECT_URL =
  process.env.SLACK_OAUTH_REDIRECT_URL ?? "http://localhost:4111/oauth/callback";
const TOKEN_DIR = join(process.cwd(), ".mastra", "oauth-tokens");

// Per Mastra docs Pattern 3: implement OAuthStorage for persistent token storage
class FileOAuthStorage implements OAuthStorage {
  private pathForKey(key: string): string {
    return join(TOKEN_DIR, `${key}.json`);
  }
  async set(key: string, value: string): Promise<void> {
    await mkdir(TOKEN_DIR, { recursive: true });
    await writeFile(this.pathForKey(key), value, "utf-8");
  }
  async get(key: string): Promise<string | undefined> {
    try { return await readFile(this.pathForKey(key), "utf-8"); }
    catch { return undefined; }
  }
  async delete(key: string): Promise<void> {
    try { await unlink(this.pathForKey(key)); }
    catch { /* already gone */ }
  }
}

const oauthStorage = new FileOAuthStorage();
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

// Per Mastra docs Pattern 1: listTools() for agent tools
export const slackTools = await slackMcpClient.listTools();

// Register an MCPServer that exposes the Slack tools over HTTP at /api/mcp/slack/*
export const slackMcpServer = new MCPServer({
  id: "slack",
  name: "Slack MCP",
  version: "1.0.0",
  tools: slackTools,
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
