import { ProviderId, PROVIDER_REGISTRY } from './providers.config.js';

export enum AgentId {
  RESEARCH_MANAGER = 'research-manager',
  OPERATIONS_MANAGER = 'operations-manager',
  QA_MANAGER = 'qa-manager',
}

export const DEFAULT_AGENT_MODEL =
  `auth-gateway/${ProviderId.FEATHERLESS}/${PROVIDER_REGISTRY[ProviderId.FEATHERLESS].models[0]}` as const;
