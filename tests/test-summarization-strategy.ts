/**
 * Test script for SUMMARIZATION compression strategy
 * Tests summarizing old messages instead of removing them
 */

import { config } from 'dotenv';
import { ContextManager } from '../src/services/context-manager.js';
import { Message, KnowledgeEntry } from '../src/types/index.js';

// Load environment
config();

// Ensure summarization strategy is set
process.env.COMPRESSION_STRATEGY = 'summarize';
process.env.DEBUG = 'true';

async function testSummarizationStrategy() {
  console.log('\n' + '='.repeat(70));
  console.log('TESTING SUMMARIZATION STRATEGY');
  console.log('='.repeat(70) + '\n');

  const contextManager = new ContextManager();

  // Create a meaningful conversation history that exceeds budget
  const conversationHistory: Message[] = [];

  // Simulate a technical discussion about TypeScript
  const topics = [
    { q: 'What is TypeScript?', a: 'TypeScript is a statically typed superset of JavaScript that compiles to plain JavaScript. It adds optional static typing, classes, and interfaces to JavaScript.' },
    { q: 'What are the main benefits of TypeScript?', a: 'TypeScript provides early error detection through static typing, better IDE support with autocomplete and refactoring tools, improved code documentation through type annotations, and enhanced code maintainability in large projects.' },
    { q: 'How do TypeScript interfaces work?', a: 'Interfaces in TypeScript define the structure of objects. They specify what properties and methods an object should have. Interfaces are purely for type checking and compile-time validation - they disappear after compilation.' },
    { q: 'What is the difference between type and interface?', a: 'Both type and interface can define object shapes, but types are more flexible and can represent unions, intersections, and primitives. Interfaces are extendable through declaration merging and are primarily for object shapes.' },
    { q: 'Explain TypeScript generics', a: 'Generics allow you to write reusable code that works with multiple types while maintaining type safety. They act like parameters for types, letting you create components that work over a variety of types rather than a single one.' },
    { q: 'What are TypeScript decorators?', a: 'Decorators are special declarations that can be attached to classes, methods, properties, or parameters. They provide a way to add annotations and meta-programming syntax. Decorators use the @expression syntax.' },
    { q: 'How does TypeScript handle null and undefined?', a: 'TypeScript has strict null checking mode which treats null and undefined as distinct types. This helps catch null reference errors at compile time. You can use union types or optional chaining to handle potentially null values safely.' },
    { q: 'What are TypeScript utility types?', a: 'Utility types are built-in generic types that facilitate common type transformations. Examples include Partial<T>, Required<T>, Pick<T, K>, Omit<T, K>, Record<K, T>, and many others that help manipulate types.' }
  ];

  for (let i = 0; i < topics.length; i++) {
    conversationHistory.push({
      role: 'user',
      content: topics[i].q,
      timestamp: Date.now() + i * 1000
    });

    conversationHistory.push({
      role: 'assistant',
      content: topics[i].a,
      timestamp: Date.now() + i * 1000 + 500
    });
  }

  console.log(`📊 Created ${conversationHistory.length} messages in conversation history`);
  console.log(`📊 Topics covered: TypeScript basics, benefits, interfaces, types, generics, decorators, null handling, utility types\n`);

  // No knowledge entries for this test
  const knowledgeEntries: KnowledgeEntry[] = [];

  // Build context with summarization strategy
  console.log('🔄 Building context with SUMMARIZATION strategy...');
  console.log('⏳ This will call OpenAI API to summarize old messages...\n');

  const memoryEntries: any[] = [];
  const context = await contextManager.buildContext(
    conversationHistory,
    memoryEntries,
    knowledgeEntries,
    'Can you give me an example of using generics?'
  );

  console.log('\n' + '='.repeat(70));
  console.log('SUMMARIZATION STRATEGY TEST RESULTS');
  console.log('='.repeat(70));
  console.log(`\n✅ Total messages before compression: ${conversationHistory.length}`);
  console.log(`✅ Messages after compression: ${context.conversationHistory.length}`);
  console.log(`✅ Total tokens used: ${context.totalTokens}`);

  // Check if summary was created
  const hasSummary = context.conversationHistory.some(
    m => m.role === 'system' && m.content.includes('[Previous conversation summary')
  );

  if (hasSummary) {
    console.log(`\n📝 SUMMARY CREATED: Old messages were summarized`);
    const summaryMessage = context.conversationHistory.find(
      m => m.role === 'system' && m.content.includes('[Previous conversation summary')
    );
    if (summaryMessage) {
      console.log(`\n📄 Summary content:`);
      console.log(`   ${summaryMessage.content.substring(0, 200)}...`);
    }
  } else {
    console.log(`\n⚠️  NO SUMMARY: All messages fit in budget or summarization was skipped`);
  }

  console.log(`\n📝 Recent messages kept:`);
  context.conversationHistory
    .filter(m => m.role !== 'system')
    .slice(-4) // Show last 2 exchanges
    .forEach((msg, idx) => {
      console.log(`   ${idx + 1}. [${msg.role}]: ${msg.content.substring(0, 60)}...`);
    });

  console.log('\n' + '='.repeat(70));
  console.log('✅ SUMMARIZATION STRATEGY TEST COMPLETED');
  console.log('='.repeat(70) + '\n');

  console.log('💡 Key observations:');
  console.log('   - Summarization preserves context from old messages');
  console.log('   - Recent messages are kept intact for immediate context');
  console.log('   - Summary is added as a system message');
  console.log('   - This strategy costs more (extra API call) but preserves information\n');
}

// Run test
testSummarizationStrategy().catch(error => {
  console.error('❌ Test failed:', error);
  process.exit(1);
});
