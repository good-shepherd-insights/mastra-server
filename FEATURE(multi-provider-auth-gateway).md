# FEATURE(multi-provider-auth-gateway)

## Request

Create a custom `MastraModelGateway` that aggregates multiple OpenAI-compatible providers (OpenRouter, Cerebras, Featherless, etc.) behind a single gateway. The gateway owns the credentials to each upstream provider and routes requests, so consumers only need the gateway's own key — not the individual provider keys.

## Source Audit

Checked the actual `@mastra/core` source (`chunk-NT7SXV2D.js`, line 13553):

- `MastraModelGateway` base class only has `getId()`, `shouldEnable()`, `serializeForSpan()`.
- **Required methods per docs**: `fetchProviders()`, `buildUrl()`, `getApiKey()`, `resolveLanguageModel()`.
- `resolveAuth()` does NOT exist — it was invented in previous iterations. Removed.
- Project uses `@ai-sdk/openai-compatible` v2 (`2.0.48`).
- Existing `FeatherlessGateway` in `src/mastra/index.ts` (lines 30–78) is the reference pattern.

## Directory Map

```text
src/
  mastra/
    gateways/
      openrouter/index.ts
      cerebras/index.ts
      featherless/index.ts
      auth-gateway.ts
      index.ts
    index.ts                   # MODIFY
    agents/weather-agent.ts    # MODIFY
.env.example                    # NEW
```

## Architecture

1. **Per-provider folders** — plain object exports with `name`, `url`, `apiKeyEnvVar`, `models`.
2. **`auth-gateway.ts`** — follows docs patterns and existing `FeatherlessGateway`. Uses provider objects directly — no duplicate constants, no custom types.
3. **`gateways/index.ts`** — re-exports `authGateway` instance.

## File-by-File Changes

### `src/mastra/gateways/openrouter/index.ts`

```typescript
export const openrouter = {
  name: 'OpenRouter',
  url: 'https://openrouter.ai/api/v1',
  apiKeyEnvVar: 'OPENROUTER_API_KEY',
  models: [
    'anthropic/claude-sonnet-4-6',
    'anthropic/claude-opus-4-5',
    'openai/gpt-4o',
    'openai/gpt-4o-mini',
    'google/gemini-2.5-flash',
    'meta-llama/llama-4-maverick',
  ],
};
```

### `src/mastra/gateways/cerebras/index.ts`

```typescript
export const cerebras = {
  name: 'Cerebras',
  url: 'https://api.cerebras.ai/v1',
  apiKeyEnvVar: 'CEREBRAS_API_KEY',
  models: [
    'gpt-oss-120b',
    'llama3.1-8b',
  ],
};
```

### `src/mastra/gateways/featherless/index.ts`

```typescript
export const featherless = {
  name: 'Featherless AI',
  url: 'https://api.featherless.ai/v1',
  apiKeyEnvVar: 'FEATHERLESS_API_KEY',
  models: [
    'zai-org/GLM-5.1',
  ],
};
```

### `src/mastra/gateways/auth-gateway.ts`

Follows docs patterns from https://mastra.ai/models/gateways/custom-gateways and existing `FeatherlessGateway`.

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
        apiKeyEnvVar: 'AUTH_GATEWAY_API_KEY',
        gateway: this.id,
        url: openrouter.url,
      },
      cerebras: {
        name: cerebras.name,
        models: cerebras.models,
        apiKeyEnvVar: 'AUTH_GATEWAY_API_KEY',
        gateway: this.id,
        url: cerebras.url,
      },
      featherless: {
        name: featherless.name,
        models: featherless.models,
        apiKeyEnvVar: 'AUTH_GATEWAY_API_KEY',
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
    const apiKey = process.env.AUTH_GATEWAY_API_KEY;
    if (!apiKey) throw new Error('Missing AUTH_GATEWAY_API_KEY');
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

    const upstreamApiKey = process.env[provider.apiKeyEnvVar];
    if (!upstreamApiKey) throw new Error(`Missing ${provider.apiKeyEnvVar}`);

    const baseURL = this.buildUrl(`${providerId}/${modelId}`);

    return createOpenAICompatible({
      name: providerId,
      apiKey: upstreamApiKey,
      baseURL,
    }).chatModel(modelId);
  }
}

export const authGateway = new AuthGateway();
```

### `src/mastra/gateways/index.ts`

```typescript
export { authGateway } from './auth-gateway';
```

### `src/mastra/index.ts`

Remove lines 6–8 (`MastraModelGateway`, `ProviderConfig`, `createOpenAICompatible`), lines 27–80 (FeatherlessGateway). Add:

```typescript
import { authGateway } from './gateways';
```

Update builderAgent:
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

Update gateways:
```typescript
gateways: { 'auth-gateway': authGateway },
```

Update MastraEditor models:
```typescript
models: {
  allowed: [
    { provider: "auth-gateway", modelId: "featherless/zai-org/GLM-5.1", kind: "custom" },
    { provider: "auth-gateway", modelId: "openrouter/anthropic/claude-sonnet-4-6", kind: "custom" },
    { provider: "auth-gateway", modelId: "cerebras/gpt-oss-120b", kind: "custom" },
  ],
  default: { provider: "auth-gateway", modelId: "featherless/zai-org/GLM-5.1", kind: "custom" },
},
```

### `src/mastra/agents/weather-agent.ts`

```typescript
model: {
  id: 'auth-gateway/featherless/zai-org/GLM-5.1',
  providerId: 'featherless',
  modelId: 'zai-org/GLM-5.1',
  apiKey: process.env.AUTH_GATEWAY_API_KEY!,
},
```

### `.env.example`

```env
# Auth Gateway — consumer-facing key
AUTH_GATEWAY_API_KEY=your-gateway-api-key-here

# Upstream provider keys (used by gateway internally)
OPENROUTER_API_KEY=your-openrouter-key
CEREBRAS_API_KEY=your-cerebras-key
FEATHERLESS_API_KEY=your-featherless-key

# Slack OAuth
SLACK_CLIENT_ID=your-slack-client-id
SLACK_CLIENT_SECRET=your-slack-client-secret

# Mastra Cloud (optional)
MASTRA_CLOUD_ACCESS_TOKEN=
```

## Approval

`Status: Awaiting explicit user approval. Do not implement yet.`
