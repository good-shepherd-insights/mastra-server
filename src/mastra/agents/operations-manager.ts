import { Agent } from '@mastra/core/agent';
import { AgentId, DEFAULT_AGENT_MODEL } from '../config/index.js';
import { buildChannelAdapters } from '../utils/adapters.js';
import { instructions } from './instructions/operations-manager.js';

export const operationsManager = new Agent({
  id: AgentId.OPERATIONS_MANAGER,
  name: 'Operations Manager',
  instructions,
  model: DEFAULT_AGENT_MODEL,
  channels: buildChannelAdapters('OPS_MANAGER'),
});
