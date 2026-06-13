import { createSlackAdapter } from '@chat-adapter/slack';
import { createTelegramAdapter } from '@chat-adapter/telegram';

export function buildChannelAdapters(envPrefix: string) {
  const slackToken = process.env[`${envPrefix}_SLACK_BOT_TOKEN`];
  const slackSecret = process.env[`${envPrefix}_SLACK_SIGNING_SECRET`];
  const telegramToken = process.env[`${envPrefix}_TELEGRAM_BOT_TOKEN`];

  return {
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
