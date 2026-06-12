import { Agent } from '@mastra/core/agent';
import { createSlackAdapter } from '@chat-adapter/slack';
import { createTelegramAdapter } from '@chat-adapter/telegram';
import { AgentId, DEFAULT_AGENT_MODEL } from '../config/index.js';
import { loadPrompt } from './prompts/loader.js';

export const qaManager = new Agent({
  id: AgentId.QA_MANAGER,
  name: 'QA Manager',
  instructions: loadPrompt(AgentId.QA_MANAGER),
  model: DEFAULT_AGENT_MODEL,
  channels: {
    adapters: {
      ...(process.env.QA_MANAGER_SLACK_BOT_TOKEN && process.env.QA_MANAGER_SLACK_SIGNING_SECRET
        ? {
            slack: createSlackAdapter({
              botToken: process.env.QA_MANAGER_SLACK_BOT_TOKEN,
              signingSecret: process.env.QA_MANAGER_SLACK_SIGNING_SECRET,
            }),
          }
        : {}),
      ...(process.env.QA_MANAGER_TELEGRAM_BOT_TOKEN
        ? {
            telegram: createTelegramAdapter({
              botToken: process.env.QA_MANAGER_TELEGRAM_BOT_TOKEN,
              ...(process.env.QA_MANAGER_TELEGRAM_SECRET_TOKEN
                ? { secretToken: process.env.QA_MANAGER_TELEGRAM_SECRET_TOKEN }
                : {}),
            }),
          }
        : {}),
    },
  },
});
