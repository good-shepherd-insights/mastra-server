import { Agent } from '@mastra/core/agent';
import { AgentId, DEFAULT_AGENT_MODEL } from '../config/index.js';
import { buildChannelAdapters } from '../utils/adapters.js';
import { sharedMemory } from '../memory/index.js';
import { instructions } from './instructions/qa-manager.js';

export const qaManager = new Agent({
  id: AgentId.QA_MANAGER,
  name: 'QA Manager',
  instructions,
  model: DEFAULT_AGENT_MODEL,
  memory: sharedMemory,
  channels: buildChannelAdapters('QA_MANAGER', AgentId.QA_MANAGER),
});
