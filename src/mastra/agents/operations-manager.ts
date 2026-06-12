import { Agent } from '@mastra/core/agent';
import { AgentId, DEFAULT_AGENT_MODEL } from '../config/index.js';
import { buildChannelAdapters } from './adapters.js';
import prompt from './instructions/operations-manager.yaml';

export const operationsManager = new Agent({
  id: AgentId.OPERATIONS_MANAGER,
  name: 'Operations Manager',
  instructions: prompt.instructions,
  model: DEFAULT_AGENT_MODEL,
  channels: buildChannelAdapters('OPS_MANAGER'),
});
