import { Agent } from '@mastra/core/agent';
import { AgentId, DEFAULT_AGENT_MODEL } from '../config/index.js';
import { buildChannelAdapters } from '../utils/adapters.js';
import { instructions } from './instructions/research-manager.js';

export const researchManager = new Agent({
  id: AgentId.RESEARCH_MANAGER,
  name: 'Research Manager',
  instructions,
  model: DEFAULT_AGENT_MODEL,
  channels: buildChannelAdapters('RESEARCH_MANAGER', AgentId.RESEARCH_MANAGER),
});
