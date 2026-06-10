# FIX(slack-oauth-storage)

## Request
The custom `FileOAuthStorage` is broken guessing slop that prevents OAuth tokens from being read correctly, causing `hasSlackTokens()` to return false at startup even after a successful OAuth flow. This makes `createSlackMCPServer()` never run, causing the `MCPClientServerProxy` fallback to be registered in `mcpServers`, which 500s on `/api/mcp/slack/mcp`.

## Directory Map
```text
src/mastra/mcp/oauth-storage.ts   — DELETE
src/mastra/mcp/slack-mcp-client.ts — MODIFY (remove FileOAuthStorage, use Mastra-built-in storage)
src/mastra/mcp/slack-mcp-server.ts — DELETE (dead code after index.ts changes)
src/mastra/index.ts               — MODIFY (remove proxy fallback, simplify)
```

## Modification Table
| File | Action | Why |
|---|---|---|
| `src/mastra/mcp/oauth-storage.ts` | Delete | Custom storage is undocumented guessing slop; Mastra provides `InMemoryOAuthStorage` |
| `src/mastra/mcp/slack-mcp-client.ts` | Modify | Remove `FileOAuthStorage`, use `MCPOAuthClientProvider` without custom `storage` (per Mastra docs default) |
| `src/mastra/mcp/slack-mcp-server.ts` | Delete | Dead code after removing `createSlackMCPServer` from index.ts |
| `src/mastra/index.ts` | Modify | Remove proxy fallback, simplify Slack MCP registration |

## Existing Pattern Audit

### Mastra Doc Citations

All claims sourced directly from Mastra documentation retrieved via the Mastra MCP server.

**E1** — `MCPOAuthClientProvider` constructor accepts `storage?: OAuthStorage`. Defaults to `InMemoryOAuthStorage` if not provided.
> Source: `reference/tools/mcp-client` — "Custom Token Storage" section: `new MCPOAuthClientProvider({ ..., storage: new DatabaseOAuthStorage(db, 'user-123') })`
> Source: `@mastra/mcp` type definition `oauth-provider.d.ts`: `storage?: OAuthStorage` with comment "Defaults to InMemoryOAuthStorage if not provided."

**E2** — `OAuthStorage` interface: `set(key: string, value: string): Promise<void> | void`, `get(key: string): Promise<string | undefined> | string | undefined`, `delete(key: string): Promise<void> | void`.
> Source: `@mastra/mcp` type definition `client/oauth-provider.d.ts:16-29`.
> Source: `reference/tools/mcp-client` — "Custom Token Storage" section shows the interface (docs show async-only signatures; actual types allow sync or async).

**E3** — `InMemoryOAuthStorage` is Mastra's built-in storage. Exported from `@mastra/mcp`.
> Source: `@mastra/mcp` exports: `export { InMemoryOAuthStorage, ... MCPOAuthClientProvider, ... }`

**E4** — `MCPOAuthClientProvider` handles the full OAuth lifecycle when used with `MCPClient` via `authProvider`.
> Source: `reference/tools/mcp-client` — `MastraMCPServerDefinition.authProvider`: "OAuth authentication provider for automatic token refresh and OAuth flow management. Use MCPOAuthClientProvider for a ready-to-use implementation."

**E5** — `MCPClient` with `authProvider` on a server definition handles connection auth automatically (auto-sends tokens, auto-refreshes). But `auth()` is still needed to **initiate** the OAuth flow from route handlers. `auth` is re-exported from `@mastra/mcp` (verified at runtime).
> Source: `reference/tools/mcp-client` — "OAuth authentication" section shows `MCPClient({ servers: { protectedServer: { url: ..., authProvider: oauthProvider } } })` with no manual `auth()` call — the client handles auth for its own connections.
> Source: `@mastra/mcp` main entry re-exports `auth` via `shared/oauth-types.js` → `@modelcontextprotocol/sdk/client/auth.js` (verified at runtime: `const m = await import('@mastra/mcp'); 'auth' in m === true`).

**E6** — `MCPServer` supports `startHTTP()`, `startSSE()`, `startHonoSSE()`, `startStdio()`.
> Source: `reference/tools/mcp-server` — Methods section.

**E7** — `toMCPServerProxies()` returns `MCPClientServerProxy` instances that "wrap the underlying client connection as an `MCPServerBase` instance, allowing external MCP servers to be registered in `mcpServers` and appear in Studio."
> Source: `reference/tools/mcp-client` — `toMCPServerProxies()` section.

**E8** — `MCPServer` receives tools at construction time. No post-construction tool mutation is documented.
> Source: `reference/tools/mcp-server` — Constructor accepts `tools: ToolsInput`.

### Source-Verified Facts

**S1** — `MCPClientServerProxy.startHTTP()` throws `"MCPClientServerProxy does not support HTTP transport"`.
> Source: `@mastra/mcp` dist `index.js:1222`.

### What the Custom `FileOAuthStorage` Gets Wrong

Our `FileOAuthStorage` implements `OAuthStorage` from `@mastra/mcp`, which is correct per **E2**. But it adds:
- Per-key files with `oauth-` prefix — not in Mastra docs
- Legacy single-file JSON map fallback with `readLegacyMap()` — not in Mastra docs
- Atomic temp+rename writes — not in Mastra docs
- `code_verifier` stored as raw string in legacy map vs per-key file — creates format inconsistency

The Mastra docs show exactly two storage options:
1. Default: `InMemoryOAuthStorage` (**E3**) — no configuration needed
2. Custom: implement `OAuthStorage` with `set`/`get`/`delete` (**E2**) — for persistent storage

Our custom `FileOAuthStorage` is neither. It's a custom implementation that introduces complexity not documented anywhere in Mastra, and it's breaking the token flow.

## Execution Plan

### Step 1 — Delete `oauth-storage.ts`
Remove the custom `FileOAuthStorage`. Per **E1**, `MCPOAuthClientProvider` defaults to `InMemoryOAuthStorage`. The docs do not document any file-based storage from Mastra.

### Step 2 — Simplify `slack-mcp-client.ts`
Remove `FileOAuthStorage` import and `storage` parameter from `MCPOAuthClientProvider`. Per **E1**, omitting `storage` defaults to `InMemoryOAuthStorage`. Remove all `OAUTH_STORAGE_PATH` config and production warnings — those were all custom slop around the custom storage. Remove the `silentLogger` — it suppresses connection errors that would help debug auth failures. Remove the `hasSlackTokens` function — with `InMemoryOAuthStorage`, tokens are only in memory after `auth()` completes; checking `oauthProvider.tokens()` at module load time is unreliable.

### Step 3 — Simplify `index.ts` Slack MCP registration
Use `toMCPServerProxies()` as the sole registration path per **E7** — spread proxies into `mcpServers`. Per **S1**, `MCPClientServerProxy` cannot handle HTTP transport. Per **E8**, `MCPServer` tools are fixed at construction so creating one at startup is pointless (no tokens = no tools). The proxy is the correct pattern per docs — it provides Studio visibility and REST tool listing/execution.

### Step 4 — Simplify OAuth callback pages
With `InMemoryOAuthStorage`, `completeOAuth()` saves tokens to the provider's in-memory storage. The `MCPClient` is a singleton in the same process. On the next tool call, the proxy delegates to the `MCPClient`, which reads tokens from the same `InMemoryOAuthStorage` via `authProvider`. No restart is needed — if a restart were needed, it would mean the tokens weren't correctly stored, which would be a bug.

## File-by-File Changes

### `src/mastra/mcp/oauth-storage.ts`
**Action:** Delete
**Why:** Custom storage is undocumented guessing slop. Mastra provides `InMemoryOAuthStorage` by default (**E1**, **E3**).
**Impact:** Removes entire file

### `src/mastra/mcp/slack-mcp-client.ts`
**Action:** Modify
**Why:** Remove custom storage, use Mastra default. Remove silent logger that hides errors.
**Impact:** Token storage, auth provider configuration

#### Before
```ts
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

export const oauthProvider = new MCPOAuthClientProvider({
  redirectUrl: REDIRECT_URL,
  clientMetadata: { ... },
  clientInformation: { ... },
  storage,
  onRedirectToAuthorization: (url) => { ... },
});

// Custom logger that suppresses connection error spam before OAuth
const silentLogger: import("@mastra/mcp").LogHandler = (msg) => {
  if (['error', 'fatal', 'warn'].includes(msg.level)) {
    const str = JSON.stringify(msg);
    if (str.includes('connect') || str.includes('MCP') || str.includes('Unauthorized') || str.includes('401')) {
      return;
 // Silently drop connection errors
    }
  }
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

export async function completeOAuth(code: string): Promise<"AUTHORIZED"> { ... }
export async function startOAuthFlow(): Promise<string> { ... }
export async function hasSlackTokens(): Promise<boolean> {
  const tokens = await oauthProvider.tokens();
  return !!tokens?.access_token;
}
```

#### After
```ts
import { MCPClient, MCPOAuthClientProvider, auth } from "@mastra/mcp";

const SLACK_MCP_URL = "https://mcp.slack.com/mcp";
const REDIRECT_URL =
  process.env.SLACK_OAUTH_REDIRECT_URL ?? "http://localhost:4111/oauth/callback";

let pendingAuthUrl: string | null = null;

// Per Mastra docs (reference/tools/mcp-client E1), omitting storage
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
  if (result === 'REDIRECT') {
    return pendingAuthUrl ?? (function() {
      throw new Error('OAuth flow returned REDIRECT but no URL was captured. This is a bug.');
    })();
  }
  throw new Error('OAuth flow returned AUTHORIZED unexpectedly.');
}
```

#### Reasoning
- `FileOAuthStorage` removed entirely. Per **E1**, omitting `storage` defaults to `InMemoryOAuthStorage`. Per **E3**, `InMemoryOAuthStorage` is Mastra's built-in.
- `OAUTH_STORAGE_PATH` and production warnings removed — those were custom slop for the custom storage.
- `silentLogger` removed — it hides auth errors that are needed for debugging.
- `enableServerLogs: false` removed — not in the Mastra docs OAuth example (**E5**).
- `hasSlackTokens()` removed — the `MCPClient` handles auth internally via `authProvider` (**E4**, **E5**).
- `storage` export removed — nothing needs it anymore.
- `auth` imported from `@mastra/mcp` (verified: `auth` is re-exported from `@modelcontextprotocol/sdk/client/auth.js` via `@mastra/mcp` → `shared/oauth-types.js`). No direct SDK imports needed.

### `src/mastra/index.ts`
**Action:** Modify
**Why:** Simplify Slack MCP registration, remove proxy fallback
**Impact:** mcpServers configuration, Slack MCP startup

#### Before (lines 91-126)
```ts
// Register Slack MCP: always register the proxy (for REST API),
// and also create MCPServer if tokens exist (for transport endpoints).
let slackMCPServer: any = undefined;
let slackProxy: any = undefined;

try {
  const proxies = await slackMcpClient.toMCPServerProxies();
  slackProxy = proxies.slack;
} catch (err) {
  const message = err instanceof Error ? err.message : String(err);
  console.log(`[Slack MCP] Failed to create proxy: ${message}`);
}

if (await hasSlackTokens()) {
  try {
    slackMCPServer = await createSlackMCPServer();
    console.log("[Slack MCP] Connected — MCPServer transport endpoints available");
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.log(`[Slack MCP] Failed to create MCPServer: ${message}`);
  }
} else {
  console.log("[Slack MCP] OAuth required — visit /oauth/authorize to connect");
}

const slackMcpServerFinal = slackMCPServer || slackProxy;

export const mastra = new Mastra({
  ...
  mcpServers: slackMcpServerFinal ? { slack: slackMcpServerFinal } : {},
  ...
});
```

#### After
```ts
// Register Slack MCP using toMCPServerProxies() per Mastra docs
// (reference/tools/mcp-client E7): spread proxies into mcpServers
// to make the server appear in Studio.
let slackProxies: Record<string, any> = {};
try {
  slackProxies = await slackMcpClient.toMCPServerProxies();
  console.log("[Slack MCP] Proxy registered — server visible in Studio");
} catch (err) {
  const message = err instanceof Error ? err.message : String(err);
  console.log(`[Slack MCP] Failed to create proxy: ${message}`);
}

export const mastra = new Mastra({
  ...
  mcpServers: {
    ...slackProxies,
  },
  ...
});
```

#### Reasoning
- Per **E7**, `toMCPServerProxies()` is the documented way to register external MCP servers in `mcpServers`: "Spread the result into the `mcpServers` config on `Mastra`". The docs example shows `mcpServers: { ...(await mcpClient.toMCPServerProxies()) }`.
- The proxy fallback with `createSlackMCPServer()` is removed. Per **E8**, `MCPServer` tools are fixed at construction — creating one at startup before OAuth has no tools, and creating one after OAuth can't update later. The proxy pattern is the only docs-compliant option.
- `hasSlackTokens()` is removed — the `MCPClient` handles auth lifecycle internally via `authProvider` (**E4**, **E5**).
- The `MCPClient` uses `authProvider` to handle token refresh and reconnection automatically.

### `src/mastra/index.ts` — OAuth callback handler
**Action:** Modify
**Why:** The callback handler currently calls `hasSlackTokens()` (line 176), which is being deleted. Remove the `hasSlackTokens()` check — `completeOAuth()` already throws on failure, so `result === "AUTHORIZED"` is sufficient.

#### Before (line 176)
```ts
          if (result === "AUTHORIZED" && (await hasSlackTokens())) {
```

#### After
```ts
          if (result === "AUTHORIZED") {
```

### `src/mastra/index.ts` — OAuth callback success page
**Action:** Modify
**Why:** With `InMemoryOAuthStorage`, tokens are in the running process's memory after `completeOAuth()`. The `MCPClient` already has the tokens and can use them. No restart needed.

#### Before (lines 177-182)
```ts
            return c.html(
              '<h1>Slack OAuth Complete</h1>' +
              '<p>Slack access tokens have been saved to persistent storage.</p>' +
              '<p><strong>You must restart this server for Slack tools to become available.</strong> ' +
              'No documented method adds or refreshes tools on a running MCPServer or MCPClient instance.</p>' +
              '<p>After restarting, Slack tools will appear in Studio.</p>',
            );
```

#### After
```ts
            return c.html(
              '<h1>Slack OAuth Complete</h1>' +
              '<p>Slack access tokens saved. Slack tools are now available.</p>',
            );
```

#### Reasoning
- With `InMemoryOAuthStorage`, `completeOAuth()` saves tokens to the provider's in-memory storage (**E1**). The `MCPClient` uses `authProvider` for connections (**E4**).
- The `MCPClient` is a singleton in the same running process. The proxy delegates tool calls to the `MCPClient`, which reads tokens from the same `InMemoryOAuthStorage`. No restart is needed.
- If a restart were needed, it would mean the tokens weren't correctly stored — which would be a bug, not expected behavior.

### `src/mastra/mcp/slack-mcp-server.ts`
**Action:** Delete
**Why:** After removing `createSlackMCPServer()` from `index.ts`, this file becomes dead code. The `MCPServer` it creates has tools fixed at construction time (**E8**) and cannot support HTTP transport (only `MCPServer` can, not `MCPClientServerProxy` **S1**). But the proxy pattern from `toMCPServerProxies()` is the correct way per **E7**. This file is unused slop.
**Impact:** Removes entire file

### `src/mastra/index.ts` — imports
**Action:** Modify
**Why:** Remove unused imports after simplification

Remove `createSlackMCPServer` and `hasSlackTokens` from imports. Keep `startOAuthFlow`, `completeOAuth`, `slackMcpClient`.

## Validation Plan
1. `npx tsc --noEmit` — must pass
2. Start server without Slack tokens — `toMCPServerProxies()` should succeed, proxy registered in Studio
3. Visit `/oauth/authorize` — redirects to Slack
4. Complete OAuth — success page shows "Slack tools are now available"
5. After OAuth, `slackMcpClient.listTools()` should return Slack tools (MCPClient uses stored tokens)

## Risk Notes
- `InMemoryOAuthStorage` means tokens are lost on process restart. The user must re-authenticate after every restart. This is the tradeoff for removing the broken custom storage. If persistent storage is needed later, implement `OAuthStorage` per **E2** exactly as the docs show — no legacy fallback, no `oauth-` prefix, no temp+rename.
- `MCPClientServerProxy` registered via `toMCPServerProxies()` does not support HTTP transport (**S1**). External MCP clients connecting via `/api/mcp/slack/mcp` will get 500. This is a known limitation of `MCPClientServerProxy` — it provides REST tool listing and Studio visibility but not transport. Per **E7**, this is the documented use of `toMCPServerProxies()`. **The `/api/mcp/slack/mcp` 500 is NOT fixed by this plan.** The proxy is the correct pattern per docs, but it cannot serve HTTP transport. To fix the 500, a real `MCPServer` with transport would need to be registered alongside the proxy, but per **E8** tools are fixed at construction and cannot update after OAuth. This is a fundamental Mastra architecture limitation.
- The `MCPClient` is a singleton in the same process as the `InMemoryOAuthStorage`. After `completeOAuth()` saves tokens, the next tool call through the proxy delegates to the `MCPClient`, which reads from the same storage via `authProvider`. No restart needed. If this doesn't work, the implementation is broken.

## Approval
`Status: Awaiting explicit user approval. Do not implement yet.`