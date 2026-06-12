import { Agent } from '@mastra/core/agent';
import { createSlackAdapter } from '@chat-adapter/slack';
import { createTelegramAdapter } from '@chat-adapter/telegram';
import { AgentId, DEFAULT_AGENT_MODEL } from '../config/index.js';
import prompt from './instructions/research-manager.yaml';

export const researchManager = new Agent({
  id: AgentId.RESEARCH_MANAGER,
  name: 'Research Manager',
  instructions: prompt.instructions,
  model: DEFAULT_AGENT_MODEL,
  channels: {
    adapters: {
      ...(process.env.RESEARCH_MANAGER_SLACK_BOT_TOKEN && process.env.RESEARCH_MANAGER_SLACK_SIGNING_SECRET
        ? {
            slack: createSlackAdapter({
              botToken: process.env.RESEARCH_MANAGER_SLACK_BOT_TOKEN,
              signingSecret: process.env.RESEARCH_MANAGER_SLACK_SIGNING_SECRET,
            }),
          }
        : {}),
      ...(process.env.RESEARCH_MANAGER_TELEGRAM_BOT_TOKEN
        ? {
            telegram: createTelegramAdapter({
              botToken: process.env.RESEARCH_MANAGER_TELEGRAM_BOT_TOKEN,
              ...(process.env.RESEARCH_MANAGER_TELEGRAM_SECRET_TOKEN
                ? { secretToken: process.env.RESEARCH_MANAGER_TELEGRAM_SECRET_TOKEN }
                : {}),
            }),
          }
        : {}),
    },
  },
});
