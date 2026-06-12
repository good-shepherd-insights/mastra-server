# FIX(auth-gateway-proxy)

## Request

Fix the Auth Gateway proxy so it correctly acts as a simple key-swap proxy: consumer sends `AUTH_GATEWAY_API_KEY`, gateway validates it and forwards to upstream providers using their internal keys (`FEATHERLESS_API_KEY`, etc.). Fix all downstream consumers to use the correct model string format.

## Directory Map

```text
src/mastra/gateways/auth-gateway.ts    — MODIFY (fix getApiKey + resolveLanguageModel, remove buildUrl)
src/mastra/agents/weather-agent.ts      — MODIFY (fix model format)
src/mastra/index.ts                     — MODIFY (fix builderAgent model + editor default)
src/mastra/gateways/openrouter/index.ts — NO CHANGE
src/mastra/gateways/cerebras/index.ts   — NO CHANGE
src/mastra/gateways/featherless/index.ts — NO CHANGE
src/mastra/scorers/weather-scorer.ts    — NO CHANGE
src/mastra/gateways/index.ts            — NO CHANGE
```

## Modification Table

| File | Action | Why |
|---|---|---|
| `src/mastra/gateways/auth-gateway.ts` | Modify | Fix `getApiKey` (validate consumer key), `resolveLanguageModel` (swap consumer key for upstream key). Remove `buildUrl`. |
| `src/mastra/agents/weather-agent.ts` | Modify | Change `model` from object to string `'auth-gateway/featherless/zai-org/GLM-5.1'`. |
| `src/mastra/index.ts` | Modify | Fix `builderAgent` model to string. Fix editor `models.default` to use registered provider name. |

## Proxy Flow (Correct)

1. `fetchProviders()` — declares each provider with its own `apiKeyEnvVar` (already correct). These go into the provider registry.
2. `getApiKey()` — validates the consumer's `AUTH_GATEWAY_API_KEY`. This is the gate.
3. `resolveLanguageModel()` — validates consumer key, swaps it for the upstream provider's key, calls upstream.

## Execution Plan

### Step 1 — Fix `auth-gateway.ts`
`fetchProviders` stays. Fix `getApiKey` to validate `AUTH_GATEWAY_API_KEY`. Fix `resolveLanguageModel` to swap for upstream key. Remove `buildUrl`.

### Step 2 — Fix `weather-agent.ts` model format
Change from object to plain string.

### Step 3 — Fix `index.ts` builderAgent model and editor config
Change builderAgent model to string. Fix editor `models.default` to reference the registered provider directly.

### Step 4 — Delete provider registry cache
`rm -f ~/.cache/mastra/provider-registry.json`

## File-by-File Changes

### `src/mastra/gateways/auth-gateway.ts`

**Action:** Modify
**Why:** `getApiKey` reads upstream env vars instead of validating consumer key. `resolveLanguageModel` passes consumer key to upstream instead of swapping. `buildUrl` is unnecessary.

#### Before

```typescript
import { MastraModelGateway, type ProviderConfig } from '@mastra/core/llm';
import { createOpenAICompatible } from '@ai-sdk/openai-compatible';
import { openrouter } from './openrouter';
import { cerebras } from './cerebras';
import { featherless } from './featherless';

const providers = { openrouter, cerebras, featherless };

export class AuthGateway extends MastraModelGateway {
  readonly id = 'auth-gateway' as const;
  readonly name = 'Auth Gateway';

  async fetchProviders(): Promise<Record<string, ProviderConfig>> {
    return {
      openrouter: {
        name: openrouter.name,
        models: openrouter.models,
        apiKeyEnvVar: openrouter.apiKeyEnvVar,
        gateway: this.id,
        url: openrouter.url,
      },
      cerebras: {
        name: cerebras.name,
        models: cerebras.models,
        apiKeyEnvVar: cerebras.apiKeyEnvVar,
        gateway: this.id,
        url: cerebras.url,
      },
      featherless: {
        name: featherless.name,
        models: featherless.models,
        apiKeyEnvVar: featherless.apiKeyEnvVar,
        gateway: this.id,
        url: featherless.url,
      },
    };
  }

  buildUrl(modelId: string, envVars?: Record<string, string>): string {
    const providerId = modelId.split('/')[0];
    const provider = providers[providerId as keyof typeof providers];
    if (!provider) throw new Error(`Unknown provider: ${providerId}`);
    return provider.url;
  }

  async getApiKey(modelId: string): Promise<string> {
    const providerId = modelId.split('/')[0];
    const provider = providers[providerId as keyof typeof providers];
    if (!provider) throw new Error(`Unknown provider: ${providerId}`);
    const apiKey = process.env[provider.apiKeyEnvVar];
    if (!apiKey) throw new Error(`Missing ${provider.apiKeyEnvVar}`);
    return apiKey;
  }

  async resolveLanguageModel({
    modelId,
    providerId,
    apiKey,
  }: {
    modelId: string;
    providerId: string;
    apiKey: string;
  }) {
    const provider = providers[providerId as keyof typeof providers];
    if (!provider) throw new Error(`Unknown provider: ${providerId}`);

    const baseURL = this.buildUrl(`${providerId}/${modelId}`);

    return createOpenAICompatible({
      name: providerId,
      apiKey,
      baseURL,
    }).chatModel(modelId);
  }
}

export const authGateway = new AuthGateway();
```

#### After

```typescript
import { MastraModelGateway, type ProviderConfig } from '@mastra/core/llm';
import { createOpenAICompatible } from '@ai-sdk/openai-compatible';
import { openrouter } from './openrouter';
import { cerebras } from './cerebras';
import { featherless } from './featherless';

const GATEWAY_API_KEY_ENV = 'AUTH_GATEWAY_API_KEY';

const providers = { openrouter, cerebras, featherless } as const;

export class AuthGateway extends MastraModelGateway {
  readonly id = 'auth-gateway' as const;
  readonly name = 'Auth Gateway';

  async fetchProviders(): Promise<Record<string, ProviderConfig>> {
    return {
      openrouter: {
        name: openrouter.name,
        models: openrouter.models,
        apiKeyEnvVar: openrouter.apiKeyEnvVar,
        gateway: this.id,
        url: openrouter.url,
      },
      cerebras: {
        name: cerebras.name,
        models: cerebras.models,
        apiKeyEnvVar: cerebras.apiKeyEnvVar,
        gateway: this.id,
        url: cerebras.url,
      },
      featherless: {
        name: featherless.name,
        models: featherless.models,
        apiKeyEnvVar: featherless.apiKeyEnvVar,
        gateway: this.id,
        url: featherless.url,
      },
    };
  }

  async getApiKey(_modelId: string): Promise<string> {
    const apiKey = process.env[GATEWAY_API_KEY_ENV];
    if (!apiKey) {
      throw new Error(
        `Missing ${GATEWAY_API_KEY_ENV} environment variable.`,
      );
    }
    return apiKey;
  }

  async resolveLanguageModel({
    modelId,
    providerId,
    apiKey,
  }: {
    modelId: string;
    providerId: string;
    apiKey: string;
  }) {
    if (apiKey !== process.env[GATEWAY_API_KEY_ENV]) {
      throw new Error('Invalid Auth Gateway API key.');
    }

    const provider = providers[providerId as keyof typeof providers];
    if (!provider) throw new Error(`Unknown provider: ${providerId}`);

    const upstreamApiKey = process.env[provider.apiKeyEnvVar];
    if (!upstreamApiKey) {
      throw new Error(
        `Missing ${provider.apiKeyEnvVar} environment variable for upstream provider "${provider.name}".`,
      );
    }

    return createOpenAICompatible({
      name: providerId,
      apiKey: upstreamApiKey,
      baseURL: provider.url,
    }).chatModel(modelId);
  }
}

export const authGateway = new AuthGateway();
```

#### Reasoning

- **`fetchProviders`**: Unchanged — each provider correctly declares its own `apiKeyEnvVar`.
- **`getApiKey`**: Validates consumer's `AUTH_GATEWAY_API_KEY`. Return value flows to `resolveLanguageModel` as `apiKey`.
- **`resolveLanguageModel`**: Validates consumer key, then swaps for upstream provider key. The upstream key is what gets passed to `createOpenAICompatible`. `baseURL` comes directly from `provider.url`.
- **`buildUrl` removed**: `provider.url` is already the base URL.

---

### `src/mastra/agents/weather-agent.ts`

**Action:** Modify
**Why:** Object format routes through `ModelsDevGateway` instead of `AuthGateway`.

#### Before

```typescript
  model: {
    id: 'auth-gateway/featherless/zai-org/GLM-5.1',
    providerId: 'featherless',
    modelId: 'zai-org/GLM-5.1',
    apiKey: process.env.AUTH_GATEWAY_API_KEY!,
  },
```

#### After

```typescript
  model: 'auth-gateway/featherless/zai-org/GLM-5.1',
```

#### Reasoning

- String format `'auth-gateway/featherless/zai-org/GLM-5.1'` causes the router to see `auth-gateway` prefix → routes to `AuthGateway`.
- No `apiKey` needed — gateway's `getApiKey()` handles auth.

---

### `src/mastra/index.ts`

**Action:** Modify (two changes)
**Why:** (1) `builderAgent` uses same broken object format. (2) Editor `models.default` uses wrong `kind: 'custom'` format with `auth-gateway/` prefix.

#### Change 1: builderAgent model

##### Before

```typescript
export const builderAgent = createBuilderAgent({
  model: {
    id: 'auth-gateway/featherless/zai-org/GLM-5.1',
    providerId: 'featherless',
    modelId: 'zai-org/GLM-5.1',
    apiKey: process.env.AUTH_GATEWAY_API_KEY!,
  },
});
```

##### After

```typescript
export const builderAgent = createBuilderAgent({
  model: 'auth-gateway/featherless/zai-org/GLM-5.1',
});
```

#### Change 2: MastraEditor models config

##### Before

```typescript
models: {
  default: { kind: 'custom', provider: 'auth-gateway/featherless', modelId: 'zai-org/GLM-5.1' },
},
```

##### After

```typescript
models: {
  default: { provider: 'featherless', modelId: 'zai-org/GLM-5.1' },
},
```

#### Reasoning

- `featherless` is a registered provider in the provider registry (from `fetchProviders()`). No `kind: 'custom'` needed — it's not an unknown provider, it's a gateway-registered one.
- `provider` should be `featherless` — the key from `fetchProviders()`, not `auth-gateway/featherless`.
- No `allowed` list — the provider registry already handles what's available.

## Validation Plan

1. `npx tsc --noEmit`
2. `rm -f ~/.cache/mastra/provider-registry.json`
3. `npm run dev` — verify no startup errors
4. Test weather-agent via Studio
5. Test builder model picker

## Risk Notes

- **`.env` file**: Do NOT modify `.env` or `.env.example`.
- If the editor `default` format still doesn't resolve correctly at runtime, check `GET /editor/builder/settings.modelPolicyWarnings` for validation errors.

## Approval

`Status: Awaiting explicit user approval. Do not implement yet.`