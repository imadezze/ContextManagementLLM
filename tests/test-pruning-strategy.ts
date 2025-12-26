/**
 * Test script for PRUNING compression strategy
 * Tests FIFO (First In, First Out) message removal
 */

import { config } from 'dotenv';
import { ContextManager } from '../src/services/context-manager.js';
import { Message, KnowledgeEntry } from '../src/types/index.js';

// Load environment
config();

// Ensure pruning strategy is set
process.env.COMPRESSION_STRATEGY = 'prune';
process.env.DEBUG = 'true';

async function testPruningStrategy() {
  console.log('\n' + '='.repeat(70));
  console.log('TESTING PRUNING STRATEGY (FIFO)');
  console.log('='.repeat(70) + '\n');

  const contextManager = new ContextManager();

  // Create a long conversation history that exceeds budget
  const conversationHistory: Message[] = [];

  // Simulate 15 exchanges (30 messages)
  for (let i = 1; i <= 15; i++) {
    conversationHistory.push({
      role: 'user',
      content: `This is user message number ${i}. ${' '.repeat(50 * i)}`, // Increasing size
      timestamp: Date.now() + i * 1000
    });

    conversationHistory.push({
      role: 'assistant',
      content: `This is assistant response number ${i}. ${' '.repeat(50 * i)}`, // Increasing size
      timestamp: Date.now() + i * 1000 + 500
    });
  }

  console.log(`📊 Created ${conversationHistory.length} messages in conversation history\n`);

  // No knowledge entries for this test
  const memoryEntries: any[] = [];
  const knowledgeEntries: KnowledgeEntry[] = [];

  // Build context with pruning strategy
  console.log('🔄 Building context with PRUNING strategy...\n');

  const context = await contextManager.buildContext(
    conversationHistory,
    memoryEntries,
    knowledgeEntries,
    'What was my first question?'
  );

  console.log('\n' + '='.repeat(70));
  console.log('PRUNING STRATEGY TEST RESULTS');
  console.log('='.repeat(70));
  console.log(`\n✅ Total messages before pruning: ${conversationHistory.length}`);
  console.log(`✅ Messages after pruning: ${context.conversationHistory.length}`);
  console.log(`✅ Messages removed (oldest first): ${conversationHistory.length - context.conversationHistory.length}`);
  console.log(`✅ Total tokens used: ${context.totalTokens}`);
  console.log(`\n📝 Oldest message kept:`);
  if (context.conversationHistory.length > 0) {
    const oldest = context.conversationHistory[0];
    console.log(`   Role: ${oldest.role}`);
    console.log(`   Content: ${oldest.content.substring(0, 50)}...`);
  }

  console.log(`\n📝 Newest message:`);
  if (context.conversationHistory.length > 0) {
    const newest = context.conversationHistory[context.conversationHistory.length - 1];
    console.log(`   Role: ${newest.role}`);
    console.log(`   Content: ${newest.content.substring(0, 50)}...`);
  }

  console.log('\n' + '='.repeat(70));
  console.log('✅ PRUNING STRATEGY TEST COMPLETED');
  console.log('='.repeat(70) + '\n');
}

// Run test
testPruningStrategy().catch(error => {
  console.error('❌ Test failed:', error);
  process.exit(1);
});
