import { ProviderId, PROVIDER_REGISTRY } from './providers.config.js';

export enum AgentId {
  RESEARCH_MANAGER = 'research-manager',
  OPERATIONS_MANAGER = 'operations-manager',
  QA_MANAGER = 'qa-manager',
}

const _featherlessModels = PROVIDER_REGISTRY[ProviderId.FEATHERLESS].models;
if (_featherlessModels.length === 0) {
  throw new Error('PROVIDER_REGISTRY[featherless].models is empty — at least one model must be defined.');
}

export const DEFAULT_AGENT_MODEL =
  `auth-gateway/${ProviderId.FEATHERLESS}/${_featherlessModels[0]}` as const;
