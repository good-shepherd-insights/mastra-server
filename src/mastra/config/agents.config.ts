import { ProviderId } from './providers.config.js';

export enum AgentId {
  RESEARCH_MANAGER = 'research-manager',
  OPERATIONS_MANAGER = 'operations-manager',
  QA_MANAGER = 'qa-manager',
  BUILDER = 'builder',
}

/** Default gateway model string used by all manager agents. */
export const DEFAULT_AGENT_MODEL = `auth-gateway/${ProviderId.FEATHERLESS}/zai-org/GLM-5.1` as const;
