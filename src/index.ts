/**
 * Context-Aware AI Agent - Main Entry Point
 * Implements custom context management with configurable token limit
 */

import * as readline from 'readline';
import { run } from '@openai/agents';
import { KnowledgeBaseService } from './services/knowledge-base.js';
import { RetrievalService } from './services/retrieval.js';
import { ContextManager } from './services/context-manager.js';
import { createAgent } from './services/agent.js';
import { Message } from './types/index.js';
import { CONFIG } from './config.js';

async function main() {
  // Validate environment
  if (!process.env.OPENAI_API_KEY) {
    console.error('Error: OPENAI_API_KEY not found in environment variables');
    console.error('Please create a .env file with your OpenAI API key');
    process.exit(1);
  }

  console.log('Context-Aware AI Agent');
  console.log('=====================');
  console.log(`Token Budget: ${CONFIG.MAX_TOKENS} tokens`);
  console.log(`Compression Strategy: ${CONFIG.COMPRESSION_STRATEGY} (from env: ${process.env.COMPRESSION_STRATEGY || 'not set'})`);
  console.log('Commands: "exit" to quit, "/save" to save conversation');
  console.log();

  // Initialize services
  const knowledgeBase = new KnowledgeBaseService('./data/tellia_assessment_demo.json');
  const retrievalService = new RetrievalService(knowledgeBase.getAllEntries());
  const contextManager = new ContextManager();

  // Conversation state
  const conversationHistory: Message[] = [];
  let conversationLog: string[] = []; // Track what user sees on screen

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

      // Handle /save command
      if (userInput.toLowerCase() === '/save') {
        try {
          const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, -5);
          const filename = `saved_conversations/conversation_${timestamp}.md`;
          const fs = await import('fs');

          const content = [
            '# Conversation Log',
            `**Saved:** ${new Date().toLocaleString()}`,
            `**Debug Mode:** ${process.env.DEBUG === 'true' ? 'ON' : 'OFF'}`,
            '',
            '---',
            '',
            ...conversationLog
          ].join('\n');

          fs.writeFileSync(filename, content);
          console.log(`\n✅ Conversation saved to: ${filename}\n`);
        } catch (error) {
          console.error(`\n❌ Failed to save conversation: ${error instanceof Error ? error.message : error}\n`);
        }
        continue;
      }

      if (!userInput.trim()) {
        continue;
      }

      // Log user input
      conversationLog.push(`## You\n${userInput}\n`);

      // Add user message to history
      conversationHistory.push({
        role: 'user',
        content: userInput,
        timestamp: Date.now()
      });

      // SELECT: Retrieve relevant knowledge
      const relevantKnowledge = retrievalService.retrieve(userInput);

      // COMPRESS: Build context with token management (supports pruning or summarization)
      const context = await contextManager.buildContext(
        conversationHistory,
        relevantKnowledge,
        userInput
      );

      // Display token usage
      const tokenInfo = `[${context.totalTokens}/${CONFIG.MAX_TOKENS} tokens]`;
      console.log(tokenInfo);
      conversationLog.push(`**Tokens:** ${tokenInfo}\n`);

      // Save debug breakdown if available
      if (context.debugInfo) {
        conversationLog.push('```\n' + context.debugInfo + '```\n');
      }

      // Create agent with custom context injected
      // We inject the system prompt and conversation history into the agent's instructions
      const contextualAgent = createAgent();
      contextualAgent.instructions = context.systemPrompt + '\n\n' +
        'Previous conversation:\n' +
        context.conversationHistory
          .slice(0, -1) // Exclude the current user message
          .map(m => `${m.role}: ${m.content}`)
          .join('\n');

      // Run agent with retry logic for API errors
      let assistantResponse: string | undefined;
      let retries = 0;
      const maxRetries = 3;

      while (retries <= maxRetries) {
        try {
          const result = await run(contextualAgent, userInput);
          assistantResponse = result.finalOutput || 'No response generated';
          break; // Success, exit retry loop
        } catch (apiError: any) {
          const isRetryable = apiError?.status === 503 ||
                             apiError?.status === 429 ||
                             apiError?.code === 'ECONNRESET' ||
                             apiError?.message?.includes('503') ||
                             apiError?.message?.includes('timeout');

          if (isRetryable && retries < maxRetries) {
            retries++;
            const waitTime = Math.min(1000 * Math.pow(2, retries - 1), 10000); // Exponential backoff, max 10s

            if (process.env.DEBUG === 'true') {
              console.log(`\n[DEBUG] API error (${apiError?.status || 'unknown'}), retry ${retries}/${maxRetries} in ${waitTime}ms...`);
            } else {
              console.log(`\n⏳ Temporary issue, retrying...`);
            }

            await new Promise(resolve => setTimeout(resolve, waitTime));
            continue;
          } else {
            // Non-retryable error or max retries exceeded
            throw apiError;
          }
        }
      }

      // Only add to history if we got a response
      if (assistantResponse) {
        conversationHistory.push({
          role: 'assistant',
          content: assistantResponse,
          timestamp: Date.now()
        });

        console.log(`\nAssistant: ${assistantResponse}`);
        conversationLog.push(`## Assistant\n${assistantResponse}\n`);
      }

    } catch (error: any) {
      // User-friendly error messages
      let errorMsg = '';
      if (error?.status === 401 || error?.message?.includes('API key')) {
        errorMsg = '❌ Error: Invalid API key. Please check your OPENAI_API_KEY in .env file';
      } else if (error?.status === 429) {
        errorMsg = '❌ Error: Rate limit exceeded. Please wait a moment and try again.';
      } else if (error?.status === 503) {
        errorMsg = '❌ Error: OpenAI service temporarily unavailable. Please try again in a moment.';
      } else if (error?.code === 'ENOTFOUND' || error?.code === 'ECONNREFUSED') {
        errorMsg = '❌ Error: Cannot connect to OpenAI. Please check your internet connection.';
      } else {
        errorMsg = '❌ Error: Unable to get response from AI';
        if (process.env.DEBUG === 'true') {
          errorMsg += `\n    Details: ${error?.message || error}`;
          if (error?.stack) {
            errorMsg += `\n    Stack: ${error.stack}`;
          }
        } else {
          errorMsg += '\n    (Run with DEBUG=true for more details)';
        }
      }
      console.error('\n' + errorMsg);
      conversationLog.push(`## Error\n${errorMsg}\n`);
    }
  }

  rl.close();
}

// Run the application
main().catch(error => {
  console.error('Fatal error:', error);
  process.exit(1);
});
