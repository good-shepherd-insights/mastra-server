# REFACTOR(independent-mcp-oauth-flows)

## Request

Replace the current single-provider, monolithic `slack-mcp-client.ts` + `routes/oauth.ts`
structure with an independent-per-provider OAuth architecture. Each MCP OAuth provider lives in
its own directory with self-contained flow logic. Shared infrastructure (storage class, route
factory, HTML utilities) is extracted into `mcp/oauth/`. Adding a second provider requires
creating one new directory — zero changes to existing provider files.

All 8 code review findings from `FIX(security-and-correctness-findings).md` are folded into
this refactor. The fix plan is superseded; no separate fix PR is needed.

---

## Directory Map

```text
src/mastra/
├── mcp/
│   ├── oauth/
│   │   ├── storage.ts          CREATE  — LibSQLOAuthStorage (extracted from slack-mcp-client.ts)
│   │   └── routes.ts           CREATE  — createMCPOAuthRoutes factory + escapeHtml + HTML shell
│   ├── slack/
│   │   └── index.ts            CREATE  — all Slack logic (restructured + all fixes applied)
│   └── slack-mcp-client.ts     DELETE  — replaced by mcp/slack/index.ts
├── routes/
│   └── oauth.ts                DELETE  — replaced by mcp/oauth/routes.ts + mcp/slack/index.ts
└── index.ts                    MODIFY  — update imports, use createMCPOAuthRoutes
```

> `src/mastra/routes/` becomes empty after deletion. Remove the directory.

---

## Modification Table

| File | Action | Why |
|---|---|---|
| `src/mastra/mcp/oauth/storage.ts` | Create | Extract `LibSQLOAuthStorage` — reusable by every provider |
| `src/mastra/mcp/oauth/routes.ts` | Create | Generic route factory — wires `/oauth/:id/authorize` and `/oauth/:id/callback` |
| `src/mastra/mcp/slack/index.ts` | Create | Slack provider: all Slack config, flow logic, MCP server registration, and OAuth handlers |
| `src/mastra/mcp/slack-mcp-client.ts` | Delete | Superseded by `mcp/slack/index.ts` |
| `src/mastra/routes/oauth.ts` | Delete | Superseded by `mcp/oauth/routes.ts` |
| `src/mastra/index.ts` | Modify | Import from new paths, register Slack routes via `createMCPOAuthRoutes` |

---

## Existing Pattern Audit

- **`utils/` shared infrastructure**: `monitor.ts` and `adapters.ts` establish the pattern of
  extracting reusable utilities into `utils/`. `mcp/oauth/` follows the same convention scoped
  to the MCP OAuth subsystem.
- **Independent channel adapters**: `buildChannelAdapters(envPrefix)` is already the pattern for
  per-agent, self-contained adapter wiring. Provider directories in `mcp/` follow the same idea
  — each directory is a standalone unit parameterised by its own env vars.
- **`createOAuthRoutes(() => mastra)` lazy getter**: already in use. `createMCPOAuthRoutes` uses
  the same `getMastra: () => Mastra` signature.
- **`LibSQLStore` / `LibSQLOAuthStorage`**: both use libsql. `LibSQLOAuthStorage` owns its own
  `createClient` call today — keeping that pattern means each provider creates its own client,
  which is consistent and avoids hidden shared state.

---

## Execution Plan

1. Create `src/mastra/mcp/oauth/storage.ts` — no deps on other new files
2. Create `src/mastra/mcp/oauth/routes.ts` — imports only `@mastra/core/server` and `@mastra/core/mastra`
3. Create `src/mastra/mcp/slack/index.ts` — imports `../oauth/storage.js` and `../oauth/routes.js`
4. Modify `src/mastra/index.ts` — update import paths, switch to `createMCPOAuthRoutes`
5. Delete `src/mastra/mcp/slack-mcp-client.ts`
6. Delete `src/mastra/routes/oauth.ts` and the empty `routes/` directory

---

## File-by-File Changes

---

### `src/mastra/mcp/oauth/storage.ts` *(Create)*

**Why:** `LibSQLOAuthStorage` contains zero Slack-specific logic. Extracting it means every
future provider imports one class instead of copy-pasting ~45 lines of SQL.

```ts
import { createClient, type Client } from "@libsql/client";
import type { OAuthStorage } from "@mastra/mcp";

export class LibSQLOAuthStorage implements OAuthStorage {
  private ready: Promise<void>;

  constructor(private client: Client, private userId: string) {
    this.ready = this.init();
  }

  private async init(): Promise<void> {
    await this.client.execute(
      `CREATE TABLE IF NOT EXISTS oauth_tokens (
         user_id TEXT NOT NULL,
         key     TEXT NOT NULL,
         value   TEXT NOT NULL,
         PRIMARY KEY (user_id, key)
       )`,
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

export function createLibSQLStorage(
  url: string,
  authToken: string | undefined,
  userId: string,
): LibSQLOAuthStorage {
  return new LibSQLOAuthStorage(createClient({ url, authToken }), userId);
}
```

#### Reasoning
- `createLibSQLStorage` is a convenience factory so provider files don't need to import
  `createClient` directly — they pass env var values and get a ready storage instance.
- `userId` namespaces rows within the shared table. Different providers use different values
  (`"slack-mcp"`, `"github-mcp"`, etc.) so they never collide even if they share a DB file.

---

### `src/mastra/mcp/oauth/routes.ts` *(Create)*

**Why:** Replaces `src/mastra/routes/oauth.ts` with a provider-agnostic factory. Routes are now
named `/oauth/:id/authorize` and `/oauth/:id/callback`, so multiple providers can coexist.
XSS fix (#2) and HTML deduplication are baked in here at the shared layer.

```ts
import { registerApiRoute } from '@mastra/core/server';
import type { Mastra } from '@mastra/core/mastra';

export type MCPOAuthHandlers = {
  startFlow: () => Promise<string>;
  completeFlow: (code: string, getMastra: () => Mastra) => Promise<void>;
};

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#x27;');
}

const HTML_SHELL =
  '<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">' +
  '<style>*{margin:0;padding:0;box-sizing:border-box}body{font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;' +
  'background:#0a0a0a;color:#e5e5e5;display:flex;align-items:center;justify-content:center;min-height:100vh}' +
  '.card{background:#1a1a1a;border:1px solid #2a2a2a;border-radius:12px;padding:48px;text-align:center;max-width:420px;width:90%}' +
  'h1{font-size:24px;margin-bottom:8px;color:#fff}p{font-size:15px;color:#a0a0a0;margin-bottom:32px}' +
  'button{background:#fff;color:#0a0a0a;border:none;border-radius:8px;padding:12px 32px;font-size:15px;font-weight:600;' +
  'cursor:pointer;transition:opacity .2s}button:hover{opacity:.85}</style>' +
  '</head><body><div class="card">__BODY__</div></body></html>';

function oauthHtml(body: string): string {
  return HTML_SHELL.replace('__BODY__', body);
}

export function createMCPOAuthRoutes(
  id: string,
  handlers: MCPOAuthHandlers,
  getMastra: () => Mastra,
) {
  const label = escapeHtml(id);

  return [
    registerApiRoute(`/oauth/${id}/authorize`, {
      method: 'GET',
      requiresAuth: false,
      handler: async (c) => {
        try {
          const authUrl = await handlers.startFlow();
          return c.redirect(authUrl);
        } catch (err) {
          const message = escapeHtml(err instanceof Error ? err.message : String(err));
          return c.html(
            `<h1>${label} OAuth Error</h1>` +
            `<p>Could not start the OAuth flow: ${message}</p>`,
            500,
          );
        }
      },
    }),
    registerApiRoute(`/oauth/${id}/callback`, {
      method: 'GET',
      requiresAuth: false,
      handler: async (c) => {
        const code = c.req.query('code');
        if (!code) {
          return c.html(
            '<h1>OAuth Error</h1><p>Missing <code>code</code> query parameter.</p>',
            400,
          );
        }
        try {
          await handlers.completeFlow(code, getMastra);
          return c.html(
            oauthHtml(
              `<h1>${label} Connected</h1>` +
              `<p>Access tokens saved. Tools are now available.</p>` +
              `<button onclick="window.close()">Close</button>`,
            ),
          );
        } catch (err) {
          const message = escapeHtml(err instanceof Error ? err.message : String(err));
          return c.html(
            oauthHtml(
              `<h1>${label} OAuth Failed</h1>` +
              `<p>${message}</p>` +
              `<button onclick="window.close()">Close</button>`,
            ),
            500,
          );
        }
      },
    }),
  ];
}
```

#### Reasoning
- `MCPOAuthHandlers` is the only contract a provider must implement to plug into the route
  factory. Two functions: start the flow (returns redirect URL), complete the flow (exchanges
  code, registers MCP server).
- `completeFlow` receives `getMastra` so the provider can call `mastra.addMCPServer()` without
  the route layer needing to know about MCP server registration.
- `escapeHtml` lives here because HTML rendering is the route layer's responsibility.
- Route paths use `:id` rather than a slug so a future second provider adds no route boilerplate
  in `index.ts` beyond a second `createMCPOAuthRoutes('github', ...)` spread.

---

### `src/mastra/mcp/slack/index.ts` *(Create — replaces `slack-mcp-client.ts`)*

**Why:** All Slack-specific OAuth logic extracted to its own directory. All 8 code review
fixes are applied here. Nothing in this file is shared; it is the complete, self-contained
Slack MCP OAuth implementation.

**Breaking change:** `SLACK_OAUTH_REDIRECT_URL` default changes from
`http://localhost:4111/oauth/callback` → `http://localhost:4111/oauth/slack/callback`
to match the new route path. Update `SLACK_OAUTH_REDIRECT_URL` in `.env` if overriding the
default, and update the redirect URI registered in the Slack app manifest.

```ts
import {
  MCPClient,
  MCPOAuthClientProvider,
  MCPServer,
  createSimpleTokenProvider,
  auth,
} from "@mastra/mcp";
import { createLibSQLStorage } from "../oauth/storage.js";
import { monitor } from "../../utils/monitor.js";
import type { MCPOAuthHandlers } from "../oauth/routes.js";

const SLACK_MCP_URL = "https://mcp.slack.com/mcp";
const REDIRECT_URL =
  process.env.SLACK_OAUTH_REDIRECT_URL ?? "http://localhost:4111/oauth/slack/callback";

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

const oauthStorage = createLibSQLStorage(
  process.env.SLACK_OAUTH_DATABASE_URL ?? "file:./mastra-oauth.db",
  process.env.SLACK_OAUTH_DATABASE_AUTH_TOKEN,
  "slack-mcp",
);

let pendingAuthUrl: string | null = null;

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

// Fix #3: wrap in try/catch — DB failure at startup degrades gracefully instead of crashing
// Fix #4: guard JSON.parse — malformed stored token triggers re-flow instead of crashing
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
export const getSlackToolsets = () => slackMcpClient.listToolsets();

// Lazy MCPServer construction: only instantiate after OAuth token is available.
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

// Fix #8: guard concurrent flows — explicit error instead of silent URL overwrite
// Fix #7: monitor.slackMcp replaces console.error
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
```

#### Reasoning
- `createLibSQLStorage(url, authToken, userId)` replaces the three-line `createClient` +
  `new LibSQLOAuthStorage(...)` call — one import, one line, same semantics.
- `slackOAuthHandlers` is the `MCPOAuthHandlers` implementation. `completeFlow` owns
  `startSlackMCPServer` because server registration is provider-specific post-OAuth logic.
  The route factory doesn't need to know about it.
- All 8 fixes from the code review are applied: fixes #3 #4 #7 #8 directly; #1 #2 #5 #6 live
  in `index.ts`, `routes.ts`, and `monitor.ts` respectively (unchanged from fix plan).

---

### `src/mastra/index.ts` *(Modify)*

**Action:** Update two import paths and the `apiRoutes` call. Everything else stays identical.

#### Before
```ts
import { startSlackMCPServer } from "./mcp/slack-mcp-client.js";
import { createOAuthRoutes } from "./routes/oauth.js";

...
  server: {
    auth: new SimpleAuth({
      tokens: {
        [process.env.AUTH_GATEWAY_API_KEY!]: {
          id: 'service',
          name: 'Service',
          role: 'admin',
        },
      },
    }),
    apiRoutes: createOAuthRoutes(() => mastra),
  },
...

await startSlackMCPServer(mastra);
```

#### After
```ts
import { startSlackMCPServer, slackOAuthHandlers } from "./mcp/slack/index.js";
import { createMCPOAuthRoutes } from "./mcp/oauth/routes.js";

...
const authToken = process.env.AUTH_GATEWAY_API_KEY;
if (!authToken) throw new Error('AUTH_GATEWAY_API_KEY environment variable is required.');

export const mastra: Mastra = new Mastra({
  ...
  server: {
    auth: new SimpleAuth({
      tokens: {
        [authToken]: {
          id: 'service',
          name: 'Service',
          role: 'admin',
        },
      },
    }),
    apiRoutes: createMCPOAuthRoutes('slack', slackOAuthHandlers, () => mastra),
  },
  ...
});

await startSlackMCPServer(mastra);
```

#### Reasoning
- `createMCPOAuthRoutes('slack', slackOAuthHandlers, () => mastra)` replaces
  `createOAuthRoutes(() => mastra)`. Same lazy getter pattern — no TDZ risk.
- Adding a second provider later is: add `...createMCPOAuthRoutes('github', githubOAuthHandlers, () => mastra)` spread in the `apiRoutes` array. One line. Zero changes to `slack/index.ts`.
- The `authToken` guard (fix #1) is included here per the fix plan.

---

### `src/mastra/mcp/slack-mcp-client.ts` *(Delete)*

Fully replaced by `src/mastra/mcp/slack/index.ts`. All exports are preserved at the same names:
`slackMcpClient`, `getSlackToolsets`, `startSlackMCPServer`. No other files import from this
module — `index.ts` and `routes/oauth.ts` are the only importers, and both are updated above.

---

### `src/mastra/routes/oauth.ts` *(Delete)*

Fully replaced by `src/mastra/mcp/oauth/routes.ts`. The `routes/` directory becomes empty and
should be removed along with the file.

---

## Adding a Second Provider (Example)

To add GitHub OAuth MCP, after this refactor is merged:

```
src/mastra/mcp/
└── github/
    └── index.ts    ← copy structure from slack/index.ts, change:
                       GITHUB_MCP_URL, GITHUB_SCOPES, GITHUB_CLIENT_ID/SECRET env vars,
                       userId: "github-mcp", MCPServer id: "github"
                       export githubOAuthHandlers: MCPOAuthHandlers
```

Then in `index.ts`:
```ts
import { startGithubMCPServer, githubOAuthHandlers } from "./mcp/github/index.js";

apiRoutes: [
  ...createMCPOAuthRoutes('slack', slackOAuthHandlers, () => mastra),
  ...createMCPOAuthRoutes('github', githubOAuthHandlers, () => mastra),
],
```

`LibSQLOAuthStorage`, `createMCPOAuthRoutes`, `escapeHtml`, and the HTML shell are inherited
for free. Zero modifications to any existing file.

---

## Validation Plan

```bash
# Type-check
bun run tsc --noEmit

# Start dev server — confirm clean startup
mastra dev

# Manual smoke tests:
# 1. GET /oauth/slack/authorize  → redirects to Slack (or styled error if SLACK_CLIENT_ID unset)
# 2. GET /oauth/callback         → 404 (old path must no longer exist)
# 3. Auth rejection (bad API key) → warn-level log visible without DEBUG=true
# 4. Start without AUTH_GATEWAY_API_KEY → clear error at startup, server exits
# 5. Simulate malformed stored token → server starts, Slack tools unavailable, no crash
```

---

## Risk Notes

- **Redirect URI change is a breaking config change**: `SLACK_OAUTH_REDIRECT_URL` default
  changes from `/oauth/callback` to `/oauth/slack/callback`. Any deployment that has
  already completed an OAuth flow and stored a token is unaffected (token reuse does not
  hit the callback URL). The change only matters for new OAuth flows. Update the registered
  redirect URI in your Slack app manifest and `.env` before triggering a new flow.
- **`getSlackToolsets`**: exported from the new path — if any agent file imports it directly
  (none do currently), update the import to `./mcp/slack/index.js`.
- **No DB schema changes**: `LibSQLOAuthStorage` table DDL is identical. Existing stored
  tokens carry over without migration.

---

## Approval

`Status: Awaiting explicit user approval. Do not implement yet.`
