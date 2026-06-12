import { MastraModelGateway, type ProviderConfig, type GatewayLanguageModel } from '@mastra/core/llm';
import { createOpenAICompatible } from '@ai-sdk/openai-compatible';
import { PROVIDER_REGISTRY, GATEWAY_PROVIDERS, type GatewayProviderId } from '../config/index.js';
import { monitor } from '../utils/monitor.js';

const GATEWAY_API_KEY_ENV = 'AUTH_GATEWAY_API_KEY';

export class AuthGateway extends MastraModelGateway {
  readonly id = 'auth-gateway' as const;
  readonly name = 'Auth Gateway';

  async fetchProviders(): Promise<Record<string, ProviderConfig>> {
    return Object.fromEntries(
      GATEWAY_PROVIDERS.map((id) => {
        const p = PROVIDER_REGISTRY[id];
        return [id, { name: p.name, models: p.models, apiKeyEnvVar: p.apiKeyEnvVar, gateway: this.id, url: p.url }];
      }),
    );
  }

  buildUrl(modelId: string): string {
    const providerId = modelId.split('/')[0] as GatewayProviderId;
    const provider = PROVIDER_REGISTRY[providerId];
    if (!provider) throw new Error(`Unknown provider: ${providerId}`);
    return provider.url;
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

    if (!(GATEWAY_PROVIDERS as readonly string[]).includes(providerId)) {
      throw new Error(`Provider '${providerId}' is not configured for the auth gateway.`);
    }
    const provider = PROVIDER_REGISTRY[providerId as GatewayProviderId];

    const upstreamApiKey = process.env[provider.apiKeyEnvVar];
    if (!upstreamApiKey) {
      throw new Error(
        `Missing ${provider.apiKeyEnvVar} environment variable for upstream provider "${provider.name}".`,
      );
    }

    monitor.gatewayResolve(providerId, modelId);

    return createOpenAICompatible({
      name: providerId,
      apiKey: upstreamApiKey,
      baseURL: provider.url,
    }).chatModel(modelId);
  }
}

export const authGateway = new AuthGateway();
