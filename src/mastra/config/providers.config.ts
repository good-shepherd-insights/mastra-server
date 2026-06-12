export enum ProviderId {
  FEATHERLESS = 'featherless',
  PIONEER = 'pioneer',
  OPENROUTER = 'openrouter',
  CEREBRAS = 'cerebras',
}

export interface ProviderEntry {
  name: string;
  url: string;
  apiKeyEnvVar: string;
  models: string[];
}

export const PROVIDER_REGISTRY: Record<ProviderId, ProviderEntry> = {
  [ProviderId.FEATHERLESS]: {
    name: 'Featherless AI',
    url: 'https://api.featherless.ai/v1',
    apiKeyEnvVar: 'FEATHERLESS_API_KEY',
    models: ['zai-org/GLM-5.1'],
  },
  [ProviderId.PIONEER]: {
    name: 'Pioneer AI',
    url: 'https://api.pioneer.ai/v1',
    apiKeyEnvVar: 'PIONEER_API_KEY',
    models: ['LiquidAI/LFM2-24B-A2B'],
  },
  [ProviderId.OPENROUTER]: {
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
  },
  [ProviderId.CEREBRAS]: {
    name: 'Cerebras',
    url: 'https://api.cerebras.ai/v1',
    apiKeyEnvVar: 'CEREBRAS_API_KEY',
    models: [
      'gpt-oss-120b',
      'llama3.1-8b',
      'qwen-3-235b-a22b-instruct-2507',
      'qwen-3-235b-a22b-thinking-2507',
      'zai-glm-4.6',
    ],
  },
};

/** Gateway providers — the subset routed through the auth gateway key-swap. */
export const GATEWAY_PROVIDERS = [ProviderId.FEATHERLESS, ProviderId.PIONEER] as const;
export type GatewayProviderId = (typeof GATEWAY_PROVIDERS)[number];
