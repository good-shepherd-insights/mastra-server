import { Agent } from '@mastra/core/agent';
import { AgentId, DEFAULT_AGENT_MODEL } from '../config/index.js';
import { buildChannelAdapters } from './adapters.js';
import prompt from './instructions/research-manager.yaml';

export const researchManager = new Agent({
  id: AgentId.RESEARCH_MANAGER,
  name: 'Research Manager',
  instructions: prompt.instructions,
  model: DEFAULT_AGENT_MODEL,
  channels: buildChannelAdapters('RESEARCH_MANAGER'),
});
