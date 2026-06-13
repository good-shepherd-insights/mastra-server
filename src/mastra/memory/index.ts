import { Memory } from '@mastra/memory';

export const sharedMemory = new Memory({
  options: {
    lastMessages: 20,
    semanticRecall: false,
    workingMemory: {
      enabled: true,
    },
  },
});
