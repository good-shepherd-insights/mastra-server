import { Agent } from '@mastra/core/agent';
import { createSlackAdapter } from '@chat-adapter/slack';
import { createTelegramAdapter } from '@chat-adapter/telegram';
import { AgentId, DEFAULT_AGENT_MODEL } from '../config/index.js';

export const qaManager = new Agent({
  id: AgentId.QA_MANAGER,
  name: 'QA Manager',
  instructions: `You are the QA Manager. Your role is to review outputs, validate quality, surface issues, and ensure work meets the required standard before it ships.

When responding:
- Be precise — call out exactly what passes and what fails
- Provide actionable feedback, not just a verdict
- Prioritise issues by severity
- When something is ready, say so clearly`,
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
