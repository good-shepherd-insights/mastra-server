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