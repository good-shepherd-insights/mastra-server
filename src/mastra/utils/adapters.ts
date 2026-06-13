import { createSlackAdapter } from '@chat-adapter/slack';
import { createTelegramAdapter } from '@chat-adapter/telegram';
import { createPostgresState } from '@chat-adapter/state-pg';
import type { Thread } from 'chat';

const DEDUP_TTL_24H = 24 * 60 * 60 * 1000;

// Proxy chatThread.channelId to ${channelId}:${agentId} so getOrCreateThread
// (chunk-TRXIXO5J.js:2409) produces a separate Mastra thread UUID per agent for
// the same Telegram group. Different UUIDs → different pub/sub topics
// (chunk-5IG64QT5.js:52) → no cross-broadcast. postMessage uses threadId, not
// channelId, so Telegram delivery is unaffected.
function scopeThread(thread: Thread, agentId: string): Thread {
  return new Proxy(thread, {
    get(target, prop) {
      if (prop === 'channelId') return `${target.channelId}:${agentId}`;
      const val = (target as any)[prop];
      return typeof val === 'function' ? val.bind(target) : val;
    },
  }) as Thread;
}

export function buildChannelAdapters(envPrefix: string, agentId: string) {
  const slackToken = process.env[`${envPrefix}_SLACK_BOT_TOKEN`];
  const slackSecret = process.env[`${envPrefix}_SLACK_SIGNING_SECRET`];
  const telegramToken = process.env[`${envPrefix}_TELEGRAM_BOT_TOKEN`];

  return {
    state: createPostgresState({ url: process.env.DATABASE_URL!, keyPrefix: envPrefix.toLowerCase() }),
    chatOptions: { dedupeTtlMs: DEDUP_TTL_24H },
    threadContext: { maxMessages: 0 },
    handlers: {
      onMention: (thread: Thread, message: any, defaultHandler: any) => {
        return defaultHandler(scopeThread(thread, agentId), message);
      },
      onSubscribedMessage: (thread: Thread, message: any, defaultHandler: any) => {
        if (message.isMention) return defaultHandler(scopeThread(thread, agentId), message);
      },
    },
    adapters: {
      ...(slackToken && slackSecret
        ? { slack: createSlackAdapter({ botToken: slackToken, signingSecret: slackSecret }) }
        : {}),
      ...(telegramToken
        ? { telegram: { adapter: createTelegramAdapter({ botToken: telegramToken }), toolDisplay: 'hidden' } }
        : {}),
    },
  };
}
