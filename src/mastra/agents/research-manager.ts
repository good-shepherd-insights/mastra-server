import { Agent } from '@mastra/core/agent';
import { Memory } from '@mastra/memory';
import { AgentId, DEFAULT_AGENT_MODEL } from '../config/index.js';
import { buildChannelAdapters } from '../utils/adapters.js';
import { instructions } from './instructions/research-manager.js';

const memory = new Memory({
  options: {
    lastMessages: 20,
    semanticRecall: false,
    workingMemory: {
      enabled: true,
    },
  },
});

export const researchManager = new Agent({
  id: AgentId.RESEARCH_MANAGER,
  name: 'Research Manager',
  instructions,
  model: DEFAULT_AGENT_MODEL,
  memory,
  channels: buildChannelAdapters('RESEARCH_MANAGER'),
});
