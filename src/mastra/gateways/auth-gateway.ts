import { MastraModelGateway, type ProviderConfig, type GatewayLanguageModel } from '@mastra/core/llm';
import { createOpenAICompatible } from '@ai-sdk/openai-compatible';
import { featherless } from './featherless';
import { pioneer } from './pioneer';

const GATEWAY_API_KEY_ENV = 'AUTH_GATEWAY_API_KEY';

const providers = { featherless, pioneer } as const;

export class AuthGateway extends MastraModelGateway {
  readonly id = 'auth-gateway' as const;
  readonly name = 'Auth Gateway';

  async fetchProviders(): Promise<Record<string, ProviderConfig>> {
    return {
      featherless: {
        name: featherless.name,
        models: featherless.models,
        apiKeyEnvVar: featherless.apiKeyEnvVar,
        gateway: this.id,
        url: featherless.url,
      },
      pioneer: {
        name: pioneer.name,
        models: pioneer.models,
        apiKeyEnvVar: pioneer.apiKeyEnvVar,
        gateway: this.id,
        url: pioneer.url,
      },
    };
  }

  buildUrl(modelId: string): string {
    const providerId = modelId.split('/')[0];
    const provider = providers[providerId as keyof typeof providers];
    if (!provider) throw new Error(`Unknown provider: ${providerId}`);
    return provider.url;
  }

  async getApiKey(_modelId: string): Promise<string> {
    const apiKey = process.env[GATEWAY_API_KEY_ENV];
    if (!apiKey) {
      throw new Error(`Missing ${GATEWAY_API_KEY_ENV} environment variable.`);
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
  }): Promise<GatewayLanguageModel> {
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
