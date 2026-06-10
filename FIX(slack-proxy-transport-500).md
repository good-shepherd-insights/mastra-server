# FIX(slack-proxy-transport-500)

## Request
The live deployment is crashing with 500 on `/api/mcp/slack/mcp` because the `MCPClientServerProxy` (from `toMCPServerProxies()`) is registered under `mcpServers.slack` as a fallback when the real `MCPServer` is not available. `MCPClientServerProxy.startHTTP()` throws `"MCPClientServerProxy does not support HTTP transport"`, so any MCP client connecting via streamable HTTP gets a 500. The proxy fallback is masking the real problem: either tokens don't exist at startup, or `createSlackMCPServer()` is throwing and the error is silently swallowed.

## Directory Map
```text
src/mastra/index.ts  — MODIFY (mcpServers registration logic)
```

## Modification Table
| File | Action | Why |
|---|---|---|
| `src/mastra/index.ts` | Modify | Proxy fallback in `mcpServers` causes 500 on MCP transport endpoint |

## Existing Pattern Audit

The project uses `registerApiRoute` from `@mastra/core/server` to define route handlers. The `Mastra` instance is constructed at module top-level with `mcpServers` set at construction time.

### Mastra Doc Citations

All claims sourced directly from Mastra documentation retrieved via the Mastra MCP server.

**D1** — `Mastra` constructor accepts `mcpServers: Record<string, MCPServerBase>`. Values are "instances of MCPServer or classes extending MCPServerBase."
> Source: `reference/core/mastra-class` — "**mcpServers** (`Record<string, MCPServerBase>`): An object where keys are registry keys and values are instances of MCPServer or classes extending MCPServerBase."

**D2** — `toMCPServerProxies()` returns `MCPClientServerProxy` instances. Each proxy "wraps the underlying client connection as an `MCPServerBase` instance, allowing external (non-Mastra) MCP servers to be registered in `mcpServers` and appear in Studio."
> Source: `reference/tools/mcp-client` — `toMCPServerProxies()` section.

**D3** — The documented use of `toMCPServerProxies()` is: spread into `mcpServers` so the proxies "appear in Studio."
> Source: `reference/tools/mcp-client` — Example: `mcpServers: { ...(await mcpClient.toMCPServerProxies()) }`

**D4** — `MCPServer` supports `startHTTP()`, `startSSE()`, `startHonoSSE()`, `startStdio()` — these are the transport methods that serve the MCP protocol to external clients.
> Source: `reference/tools/mcp-server` — Methods section documents `startHTTP()`, `startSSE()`, `startHonoSSE()`, `startStdio()`.

**D5** — `MCPServer` receives tools at construction time. No post-construction tool mutation is documented.
> Source: `reference/tools/mcp-server` — Constructor accepts `tools: ToolsInput`. Documented methods do not include any tool-add/refresh method.

**D6** — `MCPClient` documented methods: `listTools()`, `listToolsets()`, `getServerInstructions()`, `disconnect()`, `toMCPServerProxies()`. No runtime tool refresh method is documented.
> Source: `reference/tools/mcp-client` — Methods section.

### Source-Verified Facts (not in docs but verified in installed package)

**S1** — `MCPClientServerProxy.startHTTP()` throws `"MCPClientServerProxy does not support HTTP transport"`.
> Source: `@mastra/mcp` dist, line 1221-1222: `async startHTTP(_options) { throw new Error("MCPClientServerProxy does not support HTTP transport"); }`
> Also: `startStdio()`, `startSSE()`, `startHonoSSE()` all throw similar errors.

**S2** — `MCPClientServerProxy` extends `MCPServerBase`, so it satisfies the type contract for `mcpServers` (per D1), but it cannot serve MCP transport connections (per S1).

### Application to This Project

Current code (lines 91-126 of `index.ts`):
```ts
let slackMCPServer: any = undefined;
let slackProxy: any = undefined;

try {
  const proxies = await slackMcpClient.toMCPServerProxies();
  slackProxy = proxies.slack;
} catch (err) { ... }

if (await hasSlackTokens()) {
  try {
    slackMCPServer = await createSlackMCPServer();
  } catch (err) { ... }
} else {
  console.log("[Slack MCP] OAuth required — visit /oauth/authorize to connect");
}

const slackMcpServerFinal = slackMCPServer || slackProxy;

export const mastra = new Mastra({
  mcpServers: slackMcpServerFinal ? { slack: slackMcpServerFinal } : {},
  ...
});
```

**The bug**: When `slackMCPServer` is `undefined` (no tokens yet, or `createSlackMCPServer()` threw), the fallback `slackMcpServerFinal = slackProxy` registers `MCPClientServerProxy` under `mcpServers.slack`. Per **S1**, this proxy cannot handle HTTP transport, so any MCP client connecting to `/api/mcp/slack/mcp` gets a 500.

**Why the fallback exists**: The comment on line 91 says "always register the proxy (for REST API)." The intent was to keep some Slack presence in `mcpServers` even without tokens. However, the proxy cannot serve MCP transport (per **S1**), making it harmful as a fallback.

**The correct fix**: Only register a real `MCPServer` in `mcpServers`. Do not register `MCPClientServerProxy` as the transport server. Per **D2** and **D3**, `toMCPServerProxies()` is documented as a way to make external servers "appear in Studio" — but for our use case, we *already have* a real `MCPServer` that provides full functionality (transport + Studio). The proxy is only useful when there is no local `MCPServer` to wrap the tools — but in that case, it should not be registered because it breaks MCP transport.

## Execution Plan

### Step 1 — Remove the proxy fallback from `mcpServers`
Only register the real `MCPServer` in `mcpServers`. When tokens don't exist yet or `createSlackMCPServer()` fails, register nothing. This prevents the 500 on `/api/mcp/slack/mcp`.

### Step 2 — Remove the `toMCPServerProxies()` call entirely
Per **D2/D3**, `toMCPServerProxies()` exists to make external servers "appear in Studio" — but our real `MCPServer` (from `createSlackMCPServer()`) already appears in Studio when registered in `mcpServers` (per **D1**). The proxy provides no capability that the real `MCPServer` doesn't already provide, and it breaks transport (per **S1**).

### Step 3 — Update the OAuth callback success page to reflect the new behavior
With only `MCPServer` registered, when tokens don't exist the server simply has no `slack` in `mcpServers`. The restart message from PR #3 remains correct.

## File-by-File Changes

### `src/mastra/index.ts`
**Action:** Modify
**Why:** `MCPClientServerProxy` fallback in `mcpServers` causes 500 on MCP transport endpoint
**Impact:** Slack MCP registration logic and `mcpServers` configuration

#### Before (lines 91-126)
```ts
// Register Slack MCP: always register the proxy (for REST API),
// and also create MCPServer if tokens exist (for transport endpoints).
// @see https://mastra.ai/reference/tools/mcp-server
// @see https://mastra.ai/reference/tools/mcp-client
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

// Use MCPServer if available (supports transport), fall back to proxy (REST only)
const slackMcpServerFinal = slackMCPServer || slackProxy;

export const mastra = new Mastra({
  ...
  mcpServers: slackMcpServerFinal ? { slack: slackMcpServerFinal } : {},
  ...
});
```

#### After
```ts
// Register Slack MCP: only register a real MCPServer (supports both transport
// and REST). Do not register MCPClientServerProxy — it cannot handle HTTP
// transport and causes 500 on /api/mcp/slack/mcp.
// @see https://mastra.ai/reference/tools/mcp-server (D4: MCPServer.startHTTP)
// @see https://mastra.ai/reference/tools/mcp-client (D2: toMCPServerProxies)
let slackMCPServer: MCPServer | undefined = undefined;

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

export const mastra = new Mastra({
  ...
  mcpServers: slackMCPServer ? { slack: slackMCPServer } : {},
  ...
});
```

#### Reasoning
- The `slackProxy` fallback (`MCPClientServerProxy`) is removed entirely. Per **S1**, it throws on `startHTTP()`, `startSSE()`, `startHonoSSE()`, and `startStdio()` — it cannot serve MCP transport connections at all.
- Per **D4**, the real `MCPServer` supports all transport methods.
- Per **D2/D3**, `toMCPServerProxies()` is documented for making external servers "appear in Studio" — but the real `MCPServer` already appears in Studio when registered in `mcpServers` (per **D1**).
- The type of `slackMCPServer` is changed from `any` to `MCPServer | undefined` for type safety.
- When no tokens exist, `mcpServers` is `{}` — no `slack` key. This means `/api/mcp/slack/mcp` returns 404 instead of 500, which is the correct behavior for an unregistered server.

### `src/mastra/index.ts` — import cleanup
**Action:** Modify
**Why:** `toMCPServerProxies` is no longer used, but `slackMcpClient` is still needed for `listTools()` in `createSlackMCPServer()`

No import changes needed — `slackMcpClient` is imported as a whole module reference and still used by `createSlackMCPServer()` via `slack-mcp-server.ts`.

## Validation Plan
1. `npx tsc --noEmit` — must pass with no errors
2. Start server without Slack tokens — `/api/mcp/slack/mcp` should return 404 (not 500)
3. Start server with Slack tokens — `/api/mcp/slack/mcp` should handle MCP initialize correctly
4. Check server logs: no `[Slack MCP] Failed to create proxy:` messages (proxy code removed)

## Risk Notes
- When no tokens exist, `mcpServers` has no `slack` key. Any routes that depend on a registered `slack` server will not exist. This is correct behavior — there are no Slack tools to serve when there are no tokens, and returning 404 is better than returning a proxy that 500s on transport.
- The OAuth flow still works: tokens are saved, and the success page already tells users to restart (from PR #3).

## Approval
`Status: Awaiting explicit user approval. Do not implement yet.`