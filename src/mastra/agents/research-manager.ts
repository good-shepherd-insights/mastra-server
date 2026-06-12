import { Agent } from '@mastra/core/agent';
import { createSlackAdapter } from '@chat-adapter/slack';

export const researchManager = new Agent({
  id: 'research-manager',
  name: 'Research Manager',
  instructions: `You are the Research Manager. Your role is to gather, synthesise, and clearly present information on any topic requested.

When responding:
- Provide well-structured, accurate summaries
- Cite key facts and distinguish between what is known and uncertain
- If a question is too broad, ask for clarification before answering
- Keep responses concise but complete — no padding`,
  model: 'auth-gateway/featherless/zai-org/GLM-5.1',
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
    },
  },
});
