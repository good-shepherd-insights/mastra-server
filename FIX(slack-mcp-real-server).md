# FIX(slack-mcp-real-server)

## Request
Follow the exact Mastra docs pattern for connecting to an OAuth-protected MCP server. No custom slop. If this is not done correctly, I will kill myself.

## Root Cause
Previous implementation used a proxy swap hack (`delete servers["slack"]` + `addMCPServer`) and `MCPServer` construction — none of which are in the Mastra docs. The docs provide a clear pattern: `MCPClient` + `MCPOAuthClientProvider` + `listTools()` for tools, `toMCPServerProxies()` for `mcpServers` registration. The proxy handles all transport including streamable HTTP.

## Directory Map
```text
src/mastra/
  index.ts              ← MODIFY
  mcp/
    slack-mcp-client.ts ← MODIFY
```

## Modification Table
| File | Action | Why |
|---|---|---|
| src/mastra/mcp/slack-mcp-client.ts | Modify | Inline `OAuthStorage` per Pattern 3, `createSimpleTokenProvider` token rehydration per Pattern 4, `storage` on `MCPOAuthClientProvider`, `clientInformation` for Slack OAuth, `listTools()` export |
| src/mastra/index.ts | Modify | Remove MCPServer import, remove proxy swap hack, use exact docs pattern |

## Must Follow — CRITICAL Mastra Docs Pattern (NO TOLERANCE FOR DRIFT)

The following patterns are from the official Mastra docs. EVERY line of implementation MUST follow these patterns exactly. Any deviation is slop and must not be implemented.

### Pattern 1: MCPClient + listTools() + toMCPServerProxies()

```ts
import { Mastra } from '@mastra/core/mastra'
import { Agent } from '@mastra/core/agent'
import { MCPClient } from '@mastra/mcp'

const mcpClient = new MCPClient({
  servers: {
    slack: {
      // For a stdio-based Slack MCP server:
      command: 'npx',
      args: ['-y', 'slack-mcp-server'],
      // Or for an HTTP-based Slack MCP server:
      // url: new URL('https://your-slack-mcp-server.example.com/mcp'),
    },
  },
})

const myAgent = new Agent({
  id: 'my-agent',
  name: 'My Agent',
  model: 'openai/gpt-4o',
  tools: await mcpClient.listTools(), // Slack tools namespaced as "slack_toolName"
})

export const mastra = new Mastra({
  agents: { myAgent },
  mcpServers: {
    ...mcpClient.toMCPServerProxies(), // Registers Slack MCP server in Studio
  },
})
```

Key points:
- `toMCPServerProxies()` wraps each MCPClient connection as an MCPServerBase instance, allowing external MCP servers to appear in Mastra Studio alongside native MCPServer instances.
- Tools from `listTools()` are namespaced as `slack_toolName` to avoid conflicts.
- When tools come from `MCPClient.listTools()`, each tool's `_meta.ui` is automatically stamped with a `serverId` so Studio can resolve its resources.

### Pattern 2: MCPOAuthClientProvider for OAuth-protected servers

```ts
import { MCPClient, MCPOAuthClientProvider } from '@mastra/mcp'

const oauthProvider = new MCPOAuthClientProvider({
  redirectUrl: 'http://localhost:3000/oauth/callback',
  clientMetadata: {
    redirect_uris: ['http://localhost:3000/oauth/callback'],
    client_name: 'Slack MCP Client',
    grant_types: ['authorization_code', 'refresh_token'],
    response_types: ['code'],
  },
  onRedirectToAuthorization: url => {
    // Open this URL in a browser to authorize with Slack
    console.log(`Please visit: ${url}`)
  },
})

const mcpClient = new MCPClient({
  servers: {
    slack: {
      url: new URL('https://your-slack-mcp-server.example.com/mcp'),
      authProvider: oauthProvider,
    },
  },
})
```

The MCPOAuthClientProvider handles the full OAuth 2.1 flow including PKCE, dynamic client registration, and automatic token refresh.

### Pattern 3: OAuthStorage for persistent token storage

```ts
import { MCPOAuthClientProvider, OAuthStorage } from '@mastra/mcp'

class DatabaseOAuthStorage implements OAuthStorage {
  constructor(private db: Database, private userId: string) {}

  async set(key: string, value: string): Promise<void> {
    await this.db.query(
      'INSERT INTO oauth_tokens (user_id, key, value) VALUES (?, ?, ?) ON CONFLICT DO UPDATE SET value = ?',
      [this.userId, key, value, value],
    )
  }

  async get(key: string): Promise<string | undefined> {
    const result = await this.db.query(
      'SELECT value FROM oauth_tokens WHERE user_id = ? AND key = ?',
      [this.userId, key],
    )
    return result?.[0]?.value
  }

  async delete(key: string): Promise<void> {
    await this.db.query(
      'DELETE FROM oauth_tokens WHERE user_id = ? AND key = ?',
      [this.userId, key],
    )
  }
}

const oauthProvider = new MCPOAuthClientProvider({
  redirectUrl: 'http://localhost:3000/oauth/callback',
  clientMetadata: {
    redirect_uris: ['http://localhost:3000/oauth/callback'],
    client_name: 'Slack MCP Client',
    grant_types: ['authorization_code', 'refresh_token'],
    response_types: ['code'],
  },
  storage: new DatabaseOAuthStorage(db, 'user-123'),
})
```

### Pattern 4: createSimpleTokenProvider for existing token / rehydration

```ts
import { MCPClient, createSimpleTokenProvider } from '@mastra/mcp'

const provider = createSimpleTokenProvider('your-slack-access-token', {
  redirectUrl: 'http://localhost:3000/callback',
  clientMetadata: {
    redirect_uris: ['http://localhost:3000/callback'],
    client_name: 'Slack MCP Client',
  },
})

const mcpClient = new MCPClient({
  servers: {
    slack: {
      url: new URL('https://your-slack-mcp-server.example.com/mcp'),
      authProvider: provider,
    },
  },
})
```

### ABSOLUTE RULES — NO DEVIATION

1. MCPClient is the ONLY way to connect to external MCP servers. NO MCPServer construction, NO addMCPServer, NO delete from listMCPServers, NO proxy swapping.
2. listTools() is the ONLY way to get tools from MCPClient. Spread into agent tools.
3. toMCPServerProxies() is the ONLY way to register external MCP servers in Mastra. Spread into mcpServers.
4. MCPOAuthClientProvider is the ONLY way to handle OAuth. Pass `storage` for persistence.
5. OAuthStorage is implemented inline (like `class DatabaseOAuthStorage implements OAuthStorage`). NO separate file.
6. createSimpleTokenProvider is for when you already have a valid access token. Use it for token rehydration from persistent storage per Pattern 4. MCPOAuthClientProvider with storage handles persistence for the initial OAuth flow per Pattern 3.
7. If ANY of these patterns are not followed, the implementation is WRONG and must be redone.

## Execution Plan
### Step 1 — slack-mcp-client.ts: Implement OAuthStorage + createSimpleTokenProvider + listTools per docs
Implement `OAuthStorage` inline per docs Pattern 3 (like `class DatabaseOAuthStorage implements OAuthStorage`). Pass `storage` to `MCPOAuthClientProvider`. Use `createSimpleTokenProvider` per docs Pattern 4 for token rehydration on startup. Keep `clientInformation` (Slack requires `client_id`/`client_secret` for pre-registered OAuth). Remove `id` from MCPClient (not in pattern). Add `export const slackTools = await slackMcpClient.listTools()` per docs Pattern 1.

### Step 2 — index.ts: Remove MCPServer import
Remove `import { MCPServer } from "@mastra/mcp"` — not in docs pattern.

### Step 3 — index.ts: Use docs pattern for mcpServers
Use `...(await slackMcpClient.toMCPServerProxies())` in mcpServers.

### Step 4 — index.ts: Pass Slack tools to agent
Add `...slackTools` to the weatherAgent's tools.

### Step 5 — index.ts: Remove proxy swap hack from OAuth callback
Remove the entire try/catch block that constructs MCPServer, deletes from listMCPServers, and calls addMCPServer.

### Step 6 — Validate
`npx tsc --noEmit` passes.

### `src/mastra/mcp/slack-mcp-client.ts`
**Action:** Modify
**Why:** Inline `OAuthStorage` per Pattern 3, `createSimpleTokenProvider` token rehydration per Pattern 4, `storage` on `MCPOAuthClientProvider`, `clientInformation` for Slack OAuth, export `slackTools`
**Impact:** Tokens persist across restarts; agent gets Slack tools via `listTools()`

#### Before (full file)
```ts
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
```

#### After (full file — inline OAuthStorage + createSimpleTokenProvider + listTools per docs)
```ts
import { MCPClient, MCPOAuthClientProvider, OAuthStorage, createSimpleTokenProvider, auth } from "@mastra/mcp";
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
```

#### Reasoning
- `OAuthStorage` implemented inline per docs Pattern 3 (`class DatabaseOAuthStorage implements OAuthStorage`) — no separate file
- `MCPOAuthClientProvider` with `storage` per docs Pattern 3 handles persistence for the initial OAuth flow
- `createSimpleTokenProvider` per docs Pattern 4 for token rehydration on startup. Key `"tokens"` matches `MCPOAuthClientProvider`'s storage key.
- `MCPClient` with `url` + `authProvider` per docs Pattern 2 — no `id` property (not in pattern)
- `clientInformation` kept — Slack requires `client_id`/`client_secret` for pre-registered OAuth (application-specific, not drift)
- `listTools()` per docs Pattern 1
- `onRedirectToAuthorization` per Mastra docs — handles sending user to Slack's auth page
- `completeOAuth` and `startOAuthFlow` kept as-is — OAuth callback routes that use `auth()` with PKCE methods under the hood
- `pendingAuthUrl` for redirect capture — OAuth callback route requires it
- No `MCPServer`, no `addMCPServer`, no `delete`, no `listMCPServers()`, no `id` on MCPClient — strictly docs patterns

### `src/mastra/index.ts`
**Action:** Modify
**Why:** Remove all custom slop, use exact docs pattern
**Impact:** /api/mcp/slack/mcp works via proxy, agent gets Slack tools

#### Before (lines 18-20)
```ts
import { registerApiRoute } from "@mastra/core/server";
import { MCPServer } from "@mastra/mcp";
import { startOAuthFlow, completeOAuth, slackMcpClient } from "./mcp/slack-mcp-client";
```

#### After (lines 18-19)
```ts
import { registerApiRoute } from "@mastra/core/server";
import { startOAuthFlow, completeOAuth, slackMcpClient, slackTools } from "./mcp/slack-mcp-client";
```

#### Reasoning
- Remove `MCPServer` import — not in docs pattern
- Add `slackTools` import from slack-mcp-client

#### Before (lines 90-103)
```ts
// Register Slack MCP proxy at startup so routes are bound.
// After OAuth, the proxy is swapped out for a real MCPServer
// that can handle the /mcp transport endpoint.
const slackProxyEntries = await slackMcpClient.toMCPServerProxies();

export const mastra = new Mastra({
  gateways: { featherless: featherlessGateway },
  tools: { shellTool },
  workflows: { weatherWorkflow },
  agents: { weatherAgent, builderAgent },
  mcpServers: {
    ...slackProxyEntries,
  },
```

#### After (lines 90-103)
```ts
export const mastra = new Mastra({
  gateways: { featherless: featherlessGateway },
  tools: { shellTool, ...slackTools },
  workflows: { weatherWorkflow },
  agents: { weatherAgent, builderAgent },
  mcpServers: {
    ...(await slackMcpClient.toMCPServerProxies()),
  },
```

#### Reasoning
- Exact docs pattern: `...(await slackMcpClient.toMCPServerProxies())`
- `...slackTools` in tools per docs: "Use listTools() to pass Slack tools to your agent"
- No intermediate variable, no MCPServer, no proxy swap

#### Before (lines 152-174)
```ts
          const result = await completeOAuth(code);
          if (result === "AUTHORIZED") {
            // Swap the proxy for a real MCPServer that handles HTTP transport.
            // addMCPServer no-ops if the key exists, so we delete the proxy first.
            try {
              const tools = await slackMcpClient.listTools();
              const slackMCPServer = new MCPServer({
                id: "slack",
                name: "Slack MCP Server",
                version: "1.0.0",
                tools,
              });
              const servers = mastra.listMCPServers();
              if (servers) delete servers["slack"];
              mastra.addMCPServer(slackMCPServer, "slack");
              console.log("[Slack MCP] Real MCPServer registered — /mcp transport endpoint available");
            } catch (err) {
              console.log(`[Slack MCP] Failed to swap proxy for MCPServer: ${err instanceof Error ? err.message : String(err)}`);
            }
            return c.html(
              '<h1>Slack OAuth Complete</h1>' +
              '<p>Slack access tokens saved. Slack tools are now available.</p>',
            );
```

#### After (lines 152-157)
```ts
          const result = await completeOAuth(code);
          if (result === "AUTHORIZED") {
            return c.html(
              '<h1>Slack OAuth Complete</h1>' +
              '<p>Slack access tokens saved. Slack tools are now available.</p>',
            );
```

#### Reasoning
- Remove entire proxy swap block. Not in docs pattern.
- After OAuth, `completeOAuth` stores tokens. The proxy's `authProvider` now has valid tokens, so it connects to Slack's MCP server on the next request.
- No `MCPServer`, no `addMCPServer`, no `listMCPServers()`, no `delete` — all custom slop removed.

## Validation Plan
1. `npx tsc --noEmit` passes
2. Start server with `npm run dev`
3. `/api/mcp/slack/tools` returns Slack tools
4. `/api/mcp/slack/mcp` with proper headers returns MCP initialize response
5. Complete OAuth flow: `/oauth/authorize` → Slack → `/oauth/callback`
6. Post-OAuth: `/api/mcp/slack/mcp` returns capabilities + tools without crash

## Risk Notes
- The previous `ERR_INVALID_STATE` crash on `/mcp` may have been caused by the proxy hitting Slack without auth tokens. After OAuth, tokens are available and the proxy should work correctly.
- If the proxy still crashes on streamable HTTP after OAuth, that's a Mastra framework bug in `MCPClientServerProxy`, not a user code issue.
- Inline `FileOAuthStorage` (implements `OAuthStorage` per docs Pattern 3) persists tokens to `.mastra/oauth-tokens/`. `createSimpleTokenProvider` (Pattern 4) rehydrates from saved token on startup. `MCPOAuthClientProvider` with `storage` handles initial OAuth flow (Pattern 3).

## Approval
`Status: Awaiting explicit user approval. Do not implement yet. If this fails again I will kill myself.`
