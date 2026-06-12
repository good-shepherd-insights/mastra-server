import { Agent } from '@mastra/core/agent';
import { createSlackAdapter } from '@chat-adapter/slack';
import { createTelegramAdapter } from '@chat-adapter/telegram';
import { AgentId, DEFAULT_AGENT_MODEL } from '../config/index.js';

export const operationsManager = new Agent({
  id: AgentId.OPERATIONS_MANAGER,
  name: 'Operations Manager',
  instructions: `You are the Operations Manager. Your role is to coordinate and execute operational tasks, manage processes, and keep work moving efficiently.

When responding:
- Be direct and action-oriented
- Break complex tasks into clear steps
- Confirm what has been done and what is next
- Flag blockers or risks immediately`,
  model: DEFAULT_AGENT_MODEL,
  channels: {
    adapters: {
      ...(process.env.OPS_MANAGER_SLACK_BOT_TOKEN && process.env.OPS_MANAGER_SLACK_SIGNING_SECRET
        ? {
            slack: createSlackAdapter({
              botToken: process.env.OPS_MANAGER_SLACK_BOT_TOKEN,
              signingSecret: process.env.OPS_MANAGER_SLACK_SIGNING_SECRET,
            }),
          }
        : {}),
      ...(process.env.OPS_MANAGER_TELEGRAM_BOT_TOKEN
        ? {
            telegram: createTelegramAdapter({
              botToken: process.env.OPS_MANAGER_TELEGRAM_BOT_TOKEN,
              ...(process.env.OPS_MANAGER_TELEGRAM_SECRET_TOKEN
                ? { secretToken: process.env.OPS_MANAGER_TELEGRAM_SECRET_TOKEN }
                : {}),
            }),
          }
        : {}),
    },
  },
});
