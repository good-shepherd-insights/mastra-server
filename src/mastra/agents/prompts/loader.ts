import { readFileSync } from 'fs';
import { parse } from 'yaml';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const __dir = dirname(fileURLToPath(import.meta.url));

export function loadPrompt(agentId: string): string {
  const raw = readFileSync(join(__dir, `${agentId}.yaml`), 'utf-8');
  return (parse(raw) as { instructions: string }).instructions.trimEnd();
}
