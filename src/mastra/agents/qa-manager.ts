import { Agent } from '@mastra/core/agent';
import { AgentId, DEFAULT_AGENT_MODEL } from '../config/index.js';
import { buildChannelAdapters } from './adapters.js';
import prompt from './instructions/qa-manager.yaml';

export const qaManager = new Agent({
  id: AgentId.QA_MANAGER,
  name: 'QA Manager',
  instructions: prompt.instructions,
  model: DEFAULT_AGENT_MODEL,
  channels: buildChannelAdapters('QA_MANAGER'),
});
