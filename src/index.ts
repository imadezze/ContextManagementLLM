/**
 * Context-Aware AI Agent - Main Entry Point
 * Implements custom context management with 1500 token limit
 */

import * as readline from 'readline';
import { config } from 'dotenv';
import { run } from '@openai/agents';
import { KnowledgeBaseService } from './services/knowledge-base.js';
import { RetrievalService } from './services/retrieval.js';
import { ContextManager } from './services/context-manager.js';
import { createAgent } from './services/agent.js';
import { Message } from './types/index.js';

// Load environment variables
config();

async function main() {
  // Validate environment
  if (!process.env.OPENAI_API_KEY) {
    console.error('Error: OPENAI_API_KEY not found in environment variables');
    console.error('Please create a .env file with your OpenAI API key');
    process.exit(1);
  }

  console.log('Context-Aware AI Agent');
  console.log('=====================');
  console.log('Token Budget: 1500 tokens');
  console.log('Type "exit" to quit\n');

  // Initialize services
  const knowledgeBase = new KnowledgeBaseService('./data/tellia_assessment_demo.json');
  const retrievalService = new RetrievalService(knowledgeBase.getAllEntries());
  const contextManager = new ContextManager();

  // Conversation state
  const conversationHistory: Message[] = [];

  // Setup readline interface
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
  });

  const askQuestion = (query: string): Promise<string> => {
    return new Promise(resolve => rl.question(query, resolve));
  };

  // Chat loop
  while (true) {
    try {
      // Get user input
      const userInput = await askQuestion('\nYou: ');

      if (userInput.toLowerCase() === 'exit') {
        console.log('\nGoodbye!');
        break;
      }

      if (!userInput.trim()) {
        continue;
      }

      // Add user message to history
      conversationHistory.push({
        role: 'user',
        content: userInput,
        timestamp: Date.now()
      });

      // SELECT: Retrieve relevant knowledge
      const relevantKnowledge = retrievalService.retrieve(userInput);

      // COMPRESS: Build context with token management
      const context = contextManager.buildContext(
        conversationHistory,
        relevantKnowledge,
        userInput
      );

      // Display token usage
      console.log(`[${context.totalTokens}/1500 tokens]`);

      // Create agent with custom context injected
      // We inject the system prompt and conversation history into the agent's instructions
      const contextualAgent = createAgent();
      contextualAgent.instructions = context.systemPrompt + '\n\n' +
        'Previous conversation:\n' +
        context.conversationHistory
          .slice(0, -1) // Exclude the current user message
          .map(m => `${m.role}: ${m.content}`)
          .join('\n');

      // Run agent with just the current user message
      const result = await run(contextualAgent, userInput);
      const assistantResponse = result.finalOutput || 'No response generated';

      // Add assistant response to history
      conversationHistory.push({
        role: 'assistant',
        content: assistantResponse,
        timestamp: Date.now()
      });

      console.log(`\nAssistant: ${assistantResponse}`);

    } catch (error) {
      console.error('\nError:', error instanceof Error ? error.message : error);
    }
  }

  rl.close();
}

// Run the application
main().catch(error => {
  console.error('Fatal error:', error);
  process.exit(1);
});
