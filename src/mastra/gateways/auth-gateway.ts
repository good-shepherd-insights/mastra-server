import { MastraModelGateway, type ProviderConfig, type GatewayLanguageModel } from '@mastra/core/llm';
import { monitor } from '../utils/monitor.js';
import { buildProviderConfigs, resolveProviderUrl, assertGatewayProvider, getUpstreamApiKey } from './utils/providers.js';
import { ProviderClientCache } from './utils/client-cache.js';

const GATEWAY_API_KEY_ENV = 'AUTH_GATEWAY_API_KEY';

export class AuthGateway extends MastraModelGateway {
  readonly id = 'auth-gateway' as const;
  readonly name = 'Auth Gateway';

  private cachedProviders?: Record<string, ProviderConfig>;
  private readonly clientCache = new ProviderClientCache();

  async fetchProviders(): Promise<Record<string, ProviderConfig>> {
    return (this.cachedProviders ??= buildProviderConfigs(this.id));
  }

  buildUrl(modelId: string): string {
    return resolveProviderUrl(modelId);
  }

  async getApiKey(_modelId: string): Promise<string> {
    const apiKey = process.env[GATEWAY_API_KEY_ENV];
    if (!apiKey) throw new Error(`Missing ${GATEWAY_API_KEY_ENV} environment variable.`);
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
  }): Promise<GatewayLanguageModel> {
    if (apiKey !== process.env[GATEWAY_API_KEY_ENV]) {
      monitor.authEvent('rejected', 'invalid gateway API key');
      throw new Error('Invalid Auth Gateway API key.');
    }

    assertGatewayProvider(providerId);

    monitor.gatewayResolve(providerId, modelId);

    return this.clientCache.get(providerId, getUpstreamApiKey(providerId)).chatModel(modelId);
  }
}

export const authGateway = new AuthGateway();
