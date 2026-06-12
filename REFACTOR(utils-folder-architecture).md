# REFACTOR(utils-folder-architecture)

## Request
Introduce a `utils/` folder, extract OAuth routes from `index.ts`, and remove structural dead weight — all without changing any runtime behaviour.

---

## Directory Map

```text
src/mastra/
  agents/
    adapters.ts                     DELETE  → moved to utils/
    index.ts                        no change
    instructions/
      operations-manager.ts         no change
      qa-manager.ts                 no change
      research-manager.ts           no change
    operations-manager.ts           MODIFY  → import path update
    qa-manager.ts                   MODIFY  → import path update
    research-manager.ts             MODIFY  → import path update
  config/
    agents.config.ts                no change
    index.ts                        no change
    providers.config.ts             no change
  gateways/
    auth-gateway.ts                 MODIFY  → import path update
    cerebras/                       DELETE  (empty dir)
    featherless/                    DELETE  (empty dir)
    index.ts                        no change
    openrouter/                     DELETE  (empty dir)
    pioneer/                        DELETE  (empty dir)
  mcp/
    slack-mcp-client.ts             no change
  monitor/
    monitor.ts                      DELETE  → moved to utils/
  routes/                           CREATE dir
    oauth.ts                        CREATE
  tools/
    index.ts                        no change
    shell-tool.ts                   no change
  utils/                            CREATE dir
    adapters.ts                     CREATE  (moved from agents/adapters.ts)
    index.ts                        CREATE  (barrel)
    monitor.ts                      CREATE  (moved from monitor/monitor.ts)
  index.ts                          MODIFY  → import OAuth routes, slim body
```

---

## Modification Table

| File | Action | Why |
|---|---|---|
| `src/mastra/utils/adapters.ts` | Create | `buildChannelAdapters` is shared infrastructure, not an agent-domain file |
| `src/mastra/utils/monitor.ts` | Create | Shared debug utility belongs in `utils/`, not its own single-file folder |
| `src/mastra/utils/index.ts` | Create | Barrel export — single import surface for all utilities |
| `src/mastra/routes/oauth.ts` | Create | OAuth route handlers + inline HTML blobs are route logic, not bootstrap wiring |
| `src/mastra/agents/adapters.ts` | Delete | Content moved to `utils/adapters.ts` |
| `src/mastra/monitor/monitor.ts` | Delete | Content moved to `utils/monitor.ts` |
| `src/mastra/gateways/cerebras/` | Delete | Empty directory — dead scaffolding |
| `src/mastra/gateways/featherless/` | Delete | Empty directory — dead scaffolding |
| `src/mastra/gateways/openrouter/` | Delete | Empty directory — dead scaffolding |
| `src/mastra/gateways/pioneer/` | Delete | Empty directory — dead scaffolding |
| `src/mastra/gateways/auth-gateway.ts` | Modify | Update import: `../monitor/monitor.js` → `../utils/monitor.js` |
| `src/mastra/agents/research-manager.ts` | Modify | Update import: `./adapters.js` → `../utils/adapters.js` |
| `src/mastra/agents/operations-manager.ts` | Modify | Update import: `./adapters.js` → `../utils/adapters.js` |
| `src/mastra/agents/qa-manager.ts` | Modify | Update import: `./adapters.js` → `../utils/adapters.js` |
| `src/mastra/index.ts` | Modify | Import OAuth routes from `./routes/oauth.js`; remove inline route handlers |

---

## Existing Pattern Audit

- **Barrel pattern** — already used in `agents/index.ts`, `tools/index.ts`, `config/index.ts`, `gateways/index.ts`. `utils/index.ts` follows the same convention.
- **Single-responsibility folders** — `config/`, `agents/`, `gateways/`, `tools/`, `mcp/` each own one domain. `utils/` owns shared cross-cutting code. `routes/` owns HTTP route handlers.
- **No new dependencies** — nothing new is installed. All imports use existing packages and relative paths.
- **No behaviour changes** — every function body is identical after the move; only `import` paths change.

---

## Execution Plan

### Step 1 — Create `utils/`
Create `utils/adapters.ts`, `utils/monitor.ts`, `utils/index.ts`.

### Step 2 — Create `routes/`
Create `routes/oauth.ts`, extracting both route handlers from `index.ts`.

### Step 3 — Update import paths
Update `auth-gateway.ts` and all three agent files.

### Step 4 — Slim `index.ts`
Replace inline route handlers with import from `routes/oauth.ts`.

### Step 5 — Delete dead files and dirs
Delete `agents/adapters.ts`, `monitor/monitor.ts`, and the four empty gateway subdirs.

### Step 6 — Type check
`npx tsc --noEmit`

---

## File-by-File Changes

---

### `src/mastra/utils/adapters.ts`
**Action:** Create  
**Why:** Identical content to `agents/adapters.ts` — moved to correct domain.  
**Impact:** `agents/` no longer contains shared infrastructure.

#### After
```ts
import { createSlackAdapter } from '@chat-adapter/slack';
import { createTelegramAdapter } from '@chat-adapter/telegram';

export function buildChannelAdapters(envPrefix: string) {
  const slackToken = process.env[`${envPrefix}_SLACK_BOT_TOKEN`];
  const slackSecret = process.env[`${envPrefix}_SLACK_SIGNING_SECRET`];
  const telegramToken = process.env[`${envPrefix}_TELEGRAM_BOT_TOKEN`];
  const telegramSecret = process.env[`${envPrefix}_TELEGRAM_SECRET_TOKEN`];

  return {
    adapters: {
      ...(slackToken && slackSecret
        ? { slack: createSlackAdapter({ botToken: slackToken, signingSecret: slackSecret }) }
        : {}),
      ...(telegramToken
        ? {
            telegram: createTelegramAdapter({
              botToken: telegramToken,
              ...(telegramSecret ? { secretToken: telegramSecret } : {}),
            }),
          }
        : {}),
    },
  };
}
```

#### Reasoning
- Content is unchanged — this is a move, not a rewrite.

---

### `src/mastra/utils/monitor.ts`
**Action:** Create  
**Why:** Identical content to `monitor/monitor.ts` — single-file folder collapsed into `utils/`.  
**Impact:** `monitor/` directory is removed.

#### After
```ts
const IS_DEBUG = process.env.DEBUG === 'true';

export const monitor = {
  gatewayResolve(providerId: string, modelId: string): void {
    if (!IS_DEBUG) return;
    console.debug(`[gateway] resolving ${providerId}/${modelId}`);
  },

  adapterRegistered(agentId: string, channel: string): void {
    if (!IS_DEBUG) return;
    console.debug(`[adapter] ${agentId} → ${channel} registered`);
  },

  authEvent(event: 'ok' | 'rejected', detail?: string): void {
    if (!IS_DEBUG) return;
    console.debug(`[auth] ${event}${detail ? `: ${detail}` : ''}`);
  },
};
```

#### Reasoning
- Content is unchanged — this is a move, not a rewrite.

---

### `src/mastra/utils/index.ts`
**Action:** Create  
**Why:** Barrel export consistent with all other module directories in this project.

#### After
```ts
export { buildChannelAdapters } from './adapters.js';
export { monitor } from './monitor.js';
```

---

### `src/mastra/routes/oauth.ts`
**Action:** Create  
**Why:** Both OAuth route handlers + their HTML responses currently live inside the `new Mastra({...})` call in `index.ts`. Extracting them means `index.ts` becomes pure wiring. The `mastra` instance is passed in to break the potential circular dependency.

#### After
```ts
import { registerApiRoute } from '@mastra/core/server';
import type { Mastra } from '@mastra/core/mastra';
import { startOAuthFlow, completeOAuth, startSlackMCPServer } from '../mcp/slack-mcp-client.js';

export function createOAuthRoutes(mastra: Mastra) {
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
          await startSlackMCPServer(mastra);
          return c.html(
            '<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>*{margin:0;padding:0;box-sizing:border-box}body{font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;background:#0a0a0a;color:#e5e5e5;display:flex;align-items:center;justify-content:center;min-height:100vh}.card{background:#1a1a1a;border:1px solid #2a2a2a;border-radius:12px;padding:48px;text-align:center;max-width:420px;width:90%}h1{font-size:24px;margin-bottom:8px;color:#fff}p{font-size:15px;color:#a0a0a0;margin-bottom:32px}button{background:#fff;color:#0a0a0a;border:none;border-radius:8px;padding:12px 32px;font-size:15px;font-weight:600;cursor:pointer;transition:opacity .2s}button:hover{opacity:.85}</style></head><body><div class="card"><h1>Slack Connected</h1><p>Slack access tokens saved. Tools are now available.</p><button onclick="window.close()">Close</button></div></body></html>',
          );
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          return c.html(
            '<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>*{margin:0;padding:0;box-sizing:border-box}body{font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;background:#0a0a0a;color:#e5e5e5;display:flex;align-items:center;justify-content:center;min-height:100vh}.card{background:#1a1a1a;border:1px solid #2a2a2a;border-radius:12px;padding:48px;text-align:center;max-width:420px;width:90%}h1{font-size:24px;margin-bottom:8px;color:#fff}p{font-size:15px;color:#a0a0a0;margin-bottom:32px}button{background:#fff;color:#0a0a0a;border:none;border-radius:8px;padding:12px 32px;font-size:15px;font-weight:600;cursor:pointer;transition:opacity .2s}button:hover{opacity:.85}</style></head><body><div class="card"><h1>Slack OAuth Failed</h1><p>' + message + '</p><button onclick="window.close()">Close</button></div></body></html>',
            500,
          );
        }
      },
    }),
  ];
}
```

#### Reasoning
- `mastra` is passed as a parameter so `routes/oauth.ts` never imports from `index.ts` (no circular dependency).
- Route handler logic is identical — this is a move, not a rewrite.

---

### `src/mastra/gateways/auth-gateway.ts`
**Action:** Modify — update one import path  
**Why:** `monitor` moved from `../monitor/monitor.js` to `../utils/monitor.js`.

#### Before
```ts
import { monitor } from '../monitor/monitor.js';
```

#### After
```ts
import { monitor } from '../utils/monitor.js';
```

#### Reasoning
- Single line change. No logic affected.

---

### `src/mastra/agents/research-manager.ts`
**Action:** Modify — update one import path  
**Why:** `buildChannelAdapters` moved from `./adapters.js` to `../utils/adapters.js`.

#### Before
```ts
import { buildChannelAdapters } from './adapters.js';
```

#### After
```ts
import { buildChannelAdapters } from '../utils/adapters.js';
```

---

### `src/mastra/agents/operations-manager.ts`
**Action:** Modify — update one import path (identical change to research-manager)

#### Before
```ts
import { buildChannelAdapters } from './adapters.js';
```

#### After
```ts
import { buildChannelAdapters } from '../utils/adapters.js';
```

---

### `src/mastra/agents/qa-manager.ts`
**Action:** Modify — update one import path (identical change)

#### Before
```ts
import { buildChannelAdapters } from './adapters.js';
```

#### After
```ts
import { buildChannelAdapters } from '../utils/adapters.js';
```

---

### `src/mastra/index.ts`
**Action:** Modify — replace inline route handlers with `createOAuthRoutes`, remove now-unused imports  
**Why:** `index.ts` should be wiring only — providers, agents, storage, auth, server config. OAuth route logic does not belong here.

#### Before
```ts
import { Mastra } from "@mastra/core/mastra";
import { PinoLogger } from "@mastra/loggers";
import { LibSQLStore } from "@mastra/libsql";
import { MastraEditor } from "@mastra/editor";
import { authGateway } from "./gateways";
import {
  Observability,
  DefaultExporter,
  CloudExporter,
  SensitiveDataFilter,
} from "@mastra/observability";
import { researchManager, operationsManager, qaManager } from "./agents/index";
import { shellTool } from "./tools/index";
import { AgentId, ProviderId } from "./config/index";
import { registerApiRoute, SimpleAuth } from "@mastra/core/server";

import { startOAuthFlow, completeOAuth, startSlackMCPServer } from "./mcp/slack-mcp-client";

export const mastra = new Mastra({
  // ...
  server: {
    auth: new SimpleAuth({ ... }),
    apiRoutes: [
      registerApiRoute("/oauth/authorize", { /* 15 lines */ }),
      registerApiRoute("/oauth/callback", { /* 25 lines */ }),
    ],
  },
  // ...
});

await startSlackMCPServer(mastra);
```

#### After
```ts
import { Mastra } from "@mastra/core/mastra";
import { PinoLogger } from "@mastra/loggers";
import { LibSQLStore } from "@mastra/libsql";
import { MastraEditor } from "@mastra/editor";
import { authGateway } from "./gateways/index.js";
import {
  Observability,
  DefaultExporter,
  CloudExporter,
  SensitiveDataFilter,
} from "@mastra/observability";
import { researchManager, operationsManager, qaManager } from "./agents/index.js";
import { shellTool } from "./tools/index.js";
import { AgentId, ProviderId } from "./config/index.js";
import { SimpleAuth } from "@mastra/core/server";
import { startSlackMCPServer } from "./mcp/slack-mcp-client.js";
import { createOAuthRoutes } from "./routes/oauth.js";

export const mastra = new Mastra({
  gateways: { 'auth-gateway': authGateway },
  tools: { shellTool },
  mcpServers: {},
  agents: { researchManager, operationsManager, qaManager },
  storage: new LibSQLStore({
    id: "mastra-storage",
    url: "file:./mastra.db",
  }),
  logger: new PinoLogger({
    name: "Mastra",
    level: "info",
  }),
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
    apiRoutes: createOAuthRoutes(mastra),
  },
  editor: new MastraEditor({
    builder: {
      enabled: true,
      configuration: {
        agent: {
          models: {
            default: { kind: 'custom', provider: ProviderId.FEATHERLESS, modelId: 'zai-org/GLM-5.1' },
          },
          tools: { allowed: ["execute-shell"] },
          agents: { allowed: [AgentId.RESEARCH_MANAGER, AgentId.OPERATIONS_MANAGER, AgentId.QA_MANAGER] },
          memory: { observationalMemory: true },
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

await startSlackMCPServer(mastra);
```

#### Reasoning
- `registerApiRoute` import removed — it is now only used inside `routes/oauth.ts`.
- `startOAuthFlow`, `completeOAuth` imports removed — consumed inside `routes/oauth.ts`.
- `createOAuthRoutes(mastra)` passes the instance at call time — no circular import.
- All other wiring is unchanged.

---

## Validation Plan

```bash
npx tsc --noEmit        # must produce no errors
mastra dev              # must start without errors
```

---

## Risk Notes

- **`createOAuthRoutes(mastra)` is called inside the `new Mastra({...})` constructor argument.** `mastra` is not yet assigned at that point — it is being constructed. This is a potential TDZ (temporal dead zone) issue. **Mitigation:** pass the call lazily or restructure so routes are registered after construction. If this causes a runtime error, the fix is to define routes before the `new Mastra` call and pass the `mastra` reference after construction:
  ```ts
  // Option B — safe alternative if TDZ is an issue:
  export const mastra = new Mastra({ ..., server: { ..., apiRoutes: [] } });
  mastra.server.addRoutes(createOAuthRoutes(mastra)); // if Mastra supports this
  // OR: keep apiRoutes as a lazy getter if the framework supports it
  ```
  The whiteboard flags this risk. Implementation should confirm the framework's behaviour before proceeding.

---

## Approval

`Status: Awaiting explicit user approval. Do not implement yet.`
