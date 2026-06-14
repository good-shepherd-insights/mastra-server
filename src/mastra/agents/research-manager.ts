import { Agent } from '@mastra/core/agent';
import {
  createFaithfulnessScorer,
  createHallucinationScorer,
  createCompletenessScorer,
  createToolCallAccuracyScorerLLM,
} from '@mastra/evals/scorers/prebuilt';
import { AgentId, DEFAULT_AGENT_MODEL } from '../config/index.js';
import { buildChannelAdapters } from '../utils/adapters.js';
import { sharedMemory } from '../memory/index.js';
import { webSearchTool, webExtractTool } from '../tools/index.js';
import { instructions } from './instructions/research-manager.js';

export const researchManager = new Agent({
  id: AgentId.RESEARCH_MANAGER,
  name: 'Research Manager',
  instructions,
  model: DEFAULT_AGENT_MODEL,
  memory: sharedMemory,
  tools: { webSearchTool, webExtractTool },
  channels: buildChannelAdapters('RESEARCH_MANAGER', AgentId.RESEARCH_MANAGER),
  scorers: {
    faithfulness: {
      scorer: createFaithfulnessScorer({ model: DEFAULT_AGENT_MODEL }),
      sampling: { type: 'ratio', rate: 0.5 },
    },
    hallucination: {
      scorer: createHallucinationScorer({ model: DEFAULT_AGENT_MODEL }),
      sampling: { type: 'ratio', rate: 0.5 },
    },
    completeness: {
      scorer: createCompletenessScorer(),
      sampling: { type: 'ratio', rate: 1 },
    },
    toolCallAccuracy: {
      scorer: createToolCallAccuracyScorerLLM({
        model: DEFAULT_AGENT_MODEL,
        availableTools: [webSearchTool, webExtractTool],
      }),
      sampling: { type: 'ratio', rate: 0.5 },
    },
  },
});
