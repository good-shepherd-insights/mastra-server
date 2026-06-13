# FEATURE(shared-memory-telegram-dedup)

## Request

Add shared memory across all three manager agents (`researchManager`, `operationsManager`, `qaManager`) so they maintain a common knowledge base across conversations. Add persistent Telegram update deduplication so Telegram webhook retries are not processed twice across restarts.

## Dependency

This feature must be rebased onto — or merged after — PR #20 (`feat/postgresql-storage`). Both shared memory and persistent dedup require `PostgresStoreVNext` / a live `DATABASE_URL`.

---

## Research Findings (verified against installed source + official packages)

### 1. Dedup is already built into the `chat` package — we do not write it

`chat/dist/index.js:3446` — `processMessage` deduplicates every incoming message before routing:

```js
const dedupeKey = `dedupe:${adapter.name}:${message.id}`;
const isFirstProcess = await this._stateAdapter.setIfNotExists(dedupeKey, true, this._dedupeTtlMs);
if (!isFirstProcess) {
  this.logger.debug('Skipping duplicate message', { messageId: message.id });
  return;
}
```

Telegram webhook retries deliver the same `message.id`, so `setIfNotExists` returns `false` and the retry is dropped. **The deduplication logic exists; only its persistence layer matters.**

### 2. The gap: the default state adapter is in-memory

`@mastra/core`'s `MastraStateAdapter` (`channels/state-adapter.d.ts`) keeps cache, locks, queues, and **dedup keys in-memory** — its own doc comment says so:
> *"Cache, locks, and dedup keys remain in-memory — they are inherently short-lived ... and don't need persistence."*

On restart, dedup state is lost. A Telegram retry arriving during a restart/cold-start window is reprocessed as new.

### 3. The proven pattern: official `@chat-adapter/state-pg` package

The `chat` SDK README and official guides (`how-to-build-a-slack-bot-with-next-js-and-redis.md`, etc.) document state persistence via dedicated adapter packages:

```
@chat-adapter/state-memory   — development/testing (the in-memory default)
@chat-adapter/state-redis    — production (Redis)
@chat-adapter/state-pg       — production (PostgreSQL)   ← matches our Neon stack
```

`@chat-adapter/state-pg@4.30.0` (verified — same version line as the `@chat-adapter/slack` and `@chat-adapter/telegram` packages already in `package.json`) exports `createPostgresState()` which returns a `PostgresStateAdapter implements StateAdapter`. Verified API from the package's `.d.ts`:

```ts
function createPostgresState(options?: PostgresStateAdapterOptions): PostgresStateAdapter;

type PostgresStateAdapterOptions =
  | { url?: string;       keyPrefix?: string; logger?: Logger }   // url defaults to POSTGRES_URL / DATABASE_URL
  | { client: pg.Pool;    keyPrefix?: string; logger?: Logger };  // reuse an existing pool
```

- Implements the **full** `StateAdapter` interface — subscriptions, locks, queues, cache, and `setIfNotExists` — all PostgreSQL-backed and persistent across restarts.
- Manages its own schema (`private ensureSchema`).
- Auto-reads `DATABASE_URL` when `url` is omitted.
- `keyPrefix` defaults to `"chat-sdk"`.
- `dependencies: { pg: "^8.20.0", chat: "4.30.0" }` — `pg` is already in our tree via `@mastra/pg`; `chat 4.30.0` matches the installed `chat` version.

### 4. Wiring point

`@mastra/core` `channels/types.d.ts:395` exposes `state?: StateAdapter` on `ChannelConfig`, and `chatOptions?: Omit<ChatConfig, 'adapters' | 'state' | 'userName'>` (line 445) carries `dedupeTtlMs`. Both are passed through the `channels` key on `Agent`. No subclassing, no custom adapter.

---

## Directory Map

```text
src/mastra/
├── memory/
│   └── index.ts                         ← NEW: shared Memory instance
├── utils/
│   └── adapters.ts                      ← MODIFY: add state (createPostgresState) + chatOptions
├── agents/
│   ├── research-manager.ts              ← MODIFY: add memory: sharedMemory
│   ├── operations-manager.ts            ← MODIFY: add memory: sharedMemory
│   └── qa-manager.ts                    ← MODIFY: add memory: sharedMemory
package.json                             ← MODIFY: add @chat-adapter/state-pg dependency
```

No new hand-written adapter file. `state-adapter.ts` from the prior draft is deleted from scope.

---

## Modification Table

| File | Action | Why |
|---|---|---|
| `package.json` | Modify | Add `@chat-adapter/state-pg` (official PostgreSQL state adapter) |
| `src/mastra/memory/index.ts` | Create | Single `Memory` instance shared by all agents |
| `src/mastra/utils/adapters.ts` | Modify | Wire `createPostgresState()` as `state` + set `dedupeTtlMs` |
| `src/mastra/agents/research-manager.ts` | Modify | Add `memory: sharedMemory` |
| `src/mastra/agents/operations-manager.ts` | Modify | Add `memory: sharedMemory` |
| `src/mastra/agents/qa-manager.ts` | Modify | Add `memory: sharedMemory` |

---

## Existing Pattern Audit

- **Storage**: `PostgresStoreVNext` via `DATABASE_URL` (PR #20). `Memory` without explicit `storage` inherits the Mastra instance's store.
- **Adapter packages**: `@chat-adapter/slack` and `@chat-adapter/telegram` are already at `4.30.0`. Adding `@chat-adapter/state-pg@4.30.0` is consistent with the existing adapter family and shares the `chat@4.30.0` peer.
- **Channel config shape**: `buildChannelAdapters` returns `{ adapters: {...} }`. `ChannelConfig` also accepts `state` and `chatOptions` at the same level — additive, non-breaking.
- **Dedup TTL**: default `300000` (5 min). We raise it to 24 h via `chatOptions.dedupeTtlMs` so retries after a cold start are still caught.

---

## Execution Plan

### Step 1 — Install official state adapter
```bash
bun add @chat-adapter/state-pg
```

### Step 2 — Create shared memory module
### Step 3 — Wire state adapter + dedup TTL in adapters.ts
### Step 4 — Add memory to all three agents

---

## File-by-File Changes

---

### `package.json`

**Action:** Modify (via `bun add @chat-adapter/state-pg`)  
**Why:** Pull in the official PostgreSQL state adapter.  
**Impact:** One new dependency, version-aligned with existing adapters.

#### After (dependencies excerpt)
```jsonc
"@chat-adapter/slack": "^4.30.0",
"@chat-adapter/state-pg": "^4.30.0",
"@chat-adapter/telegram": "^4.30.0",
```

---

### `src/mastra/memory/index.ts`

**Action:** Create  
**Why:** Single `Memory` instance — all three agents read/write the same PostgreSQL-backed store. Thread isolation preserved per `resourceId` + `threadId`.  
**Impact:** Cross-conversation recall and working memory for all agents.

#### Before
*(file does not exist)*

#### After
```ts
import { Memory } from '@mastra/memory';

export const sharedMemory = new Memory({
  options: {
    lastMessages: 20,
    semanticRecall: false,
    workingMemory: {
      enabled: true,
    },
  },
});
```

#### Reasoning
- No `storage` arg — inherits `PostgresStoreVNext` from the Mastra instance at runtime.
- `lastMessages: 20` — rolling context window; tunable per agent later.
- `semanticRecall: false` — no `PgVector` configured yet; enable when vector search is needed.
- `workingMemory.enabled: true` — persistent structured facts across sessions.

---

### `src/mastra/utils/adapters.ts`

**Action:** Modify  
**Why:** Replace the default in-memory state adapter with the official PostgreSQL one so dedup (and subscriptions and locks) persist across restarts. Raise `dedupeTtlMs` to cover cold-start retry windows.  
**Impact:** `adapters` shape unchanged; two additive keys (`state`, `chatOptions`).

#### Before
```ts
import { createSlackAdapter } from '@chat-adapter/slack';
import { createTelegramAdapter } from '@chat-adapter/telegram';

export function buildChannelAdapters(envPrefix: string) {
  const slackToken = process.env[`${envPrefix}_SLACK_BOT_TOKEN`];
  const slackSecret = process.env[`${envPrefix}_SLACK_SIGNING_SECRET`];
  const telegramToken = process.env[`${envPrefix}_TELEGRAM_BOT_TOKEN`];

  return {
    adapters: {
      ...(slackToken && slackSecret
        ? { slack: createSlackAdapter({ botToken: slackToken, signingSecret: slackSecret }) }
        : {}),
      ...(telegramToken
        ? { telegram: createTelegramAdapter({ botToken: telegramToken }) }
        : {}),
    },
  };
}
```

#### After
```ts
import { createSlackAdapter } from '@chat-adapter/slack';
import { createTelegramAdapter } from '@chat-adapter/telegram';
import { createPostgresState } from '@chat-adapter/state-pg';

// One PostgreSQL-backed state adapter shared across all agents.
// Persists dedup keys, subscriptions, and locks across restarts.
// Reads DATABASE_URL automatically; pass explicitly for clarity.
const sharedState = createPostgresState({ url: process.env.DATABASE_URL });

const DEDUP_TTL_24H = 24 * 60 * 60 * 1000;

export function buildChannelAdapters(envPrefix: string) {
  const slackToken = process.env[`${envPrefix}_SLACK_BOT_TOKEN`];
  const slackSecret = process.env[`${envPrefix}_SLACK_SIGNING_SECRET`];
  const telegramToken = process.env[`${envPrefix}_TELEGRAM_BOT_TOKEN`];

  return {
    state: sharedState,
    chatOptions: {
      dedupeTtlMs: DEDUP_TTL_24H,
    },
    adapters: {
      ...(slackToken && slackSecret
        ? { slack: createSlackAdapter({ botToken: slackToken, signingSecret: slackSecret }) }
        : {}),
      ...(telegramToken
        ? { telegram: createTelegramAdapter({ botToken: telegramToken }) }
        : {}),
    },
  };
}
```

#### Reasoning
- **`createPostgresState` — official package**: no hand-rolled adapter. The package owns its schema, its `setIfNotExists` semantics, and TTL eviction. This is the maintained, documented production pattern from the chat SDK.
- **One shared instance**: created once at module load, passed to all three agents. The default `keyPrefix: "chat-sdk"` namespaces its rows; the `chat` package namespaces dedup keys by adapter name (`dedupe:${adapter.name}:${id}`), so Slack/Telegram keys never collide.
- **`url: process.env.DATABASE_URL`**: same Neon connection as `PostgresStoreVNext`. The adapter owns its own pool by default. (Optional future optimization: pass `{ client: existingPool }` to share `PostgresStoreVNext`'s pool — not required now.)
- **`dedupeTtlMs: 24h`**: the README explicitly notes raising this when "webhook cold starts cause platform retries that arrive after the default window." 24 h is conservative insurance; persisted rows are TTL-evicted by the adapter.
- **`adapters` block unchanged**: Slack and Telegram construction is byte-for-byte identical to before.

---

### `src/mastra/agents/research-manager.ts`

**Action:** Modify — add `memory: sharedMemory`.

#### Before
```ts
import { Agent } from '@mastra/core/agent';
import { AgentId, DEFAULT_AGENT_MODEL } from '../config/index.js';
import { buildChannelAdapters } from '../utils/adapters.js';
import { instructions } from './instructions/research-manager.js';

export const researchManager = new Agent({
  id: AgentId.RESEARCH_MANAGER,
  name: 'Research Manager',
  instructions,
  model: DEFAULT_AGENT_MODEL,
  channels: buildChannelAdapters('RESEARCH_MANAGER'),
});
```

#### After
```ts
import { Agent } from '@mastra/core/agent';
import { AgentId, DEFAULT_AGENT_MODEL } from '../config/index.js';
import { buildChannelAdapters } from '../utils/adapters.js';
import { sharedMemory } from '../memory/index.js';
import { instructions } from './instructions/research-manager.js';

export const researchManager = new Agent({
  id: AgentId.RESEARCH_MANAGER,
  name: 'Research Manager',
  instructions,
  model: DEFAULT_AGENT_MODEL,
  memory: sharedMemory,
  channels: buildChannelAdapters('RESEARCH_MANAGER'),
});
```

---

### `src/mastra/agents/operations-manager.ts`

**Action:** Modify — add `memory: sharedMemory`.

#### Before
```ts
import { Agent } from '@mastra/core/agent';
import { AgentId, DEFAULT_AGENT_MODEL } from '../config/index.js';
import { buildChannelAdapters } from '../utils/adapters.js';
import { instructions } from './instructions/operations-manager.js';

export const operationsManager = new Agent({
  id: AgentId.OPERATIONS_MANAGER,
  name: 'Operations Manager',
  instructions,
  model: DEFAULT_AGENT_MODEL,
  channels: buildChannelAdapters('OPS_MANAGER'),
});
```

#### After
```ts
import { Agent } from '@mastra/core/agent';
import { AgentId, DEFAULT_AGENT_MODEL } from '../config/index.js';
import { buildChannelAdapters } from '../utils/adapters.js';
import { sharedMemory } from '../memory/index.js';
import { instructions } from './instructions/operations-manager.js';

export const operationsManager = new Agent({
  id: AgentId.OPERATIONS_MANAGER,
  name: 'Operations Manager',
  instructions,
  model: DEFAULT_AGENT_MODEL,
  memory: sharedMemory,
  channels: buildChannelAdapters('OPS_MANAGER'),
});
```

---

### `src/mastra/agents/qa-manager.ts`

**Action:** Modify — add `memory: sharedMemory`.

#### Before
```ts
import { Agent } from '@mastra/core/agent';
import { AgentId, DEFAULT_AGENT_MODEL } from '../config/index.js';
import { buildChannelAdapters } from '../utils/adapters.js';
import { instructions } from './instructions/qa-manager.js';

export const qaManager = new Agent({
  id: AgentId.QA_MANAGER,
  name: 'QA Manager',
  instructions,
  model: DEFAULT_AGENT_MODEL,
  channels: buildChannelAdapters('QA_MANAGER'),
});
```

#### After
```ts
import { Agent } from '@mastra/core/agent';
import { AgentId, DEFAULT_AGENT_MODEL } from '../config/index.js';
import { buildChannelAdapters } from '../utils/adapters.js';
import { sharedMemory } from '../memory/index.js';
import { instructions } from './instructions/qa-manager.js';

export const qaManager = new Agent({
  id: AgentId.QA_MANAGER,
  name: 'QA Manager',
  instructions,
  model: DEFAULT_AGENT_MODEL,
  memory: sharedMemory,
  channels: buildChannelAdapters('QA_MANAGER'),
});
```

---

## Validation Plan

```bash
# Install
bun add @chat-adapter/state-pg

# Type check — zero errors required
bun tsc --noEmit

# Start dev server
mastra dev

# Confirm the state adapter created its schema in Neon
# (Neon console or psql) — expect chat-sdk prefixed table(s):
# \dt
# SELECT * FROM <chat-sdk state table> LIMIT 10;

# Send a Telegram message, capture update_id, replay the same webhook twice
# → second is silently dropped (200 OK, no agent response)

# Restart server, replay the same webhook a third time
# → still dropped (verifies PostgreSQL persistence vs in-memory default)
```

---

## Risk Notes

1. **Pool count**: `createPostgresState({ url })` owns its own pool — a third pool alongside `PostgresStoreVNext` and `PgOAuthStorage`. Acceptable. Optional future optimization: pass `{ client: postgresStorePool }` to share one pool (the adapter supports a `client` option; `PostgresStore` exposes its pool via `PoolInstanceConfig`/`getClient`).

2. **`chat` peer version**: `@chat-adapter/state-pg@4.30.0` depends on `chat@4.30.0`. Confirm the installed `chat` version matches (it does today). If a future bump desyncs the adapter family, pin them together.

3. **Shared memory thread scoping**: agents share the Memory *store*, not threads. Verify `resourceId` is correctly populated per user by the channel adapter so user A's thread is never merged with user B's.

4. **PR #20 merge order**: `feat/postgresql-storage` must land before this branch; `DATABASE_URL` must be set.

5. **No breaking changes**: `buildChannelAdapters` gains two additive optional keys; `memory` is additive on all three agents; one new dependency. Nothing existing changes behavior.

---

## Approval

`Status: Awaiting explicit user approval. Do not implement yet.`
