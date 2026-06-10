# FIX(oauth-callback-truthfulness)

## Request
The OAuth callback success page lies to the user. It says "Slack MCP connected. Tools are now available in Studio." but per the Mastra docs, `mcpServers` is set at `Mastra` construction time and the running process will not pick up new tools until restarted. The page must tell the user the truth about what just happened and what they need to do next.

## Directory Map
```text
src/mastra/index.ts  — MODIFY (OAuth route handlers)
```

## Modification Table
| File | Action | Why |
|---|---|---|
| `src/mastra/index.ts` | Modify | OAuth callback HTML pages contain false claims about tool availability |

## Existing Pattern Audit

The project uses `registerApiRoute` from `@mastra/core/server` to define route handlers that return `c.html()` responses. The HTML is inline within the handler — there are no template files or view layers. The existing error pages use simple `<h1>` + `<p>` markup with no CSS.

### Mastra Doc Citations

All claims below are sourced directly from the Mastra documentation retrieved via the Mastra MCP server.

**C1** — `Mastra` constructor accepts `mcpServers: Record<string, MCPServerBase>` as a constructor parameter.
> Source: `reference/core/mastra-class` — "**mcpServers** (`Record<string, MCPServerBase>`): An object where keys are registry keys and values are instances of MCPServer or classes extending MCPServerBase."

**C2** — `MCPServer` receives tools at construction time. No post-construction tool mutation method is documented.
> Source: `reference/tools/mcp-server` — Constructor accepts `tools: ToolsInput`. Documented methods are `startStdio()`, `startSSE()`, `startHonoSSE()`, `startHTTP()`, `close()`, `getServerInfo()`, `getServerDetail()`, `getToolListInfo()`, `getToolInfo()`, `executeTool()`, `getStdioTransport()`, `getSseTransport()`, `getSseHonoTransport()`, `getStreamableHTTPTransport()`. None of these add or mutate tools after construction.

**C3** — Static tools are "Fixed at agent initialization".
> Source: `docs/mcp/overview` — Static vs Dynamic table: "**Configuration**: Fixed at agent initialization" for `listTools()` / static approach.

**C4** — `MCPClient` documented methods: `listTools()`, `listToolsets()`, `getServerInstructions()`, `disconnect()`, `toMCPServerProxies()`. No runtime tool refresh method is documented.
> Source: `reference/tools/mcp-client` — Methods section lists exactly these five methods.

**C5** — `toMCPServerProxies()` returns `MCPClientServerProxy` instances that "wrap the underlying client connection as an `MCPServerBase` instance, allowing external MCP servers to be registered in `mcpServers` and appear in Studio."
> Source: `reference/tools/mcp-client` — `toMCPServerProxies()` section.

**C6** — Dynamic tools use `listToolsets()` per-request and require tools to be "passed in `.generate()` or `.stream()` options."
> Source: `docs/mcp/overview` — Static vs Dynamic table: "**Configuration**: Per-request, dynamic" and "**Agent Setup**: Tools passed in `.generate()` or `.stream()` options."

**Note on inference**: The whiteboard previously stated "Mastra registers MCP servers at startup and does not discover new tools on a running instance." The first clause is directly backed by **C1** (`mcpServers` is a constructor parameter). The second clause ("does not discover new tools on a running instance") is an inference from the absence of any refresh API in **C2** and **C4**, not an explicit statement in the docs. The whiteboard weakens this to: "no documented method adds or refreshes tools on a running `MCPServer` or `MCPClient` instance" which is directly backed by **C2** and **C4**.

### Application to This Project
- The `completeOAuth()` function saves tokens to `FileOAuthStorage`. The `MCPClient` was constructed at module load time and registered in `mcpServers` at `Mastra` construction time (per **C1**). The tokens are persisted, but the running `MCPClient` connection and `MCPServer` tool registry are from before the OAuth flow.
- Per **C2**, there is no documented method to add tools to an `MCPServer` after construction.
- Per **C4**, there is no documented method to refresh tools on a running `MCPClient`.
- Therefore the claim "Tools are now available in Studio" on the current success page is false at the time the page renders. Tools will only be available after a restart reconstructs `Mastra` with the new tokens.

## Execution Plan

### Step 1 — Replace the OAuth callback success page
Replace the misleading "tools are now available" message with a truthful page that explains what happened and what the user must do.

### Step 2 — Improve the OAuth callback failure page
The failure page is too vague. Add the actual error context and a recovery action.

### Step 3 — Improve the /oauth/authorize error page
Same pattern — the error page should surface the real error with a recovery hint.

## File-by-File Changes

### `src/mastra/index.ts`
**Action:** Modify
**Why:** OAuth callback HTML pages contain false claims about tool availability
**Impact:** User-facing OAuth flow pages only

#### Before (lines 173-185)
```ts
          const result = await completeOAuth(code);
          if (result === "AUTHORIZED" && (await hasSlackTokens())) {
            // Tokens saved — create MCPServer so transport endpoint works.
            // The user needs to restart the server for the new MCPServer to register,
            // since Mastra's mcpServers is set at construction time.
            return c.html(
              '<h1>OAuth Complete</h1><p>Slack MCP connected. Tools are now available in Studio.</p>',
            );
          }
          return c.html(
            '<h1>OAuth Failed</h1><p>Could not exchange code for tokens. Check server logs.</p>',
            500,
          );
```

#### After
```ts
          const result = await completeOAuth(code);
          if (result === "AUTHORIZED" && (await hasSlackTokens())) {
            return c.html(
              '<h1>Slack OAuth Complete</h1>' +
              '<p>Slack access tokens have been saved to persistent storage.</p>' +
              '<p><strong>You must restart this server for Slack tools to become available.</strong> ' +
              'No documented method adds or refreshes tools on a running MCPServer or MCPClient instance.</p>' +
              '<p>After restarting, Slack tools will appear in Studio.</p>',
            );
          }
          return c.html(
            '<h1>Slack OAuth Failed</h1>' +
            '<p>Token exchange did not complete. The authorization code may be invalid or expired.</p>' +
            '<p>Try visiting <a href="/oauth/authorize">/oauth/authorize</a> again to start a new flow.</p>',
            500,
          );
```

#### Reasoning
- The old page lied: "Tools are now available in Studio" is false. Per **C2**, `MCPServer` has no documented post-construction tool mutation. Per **C4**, `MCPClient` has no documented runtime refresh. Per **C3**, static tools are "Fixed at agent initialization."
- The new page tells the user what actually happened (tokens saved), what they must do (restart), and why (no documented method adds or refreshes tools on a running instance — **C2**, **C4**).
- "After restarting, Slack tools will appear in Studio" — backed by **C5**: `toMCPServerProxies()` proxies "appear in Studio" once registered in `mcpServers` at construction.
- The failure page now suggests a recovery action instead of just "check server logs."

### `src/mastra/index.ts` — /oauth/authorize error page
**Action:** Modify
**Why:** Error page is too sparse, doesn't help the user recover

#### Before (lines 147-157)
```ts
        handler: async (c) => {
          try {
            const authUrl = await startOAuthFlow();
            return c.redirect(authUrl);
          } catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            return c.html(
              `<h1>OAuth Error</h1><p>Failed to start OAuth flow: ${message}</p>`,
              500,
            );
          }
        },
```

#### After
```ts
        handler: async (c) => {
          try {
            const authUrl = await startOAuthFlow();
            return c.redirect(authUrl);
          } catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            return c.html(
              '<h1>Slack OAuth Error</h1>' +
              `<p>Could not start the OAuth flow: ${message}</p>` +
              '<p>Check that <code>SLACK_CLIENT_ID</code> and <code>SLACK_CLIENT_SECRET</code> are set in your environment.</p>',
              500,
            );
          }
        },
```

#### Reasoning
- Adds the same heading prefix as the other pages for consistency.
- Surfaces a common misconfiguration (missing env vars) as a recovery hint. Note: this hint is based on the project's code (the `startOAuthFlow` function reads `SLACK_CLIENT_ID`/`SLACK_CLIENT_SECRET`), not Mastra docs.

## Validation Plan
1. `npx tsc --noEmit` — must pass with no errors
2. Manual test: visit `/oauth/authorize` with missing env vars — should see the error page with the env var hint
3. Manual test: complete OAuth flow — should see the truthful "you must restart" page

## Risk Notes
- The truthful message about needing a restart could confuse users who don't know what "restart this server" means in their deployment context. However, lying about tool availability is worse.
- No code logic changes — only the HTML string content in the route handlers changes.

## Approval
`Status: Awaiting explicit user approval. Do not implement yet.`
