import { createOpenAICompatible } from '@ai-sdk/openai-compatible';
import { PROVIDER_REGISTRY, type GatewayProviderId } from '../../config/index.js';

export class ProviderClientCache {
  private readonly cache = new Map<string, ReturnType<typeof createOpenAICompatible>>();

  get(providerId: GatewayProviderId, apiKey: string): ReturnType<typeof createOpenAICompatible> {
    let client = this.cache.get(providerId);
    if (!client) {
      const p = PROVIDER_REGISTRY[providerId];
      client = createOpenAICompatible({ name: providerId, apiKey, baseURL: p.url });
      this.cache.set(providerId, client);
    }
    return client;
  }
}
