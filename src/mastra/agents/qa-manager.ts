import { Agent } from '@mastra/core/agent';
import {
  createFaithfulnessScorer,
  createHallucinationScorer,
  createBiasScorer,
  createCompletenessScorer,
} from '@mastra/evals/scorers/prebuilt';
import { AgentId, DEFAULT_AGENT_MODEL } from '../config/index.js';
import { buildChannelAdapters } from '../utils/adapters.js';
import { sharedMemory } from '../memory/index.js';
import { webSearchTool, webExtractTool } from '../tools/index.js';
import { instructions } from './instructions/qa-manager.js';

export const qaManager = new Agent({
  id: AgentId.QA_MANAGER,
  name: 'QA Manager',
  instructions,
  model: DEFAULT_AGENT_MODEL,
  memory: sharedMemory,
  tools: { webSearchTool, webExtractTool },
  channels: buildChannelAdapters('QA_MANAGER', AgentId.QA_MANAGER),
  scorers: {
    faithfulness: {
      scorer: createFaithfulnessScorer({ model: DEFAULT_AGENT_MODEL }),
      sampling: { type: 'ratio', rate: 0.5 },
    },
    hallucination: {
      scorer: createHallucinationScorer({ model: DEFAULT_AGENT_MODEL }),
      sampling: { type: 'ratio', rate: 0.5 },
    },
    bias: {
      scorer: createBiasScorer({ model: DEFAULT_AGENT_MODEL }),
      sampling: { type: 'ratio', rate: 0.5 },
    },
    completeness: {
      scorer: createCompletenessScorer(),
      sampling: { type: 'ratio', rate: 1 },
    },
  },
});
