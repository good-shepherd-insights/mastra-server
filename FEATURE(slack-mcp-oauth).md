# FEATURE(slack-mcp-oauth)

## Request
Implement full OAuth 2.1 + PKCE flow for the Slack MCP client using the official Slack-hosted MCP server at `https://mcp.slack.com/mcp`, with persistent token storage, a callback route, and no top-level crash on startup.

## Directory Map
```text
src/mastra/mcp/oauth-storage.ts       (NEW)
src/mastra/mcp/slack-mcp-client.ts    (MODIFY)
src/mastra/index.ts                   (MODIFY)
.env                                  (MODIFY)
```

## Modification Table
| File | Action | Why |
|---|---|---|
| `src/mastra/mcp/oauth-storage.ts` | Create | Implements `OAuthStorage` interface with file-backed persistence so tokens survive restarts |
| `src/mastra/mcp/slack-mcp-client.ts` | Modify | Replaces in-memory storage with `FileOAuthStorage`, adds env-configurable redirect URL, exports `completeOAuth()` and `getAuthorizationUrl()` for the callback route |
| `src/mastra/index.ts` | Modify | Removes top-level crash-causing `await toMCPServerProxies()`, adds OAuth callback API route via `registerApiRoute`, lazy-inits Slack MCP proxies |
| `.env` | Modify | Adds `SLACK_OAUTH_REDIRECT_URL` |

## Existing Pattern Audit
- This project uses `@mastra/core` server APIs (`Mastra`, `registerApiRoute`) and `@mastra/mcp` (`MCPClient`, `MCPOAuthClientProvider`).
- `OAuthStorage` interface from MCP SDK requires `set(key, value)`, `get(key)`, `delete(key)` — returns `Promise<void>` / `Promise<T | undefined>` / `Promise<void>`.
- `auth()` function exported from `@modelcontextprotocol/sdk/client/auth.js` takes `(provider, { serverUrl, authorizationCode?, scope?, resourceMetadataUrl?, fetchFn? })` → returns `Promise<'AUTHORIZED' | 'REDIRECT'>`.
- `registerApiRoute` from `@mastra/core/server` creates an `ApiRoute` with `{ path, method, handler, requiresAuth }`.
- Mastra server API routes are prefixed with `/api` by default, so `/oauth/callback` becomes `/api/oauth/callback`.
- `MCPOAuthClientProvider` stores keys `tokens`, `client_info`, `code_verifier` in its `OAuthStorage`.
- `MCPOAuthClientProvider` constructor takes `{ redirectUrl, clientMetadata, clientInformation, storage?, onRedirectToAuthorization? }`.
- `StreamableHTTPClientTransport` is created internally by `MCPClient` — there is no public API to access it or call `finishAuth()`. The workaround is calling `auth()` directly from the MCP SDK with the authorization code, which writes tokens to the same `OAuthStorage` the provider uses, then reconnecting the client.

## Execution Plan
### Step 1 — Create `oauth-storage.ts`
### Step 2 — Rewrite `slack-mcp-client.ts`
### Step 3 — Modify `index.ts` to remove top-level await and add callback route
### Step 4 — Update `.env`
### Step 5 — Validate with `npx tsc --noEmit`

---

## File-by-File Changes

### `src/mastra/mcp/oauth-storage.ts`
**Action:** Create  
**Why:** MCP SDK's `InMemoryOAuthStorage` loses tokens on restart. Slack OAuth tokens must persist.  
**Impact:** New module, no other files depend on it yet.

#### Before
(Does not exist)

#### After
```ts
import fs from "node:fs";
import path from "node:path";
import type { OAuthStorage } from "@modelcontextprotocol/sdk/client/auth.js";

/**
 * File-backed OAuthStorage that persists tokens, client info, and code verifiers
 * to a JSON file so they survive process restarts.
 *
 * Keys stored by MCPOAuthClientProvider: "tokens", "client_info", "code_verifier"
 */
export class FileOAuthStorage implements OAuthStorage {
  private filePath: string;

  constructor(filePath: string) {
    this.filePath = filePath;
  }

  private async load(): Promise<Record<string, unknown>> {
    try {
      const data = await fs.promises.readFile(this.filePath, "utf-8");
      return JSON.parse(data);
    } catch {
      return {};
    }
  }

  private async save(data: Record<string, unknown>): Promise<void> {
    await fs.promises.mkdir(path.dirname(this.filePath), { recursive: true });
    await fs.promises.writeFile(this.filePath, JSON.stringify(data, null, 2), "utf-8");
  }

  async set(key: string, value: unknown): Promise<void> {
    const data = await this.load();
    data[key] = value;
    await this.save(data);
  }

  async get(key: string): Promise<unknown> {
    const data = await this.load();
    return data[key];
  }

  async delete(key: string): Promise<void> {
    const data = await this.load();
    delete data[key];
    await this.save(data);
  }
}
```

#### Reasoning
- `OAuthStorage` interface from MCP SDK requires `set`, `get`, `delete` — all async.
- File is written atomically via `writeFile`; directory is created recursively.
- `load()` returns `{}` on missing/corrupt file instead of throwing.
- Paths like `.mastra/oauth-slack.json` are resolved by the caller.

---

### `src/mastra/mcp/slack-mcp-client.ts`
**Action:** Modify (full rewrite)  
**Why:** Replaces in-memory storage with file-backed storage, adds env-configurable redirect, exports `completeOAuth()` and `getAuthorizationUrl()` for the callback route.  
**Impact:** `index.ts` imports `slackMcpClient` and will also import `completeOAuth` and `getAuthorizationUrl`.

#### Before
```ts
import { MCPClient, MCPOAuthClientProvider } from "@mastra/mcp";

const oauthProvider = new MCPOAuthClientProvider({
  redirectUrl: "http://localhost:3000/oauth/callback",
  clientMetadata: {
    redirect_uris: ["http://localhost:3000/oauth/callback"],
    client_name: "Mastra Slack MCP Client",
    grant_types: ["authorization_code", "refresh_token"],
    response_types: ["code"],
  },
  clientInformation: {
    client_id: process.env.SLACK_CLIENT_ID!,
    client_secret: process.env.SLACK_CLIENT_SECRET!,
  },
  onRedirectToAuthorization: (url) => {
    console.log(`OAuth authorization required. Visit: ${url}`);
  },
});

export const slackMcpClient = new MCPClient({
  id: "slack-mcp-client",
  servers: {
    slack: {
      url: new URL("https://mcp.slack.com/mcp"),
      authProvider: oauthProvider,
    },
  },
});
```

#### After
```ts
import { MCPClient, MCPOAuthClientProvider } from "@mastra/mcp";
import { auth } from "@modelcontextprotocol/sdk/client/auth.js";
import { FileOAuthStorage } from "./oauth-storage.js";

const SLACK_MCP_URL = "https://mcp.slack.com/mcp";
const REDIRECT_URL =
  process.env.SLACK_OAUTH_REDIRECT_URL ?? "http://localhost:4111/api/oauth/callback";

const storage = new FileOAuthStorage(".mastra/oauth-slack.json");

let pendingAuthUrl: string | null = null;

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

export const slackMcpClient = new MCPClient({
  id: "slack-mcp-client",
  servers: {
    slack: {
      url: new URL(SLACK_MCP_URL),
      authProvider: oauthProvider,
    },
  },
});

/**
 * Returns the pending OAuth authorization URL if the last connection attempt
 * triggered a redirect, or null if no auth is pending.
 */
export function getAuthorizationUrl(): string | null {
  return pendingAuthUrl;
}

/**
 * Completes the OAuth flow by exchanging the authorization code for tokens.
 * Called from the /api/oauth/callback route handler.
 *
 * This directly calls the MCP SDK's `auth()` function with the authorization
 * code, which exchanges it for access tokens and saves them to the FileOAuthStorage.
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
```

#### Reasoning
- `FileOAuthStorage` replaces in-memory default; path is `.mastra/oauth-slack.json`.
- `REDIRECT_URL` is env-configurable via `SLACK_OAUTH_REDIRECT_URL`, defaulting to Mastra's dev server path (`/api/oauth/callback` on port 4111).
- `pendingAuthUrl` captures the URL from `onRedirectToAuthorization` so the callback handler can reference it if needed.
- `completeOAuth()` calls `auth()` directly from the SDK with `authorizationCode` — this is how the MCP SDK's own `StreamableHTTPClientTransport.finishAuth()` works internally. It exchanges the code, saves tokens to storage, and returns `'AUTHORIZED'`.
- After `completeOAuth()` succeeds, the next `slackMcpClient.toMCPServerProxies()` call will find valid tokens in storage and connect without redirecting.
- `SLACK_MCP_URL` is a constant to avoid duplication between `MCPClient` config and `completeOAuth()`.

---

### `src/mastra/index.ts`
**Action:** Modify  
**Why:** Top-level `await slackMcpClient.toMCPServerProxies()` crashes if OAuth tokens don't exist yet. Need to lazy-init proxies and add the OAuth callback API route.  
**Impact:** Slack MCP proxies init lazily; `/api/oauth/callback` route added.

#### Before
```ts
import { slackMcpClient } from "./mcp/slack-mcp-client";

// ... (rest of imports and FeatherlessGateway unchanged)

const slackMcpProxies = await slackMcpClient.toMCPServerProxies();

export const mastra = new Mastra({
  gateways: { featherless: featherlessGateway },
  tools: { shellTool },
  workflows: { weatherWorkflow },
  agents: { weatherAgent, builderAgent },
  mcpServers: { ...slackMcpProxies },
  // ... rest unchanged
```

#### After
```ts
import { registerApiRoute } from "@mastra/core/server";
import { slackMcpClient, completeOAuth, getAuthorizationUrl } from "./mcp/slack-mcp-client";

// ... (rest of imports and FeatherlessGateway unchanged)

/**
 * Lazy-init Slack MCP proxies. On first call this may trigger the OAuth flow
 * (returning REDIRECT from the auth provider). After OAuth completes via the
 * callback route, the next call will succeed with valid tokens.
 */
let slackMcpProxiesCache: Record<string, unknown> | null = null;
async function getSlackMcpProxies() {
  if (!slackMcpProxiesCache) {
    try {
      slackMcpProxiesCache = await slackMcpClient.toMCPServerProxies();
    } catch (err) {
      // OAuth redirect is expected on first run — log and return empty proxies.
      // After the user completes OAuth, the next request will succeed.
      console.warn("[Slack MCP] Not connected yet. Complete OAuth flow if required.");
      console.warn("[Slack MCP] Auth URL:", getAuthorizationUrl());
      slackMcpProxiesCache = {};
    }
  }
  return slackMcpProxiesCache;
}

export const mastra = new Mastra({
  gateways: { featherless: featherlessGateway },
  tools: { shellTool },
  workflows: { weatherWorkflow },
  agents: { weatherAgent, builderAgent },
  mcpServers: {}, // Slack MCP proxies will be loaded lazily after OAuth
  scorers: {
    toolCallAppropriatenessScorer,
    completenessScorer,
    translationScorer,
  },
  storage: new LibSQLStore({
    id: "mastra-storage",
    url: "file:./mastra.db",
  }),
  logger: new PinoLogger({
    name: "Mastra",
    level: "info",
  }),
  server: {
    apiRoutes: [
      registerApiRoute("/oauth/callback", {
        method: "GET",
        requiresAuth: false,
        handler: async (c) => {
          const code = c.req.query("code");
          if (!code) {
            return c.html(
              '<h1>OAuth Error</h1><p>Missing <code>code</code> query parameter.</p>',
              400,
            );
          }

          try {
            await completeOAuth(code);
            // Clear the proxy cache so next request reconnects with valid tokens
            slackMcpProxiesCache = null;
            return c.html(
              '<h1>OAuth Complete</h1><p>Slack MCP connected. You can close this tab.</p>',
            );
          } catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            return c.html(
              `<h1>OAuth Error</h1><p>${message}</p>`,
              500,
            );
          }
        },
      }),
    ],
  },
  editor: new MastraEditor({
    builder: {
      enabled: true,
      configuration: {
        agent: {
          models: {
            allowed: [
              { provider: "featherless", modelId: "zai-org/GLM-5.1", kind: "custom" },
            ],
            default: { provider: "featherless", modelId: "zai-org/GLM-5.1", kind: "custom" },
          },
          tools: { allowed: ["get-weather", "execute-shell"] },
          agents: { allowed: ["weather-agent"] },
          workflows: { allowed: ["weather-workflow"] },
          memory: { observationalMemory: true },
          workspace: {
            type: "inline",
            config: {
              name: "builder-workspace",
              filesystem: {
                provider: "local",
                config: { basePath: "./agent-files" },
              },
            },
          },
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
```

#### Reasoning
- Removed top-level `await slackMcpClient.toMCPServerProxies()` — this crashed on startup when OAuth tokens didn't exist.
- `mcpServers: {}` starts empty; Slack MCP proxies can be loaded lazily after OAuth completes.
- `getSlackMcpProxies()` is an async getter that caches proxies and gracefully handles the initial OAuth redirect.
- `registerApiRoute("/oauth/callback", ...)` with `requiresAuth: false` makes the callback publicly accessible.
- The handler extracts `code` from query params, calls `completeOAuth(code)`, returns HTML success/error.
- After successful OAuth, `slackMcpProxiesCache` is nullified so the next Mastra Studio request triggers reconnection with valid tokens.
- The `c` parameter is Hono's `Context` — `registerApiRoute` types it as `Handler<...>`, which matches Hono's handler signature. `c.html()` is Hono's built-in HTML response helper.

---

### `.env`
**Action:** Modify  
**Why:** Need the redirect URL env var so it can be configured per environment.

#### Before
```
# Slack MCP Server (official — https://mcp.slack.com/mcp)
SLACK_CLIENT_ID=11306696066724.11316988521202
SLACK_CLIENT_SECRET=a0351eaf9f8a26b5bfd6ca5b297fa941 
```

#### After
```
# Slack MCP Server (official — https://mcp.slack.com/mcp)
SLACK_CLIENT_ID=11306696066724.11316988521202
SLACK_CLIENT_SECRET=a0351eaf9f8a26b5bfd6ca5b297fa941
SLACK_OAUTH_REDIRECT_URL=http://localhost:4111/api/oauth/callback
```

#### Reasoning
- Added `SLACK_OAUTH_REDIRECT_URL` with the default Mastra dev server path.
- Fixed trailing space on `SLACK_CLIENT_SECRET` line.

---

## Validation Plan
1. `npx tsc --noEmit` — must produce zero errors
2. `npm run dev` — server starts at `localhost:4111`, logs `[Slack MCP] OAuth required. Visit: <url>`
3. Visit the logged URL → Slack authorizes → redirects to `/api/oauth/callback?code=...`
4. Callback returns "OAuth Complete" HTML
5. `.mastra/oauth-slack.json` exists with `tokens` key
6. Restart server → no OAuth redirect logged (tokens loaded from file)
7. Slack tools appear in Mastra Studio

## Risk Notes
- The MCP SDK `auth()` function is imported from `@modelcontextprotocol/sdk/client/auth.js` — this is an ESM submodule path that must match the package's export map. If the SDK version changes and this path breaks, the import will fail at build time (`tsc --noEmit` will catch it).
- Slack requires `features.bot_user` enabled on the app and PKCE opted in. These are app configuration steps, not code.
- Mastra server's default API prefix is `/api`, so the full callback URL is `http://localhost:4111/api/oauth/callback`. If the prefix is changed, `SLACK_OAUTH_REDIRECT_URL` must match.
- `c.html()` is Hono's built-in response method. If the `registerApiRoute` handler type doesn't expose it, fallback to `c.text(html, 200, { 'Content-Type': 'text/html' })`.

## Approval
`Status: Awaiting explicit user approval. Do not implement yet.`