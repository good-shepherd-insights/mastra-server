# FIX(security-and-correctness-findings)

## Request

Fix 8 findings surfaced by code review — 1 critical, 4 high, 1 medium, 2 low — across
auth configuration, OAuth routes, Slack MCP module, monitor utility, and agent config.

---

## Directory Map

```text
src/mastra/
├── index.ts                        MODIFY  — guard AUTH_GATEWAY_API_KEY before SimpleAuth construction
├── config/
│   └── agents.config.ts            MODIFY  — guard models[0] with startup assertion
├── utils/
│   └── monitor.ts                  MODIFY  — auth rejections logged unconditionally, not DEBUG-gated
├── routes/
│   └── oauth.ts                    MODIFY  — HTML-escape err.message in both error responses
└── mcp/
    └── slack-mcp-client.ts         MODIFY  — wrap top-level await, guard JSON.parse,
                                             replace console.error, guard concurrent OAuth
```

---

## Modification Table

| File | Action | Finding # | Why |
|---|---|---|---|
| `src/mastra/index.ts` | Modify | #1 CRITICAL | Unset env var → key `'undefined'` → silent admin bypass |
| `src/mastra/routes/oauth.ts` | Modify | #2 HIGH | Raw `err.message` in HTML → reflected XSS on public endpoints |
| `src/mastra/mcp/slack-mcp-client.ts` | Modify | #3 HIGH | Top-level `await` DB read — DB failure crashes server at startup |
| `src/mastra/mcp/slack-mcp-client.ts` | Modify | #4 HIGH | Unguarded `JSON.parse` → throw on malformed stored token at module load |
| `src/mastra/utils/monitor.ts` | Modify | #5 HIGH | Auth rejections gated behind `IS_DEBUG` — no audit trail in production |
| `src/mastra/config/agents.config.ts` | Modify | #6 MEDIUM | `models[0]` on empty array → silent `'auth-gateway/featherless/undefined'` |
| `src/mastra/mcp/slack-mcp-client.ts` | Modify | #7 LOW | `console.error` in `startOAuthFlow` not replaced with `monitor` |
| `src/mastra/mcp/slack-mcp-client.ts` | Modify | #8 LOW | `pendingAuthUrl` singleton — concurrent flows overwrite each other silently |

---

## Existing Pattern Audit

- **Environment variable access**: rest of codebase uses explicit `if (!envVar) throw` guards
  (`auth-gateway.ts:29-31`, `buildChannelAdapters` conditionals). `index.ts` is the only place
  using `!` non-null assertion directly as an object key — this fix brings it in line.
- **Error logging**: `monitor.slackMcp` is already the established pattern for operational
  events in `slack-mcp-client.ts`. The `console.error` on line 181 predates the migration.
- **Startup assertions**: Mastra modules already throw at import time for bad config
  (`auth-gateway.ts:55-58`). A fast-fail assertion in `agents.config.ts` follows the same convention.
- **HTML responses**: both error responses in `oauth.ts` share identical structure and CSS.
  A shared HTML template constant is the natural deduplication (Simplification finding from review).
  This fix handles XSS and deduplication together since both require touching the same lines.

---

## Execution Plan

1. `monitor.ts` — make auth rejections unconditional (no deps on other changes)
2. `agents.config.ts` — add models[0] startup guard (no deps)
3. `index.ts` — add AUTH_GATEWAY_API_KEY guard before Mastra construction
4. `routes/oauth.ts` — add `escapeHtml` helper, apply to both error responses, deduplicate HTML
5. `slack-mcp-client.ts` — wrap top-level await (fix #3 + #4 together), replace console.error (#7), guard concurrent OAuth (#8)

---

## File-by-File Changes

---

### `src/mastra/utils/monitor.ts`

**Action:** Modify
**Why:** `authEvent('rejected', ...)` is a security event. It must write a record regardless of
`DEBUG`. Legitimate ops staff cannot set `DEBUG=true` in production without exposing all debug
output. The fix logs `rejected` unconditionally at `warn` level, and `ok` only in debug mode.
**Impact:** Auth rejection events now always appear in the Mastra/Pino log stream.

#### Before
```ts
authEvent(event: 'ok' | 'rejected', detail?: string): void {
  if (!IS_DEBUG) return;
  console.debug(`[auth] ${event}${detail ? `: ${detail}` : ''}`);
},
```

#### After
```ts
authEvent(event: 'ok' | 'rejected', detail?: string): void {
  if (event === 'rejected') {
    console.warn(`[auth] rejected${detail ? `: ${detail}` : ''}`);
    return;
  }
  if (!IS_DEBUG) return;
  console.debug(`[auth] ok${detail ? `: ${detail}` : ''}`);
},
```

#### Reasoning
- `console.warn` is unconditional — every rejected auth call leaves a record.
- `ok` events remain debug-only; they're not security-relevant.
- `console.warn` is consistent with how Mastra's own PinoLogger surfaces warnings — it will
  appear at the `warn` log level in the Pino output Mastra controls.

---

### `src/mastra/config/agents.config.ts`

**Action:** Modify
**Why:** `models[0]` on an empty array is `undefined`. TypeScript types this as `string` because
`noUncheckedIndexedAccess` is not enabled (`strict: true` does not include it). A fast-fail
assertion turns a silent misconfiguration into a clear startup error.
**Impact:** Server refuses to start with a clear message if Featherless has no models configured,
instead of running with `'auth-gateway/featherless/undefined'` as the model string.

#### Before
```ts
export const DEFAULT_AGENT_MODEL =
  `auth-gateway/${ProviderId.FEATHERLESS}/${PROVIDER_REGISTRY[ProviderId.FEATHERLESS].models[0]}` as const;
```

#### After
```ts
const _featherlessModels = PROVIDER_REGISTRY[ProviderId.FEATHERLESS].models;
if (_featherlessModels.length === 0) {
  throw new Error('PROVIDER_REGISTRY[featherless].models is empty — at least one model must be defined.');
}

export const DEFAULT_AGENT_MODEL =
  `auth-gateway/${ProviderId.FEATHERLESS}/${_featherlessModels[0]}` as const;
```

#### Reasoning
- The `_` prefix signals the variable is an internal guard step, not an exported value.
- Throwing at module evaluation time is the established pattern in this codebase
  (`auth-gateway.ts` throws immediately for missing env vars).
- `index.ts` line 49 also accesses `models[0]` directly. Because `agents.config.ts` is imported
  by `index.ts`, the assertion there fires first — if the array is empty, the server exits before
  `index.ts` evaluates. No separate guard is needed in `index.ts`.

---

### `src/mastra/index.ts`

**Action:** Modify
**Why:** `process.env.AUTH_GATEWAY_API_KEY!` — the `!` non-null assertion is erased at runtime.
If the env var is unset, the computed property key becomes the string `'undefined'`, so any
client presenting that literal value authenticates as admin.
**Impact:** Server refuses to start if `AUTH_GATEWAY_API_KEY` is not set. Removes the
`'undefined'`-as-admin-token vulnerability.

#### Before
```ts
export const mastra: Mastra = new Mastra({
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
```

#### After
```ts
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
    apiRoutes: createOAuthRoutes(() => mastra),
  },
  ...
```

#### Reasoning
- The guard is placed before `new Mastra(...)` so the server never enters a misconfigured state.
- `authToken` is a `const string` (narrowed from `string | undefined` by the `if (!authToken)` throw),
  so the computed property key is always a non-empty string.
- `auth-gateway.ts:29-31` already has an identical guard for the same env var in `getApiKey()`.
  This guard is earlier and prevents the `SimpleAuth` object literal from ever being built with
  an undefined key.

---

### `src/mastra/routes/oauth.ts`

**Action:** Modify
**Why:** `err.message` is interpolated raw into both HTML error responses on `requiresAuth: false`
endpoints. If an attacker can influence the error message (e.g. by crafting a redirect URL whose
processing causes an error with a controllable message), the response contains unsanitised HTML.
Both responses also share identical CSS (95% identical), which is duplication — this fix
addresses both at once since both sections are touched.
**Impact:** Removes reflected XSS risk. Deduplicates the shared HTML shell.

#### Before
```ts
import { registerApiRoute } from '@mastra/core/server';
import type { Mastra } from '@mastra/core/mastra';
import { startOAuthFlow, completeOAuth, startSlackMCPServer } from '../mcp/slack-mcp-client.js';

export function createOAuthRoutes(getMastra: () => Mastra) {
  return [
    registerApiRoute('/oauth/authorize', {
      method: 'GET',
      requiresAuth: false,
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
    }),
    registerApiRoute('/oauth/callback', {
      ...
      handler: async (c) => {
        ...
        try {
          await completeOAuth(code);
          await startSlackMCPServer(getMastra());
          return c.html(
            '<!DOCTYPE html>...<p>Slack access tokens saved. Tools are now available.</p>...',
          );
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          return c.html(
            '<!DOCTYPE html>...<p>' + message + '</p>...',
            500,
          );
        }
      },
    }),
  ];
}
```

#### After
```ts
import { registerApiRoute } from '@mastra/core/server';
import type { Mastra } from '@mastra/core/mastra';
import { startOAuthFlow, completeOAuth, startSlackMCPServer } from '../mcp/slack-mcp-client.js';

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#x27;');
}

const HTML_SHELL = `<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>*{margin:0;padding:0;box-sizing:border-box}body{font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;background:#0a0a0a;color:#e5e5e5;display:flex;align-items:center;justify-content:center;min-height:100vh}.card{background:#1a1a1a;border:1px solid #2a2a2a;border-radius:12px;padding:48px;text-align:center;max-width:420px;width:90%}h1{font-size:24px;margin-bottom:8px;color:#fff}p{font-size:15px;color:#a0a0a0;margin-bottom:32px}button{background:#fff;color:#0a0a0a;border:none;border-radius:8px;padding:12px 32px;font-size:15px;font-weight:600;cursor:pointer;transition:opacity .2s}button:hover{opacity:.85}</style></head><body><div class="card">__BODY__</div></body></html>`;

function oauthHtml(body: string): string {
  return HTML_SHELL.replace('__BODY__', body);
}

export function createOAuthRoutes(getMastra: () => Mastra) {
  return [
    registerApiRoute('/oauth/authorize', {
      method: 'GET',
      requiresAuth: false,
      handler: async (c) => {
        try {
          const authUrl = await startOAuthFlow();
          return c.redirect(authUrl);
        } catch (err) {
          const message = escapeHtml(err instanceof Error ? err.message : String(err));
          return c.html(
            '<h1>Slack OAuth Error</h1>' +
            `<p>Could not start the OAuth flow: ${message}</p>` +
            '<p>Check that <code>SLACK_CLIENT_ID</code> and <code>SLACK_CLIENT_SECRET</code> are set in your environment.</p>',
            500,
          );
        }
      },
    }),
    registerApiRoute('/oauth/callback', {
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
          await completeOAuth(code);
          await startSlackMCPServer(getMastra());
          return c.html(
            oauthHtml('<h1>Slack Connected</h1><p>Slack access tokens saved. Tools are now available.</p><button onclick="window.close()">Close</button>'),
          );
        } catch (err) {
          const message = escapeHtml(err instanceof Error ? err.message : String(err));
          return c.html(
            oauthHtml(`<h1>Slack OAuth Failed</h1><p>${message}</p><button onclick="window.close()">Close</button>`),
            500,
          );
        }
      },
    }),
  ];
}
```

#### Reasoning
- `escapeHtml` is a pure local function — no external dep, five single-line replacements covering
  the five HTML special characters. This is the standard minimal approach used throughout the web
  when a full sanitisation library is not warranted.
- `oauthHtml` + `HTML_SHELL` replaces the duplicated 95%-identical CSS blob with one constant.
  The `__BODY__` sentinel is safe because it is replaced before the response is sent, not stored.
- The simple `<h1>…</h1><p>…</p>` error on `/oauth/authorize` is not worth wrapping in
  `oauthHtml` (it has no styled shell), but `err.message` is still escaped there.

---

### `src/mastra/mcp/slack-mcp-client.ts`

**Action:** Modify (4 findings addressed in one file)
**Why:**
- **#3**: Top-level `await oauthStorage.get('tokens')` — DB failure at module evaluation crashes
  the server with no recovery. Wrapping in try/catch lets the server start without Slack if the
  DB is unavailable.
- **#4**: `JSON.parse(savedToken).access_token` — no guard against malformed JSON. Wrapping
  in try/catch handles corruption; optional chaining handles missing `access_token`.
- **#7**: `console.error` in `startOAuthFlow` was not replaced in the monitor migration.
- **#8**: `pendingAuthUrl` singleton allows a second concurrent `/oauth/authorize` call to
  overwrite the first call's URL. Throw early if a flow is already in progress.

**Impact:**
- DB failure at startup is handled gracefully; server starts, Slack tools unavailable until DB
  recovers on next restart.
- Malformed stored token is handled gracefully; OAuth re-flow is triggered rather than server crash.
- All logging is consistently routed through `monitor`.
- Concurrent OAuth start is an explicit error rather than a silent wrong-URL bug.

#### Before (lines 95–109, the top-level await block)
```ts
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
  monitor.slackMcp('token-reused');
}
```

#### After (lines 95–119 replacement)
```ts
// Per Mastra docs Pattern 4: createSimpleTokenProvider for token rehydration.
// Both awaits are wrapped: DB failure at startup should degrade gracefully, not crash the server.
let _savedToken: string | undefined;
try {
  _savedToken = await oauthStorage.get("tokens");
} catch (err) {
  monitor.slackMcp('storage-read-failed', err instanceof Error ? err.message : String(err));
}

let _accessToken: string | undefined;
if (_savedToken) {
  try {
    _accessToken = JSON.parse(_savedToken)?.access_token;
  } catch {
    monitor.slackMcp('token-parse-failed', 'stored token is malformed JSON — OAuth re-flow required');
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
  monitor.slackMcp('token-reused');
}
```

#### Before (lines 168–192, `startOAuthFlow`)
```ts
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
```

#### After (lines 168–192 replacement)
```ts
export async function startOAuthFlow(): Promise<string> {
  if (pendingAuthUrl !== null) {
    throw new Error('An OAuth flow is already in progress. Complete or cancel the existing flow before starting a new one.');
  }

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
    monitor.slackMcp('oauth-discovery-failed', err.message);
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
- `_savedToken` / `_accessToken` underscore prefix marks them as internal guard-step variables
  (same convention as `_featherlessModels` above).
- `?.access_token` handles the missing-key case — `_accessToken` becomes `undefined` and the
  ternary falls back to `oauthProvider` without crashing.
- The `pendingAuthUrl !== null` guard at the top of `startOAuthFlow` converts the silent
  overwrite race into an explicit error the caller can surface to the user.
- `monitor.slackMcp('oauth-discovery-failed', ...)` is IS_DEBUG-gated — that is acceptable here
  because `startOAuthFlow` immediately rethrows, so the error is visible to the caller regardless.
  This is consistent with how the rest of `slack-mcp-client.ts` uses monitor.

---

## Validation Plan

```bash
# Type-check only (no build needed to verify types)
bun run tsc --noEmit

# Start the dev server and confirm it starts cleanly
mastra dev

# Manual smoke tests:
# 1. Start without AUTH_GATEWAY_API_KEY set — should exit with clear error message
# 2. Start with AUTH_GATEWAY_API_KEY set — should start normally
# 3. Visit /oauth/authorize — should redirect to Slack (or show styled error if Slack env vars missing)
# 4. Verify error page contains no raw HTML in the message (test with SLACK_CLIENT_ID unset)
# 5. Confirm auth rejection appears in logs without DEBUG=true set
```

---

## Risk Notes

- **No behaviour changes for the happy path** — all changes are guard clauses on error/edge paths.
  Module startup with all env vars set and a healthy DB is completely unaffected.
- **`startSlackMCPServer` at index.ts:75** calls `oauthStorage.get('tokens')` again (not
  the cached `_savedToken`). This is intentional per existing design — the function already
  handles the `!token` case with an early return. If the DB was unavailable at module load but
  recovers later, `startSlackMCPServer` could still succeed. No change needed there.
- **`_accessToken` vs `savedToken` naming** — the existing `if (savedToken)` gate that guarded
  `monitor.slackMcp('token-reused')` is replaced with `if (_accessToken)` — this is semantically
  tighter (we only log reuse if the token was actually parsed and usable, not just if a string
  was present in storage).

---

## Approval

`Status: Awaiting explicit user approval. Do not implement yet.`
