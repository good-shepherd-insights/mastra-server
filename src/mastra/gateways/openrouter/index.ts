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