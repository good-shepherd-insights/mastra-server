import type { ProviderConfig } from '@mastra/core/llm';
import { PROVIDER_REGISTRY, GATEWAY_PROVIDERS, type GatewayProviderId } from '../../config/index.js';

export function buildProviderConfigs(gatewayId: string): Record<string, ProviderConfig> {
  return Object.fromEntries(
    GATEWAY_PROVIDERS.map((id) => {
      const p = PROVIDER_REGISTRY[id];
      return [id, { name: p.name, models: p.models, apiKeyEnvVar: p.apiKeyEnvVar, gateway: gatewayId, url: p.url }];
    }),
  );
}

export function resolveProviderUrl(modelId: string): string {
  const providerId = modelId.split('/')[0] as GatewayProviderId;
  const provider = PROVIDER_REGISTRY[providerId];
  if (!provider) throw new Error(`Unknown provider: ${providerId}`);
  return provider.url;
}

export function assertGatewayProvider(providerId: string): asserts providerId is GatewayProviderId {
  if (!(GATEWAY_PROVIDERS as readonly string[]).includes(providerId)) {
    throw new Error(`Provider '${providerId}' is not configured for the auth gateway.`);
  }
}

export function getUpstreamApiKey(providerId: GatewayProviderId): string {
  const p = PROVIDER_REGISTRY[providerId];
  const key = process.env[p.apiKeyEnvVar];
  if (!key) throw new Error(`Missing ${p.apiKeyEnvVar} environment variable for upstream provider "${p.name}".`);
  return key;
}
