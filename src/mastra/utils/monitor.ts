const IS_DEBUG = process.env.DEBUG === 'true';

export const monitor = {
  gatewayResolve(providerId: string, modelId: string): void {
    if (!IS_DEBUG) return;
    console.debug(`[gateway] resolving ${providerId}/${modelId}`);
  },

  adapterRegistered(agentId: string, channel: string): void {
    if (!IS_DEBUG) return;
    console.debug(`[adapter] ${agentId} → ${channel} registered`);
  },

  authEvent(event: 'ok' | 'rejected', detail?: string): void {
    if (!IS_DEBUG) return;
    console.debug(`[auth] ${event}${detail ? `: ${detail}` : ''}`);
  },
};
