import { Agent } from '@mastra/core/agent';
import {
  createPromptAlignmentScorerLLM,
  createCompletenessScorer,
  createToolCallAccuracyScorerLLM,
} from '@mastra/evals/scorers/prebuilt';
import { AgentId, DEFAULT_AGENT_MODEL } from '../config/index.js';
import { buildChannelAdapters } from '../utils/adapters.js';
import { sharedMemory } from '../memory/index.js';
import { webSearchTool } from '../tools/index.js';
import { instructions } from './instructions/operations-manager.js';

export const operationsManager = new Agent({
  id: AgentId.OPERATIONS_MANAGER,
  name: 'Operations Manager',
  instructions,
  model: DEFAULT_AGENT_MODEL,
  memory: sharedMemory,
  tools: { webSearchTool },
  channels: buildChannelAdapters('OPS_MANAGER', AgentId.OPERATIONS_MANAGER),
  scorers: {
    promptAlignment: {
      scorer: createPromptAlignmentScorerLLM({ model: DEFAULT_AGENT_MODEL }),
      sampling: { type: 'ratio', rate: 0.5 },
    },
    completeness: {
      scorer: createCompletenessScorer(),
      sampling: { type: 'ratio', rate: 1 },
    },
    toolCallAccuracy: {
      scorer: createToolCallAccuracyScorerLLM({
        model: DEFAULT_AGENT_MODEL,
        availableTools: [webSearchTool],
      }),
      sampling: { type: 'ratio', rate: 0.5 },
    },
  },
});
