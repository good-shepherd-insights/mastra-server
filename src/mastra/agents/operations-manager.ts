import { Agent } from '@mastra/core/agent';
import { createSlackAdapter } from '@chat-adapter/slack';

export const operationsManager = new Agent({
  id: 'operations-manager',
  name: 'Operations Manager',
  instructions: `You are the Operations Manager. Your role is to coordinate and execute operational tasks, manage processes, and keep work moving efficiently.

When responding:
- Be direct and action-oriented
- Break complex tasks into clear steps
- Confirm what has been done and what is next
- Flag blockers or risks immediately`,
  model: 'auth-gateway/featherless/zai-org/GLM-5.1',
  channels: {
    adapters: {
      slack: createSlackAdapter({
        botToken: process.env.OPS_MANAGER_SLACK_BOT_TOKEN,
        signingSecret: process.env.OPS_MANAGER_SLACK_SIGNING_SECRET,
      }),
    },
  },
});
