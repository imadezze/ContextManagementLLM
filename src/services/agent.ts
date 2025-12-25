/**
 * OpenAI Agent Setup
 * Uses OpenAI Agents JS framework with custom context management
 */

import { Agent } from '@openai/agents';

export function createAgent(): Agent {
  return new Agent({
    name: 'KnowledgeAssistant',
    instructions: 'You are a helpful assistant. Follow the instructions in the system prompt carefully.',
    model: 'gpt-4o-mini' // Fast and cost-effective
  });
}
