const IS_DEBUG = process.env.DEBUG === 'true';

export const monitor = {
  gatewayResolve(providerId: string, modelId: string): void {
    if (!IS_DEBUG) return;
    console.debug(`[gateway] resolving ${providerId}/${modelId}`);
  },

  authEvent(event: 'ok' | 'rejected', detail?: string): void {
    if (event === 'rejected') {
      console.warn(`[auth] rejected${detail ? `: ${detail}` : ''}`);
      return;
    }
    if (!IS_DEBUG) return;
    console.debug(`[auth] ok${detail ? `: ${detail}` : ''}`);
  },

  slackMcp(event: string, detail?: string): void {
    if (!IS_DEBUG) return;
    console.debug(`[slack-mcp] ${event}${detail ? `: ${detail}` : ''}`);
  },
};
