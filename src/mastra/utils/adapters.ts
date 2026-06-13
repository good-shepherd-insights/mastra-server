import { createSlackAdapter } from '@chat-adapter/slack';
import { createTelegramAdapter } from '@chat-adapter/telegram';
import { createPostgresState } from '@chat-adapter/state-pg';

// One PostgreSQL-backed state adapter shared across all agents.
// Persists dedup keys, subscriptions, and locks across restarts.
// Reads DATABASE_URL automatically; passed explicitly for clarity.
const sharedState = createPostgresState({ url: process.env.DATABASE_URL });

const DEDUP_TTL_24H = 24 * 60 * 60 * 1000;

export function buildChannelAdapters(envPrefix: string) {
  const slackToken = process.env[`${envPrefix}_SLACK_BOT_TOKEN`];
  const slackSecret = process.env[`${envPrefix}_SLACK_SIGNING_SECRET`];
  const telegramToken = process.env[`${envPrefix}_TELEGRAM_BOT_TOKEN`];

  return {
    state: sharedState,
    chatOptions: {
      dedupeTtlMs: DEDUP_TTL_24H,
    },
    adapters: {
      ...(slackToken && slackSecret
        ? { slack: createSlackAdapter({ botToken: slackToken, signingSecret: slackSecret }) }
        : {}),
      ...(telegramToken
        ? { telegram: createTelegramAdapter({ botToken: telegramToken }) }
        : {}),
    },
  };
}
