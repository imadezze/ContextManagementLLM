/**
 * Context Manager - COMPRESS Context Strategy
 * Manages context window with configurable token budget
 */

import { Message, KnowledgeEntry, ContextWindow, ContextBudget } from '../types/index.js';
import { TokenCounter } from '../utils/token-counter.js';
import { CONFIG } from '../config.js';

export class ContextManager {
  private readonly budget: ContextBudget;

  constructor() {
    const maxTokens = CONFIG.MAX_TOKENS;
    // Calculate budgets as percentages of max tokens
    this.budget = {
      maxTokens,
      safetyMargin: Math.floor(maxTokens * 0.07),      // 7%
      systemPromptBudget: Math.floor(maxTokens * 0.10), // 10%
      knowledgeBudget: Math.floor(maxTokens * 0.40),    // 40%
      conversationBudget: Math.floor(maxTokens * 0.43)  // 43%
    };
  }

  private readonly systemPrompt = `You are a helpful and friendly assistant.

IMPORTANT RULES:
1. Respond naturally to greetings, casual conversation, and general questions
2. For factual or informational questions: prioritize using the knowledge base below
3. If asked a factual question that's NOT in the knowledge base, clearly state: "I don't have that information in my knowledge base"
4. Be concise, accurate, and friendly
5. Reference knowledge base entries when using them to answer`;

  /**
   * Build context window with token budget enforcement
   */
  buildContext(
    conversationHistory: Message[],
    relevantKnowledge: KnowledgeEntry[],
    currentQuery: string
  ): ContextWindow {
    const debug = process.env.DEBUG === 'true';

    // 1. Start with system prompt
    let currentTokens = TokenCounter.countText(this.systemPrompt);

    // 2. Add knowledge entries (SELECT strategy)
    const selectedKnowledge = this.selectKnowledgeEntries(
      relevantKnowledge,
      this.budget.knowledgeBudget
    );
    const knowledgeTokens = TokenCounter.countKnowledgeEntries(selectedKnowledge);
    currentTokens += knowledgeTokens;

    // 3. Add conversation history (COMPRESS strategy)
    const prunedHistory = this.pruneConversationHistory(
      conversationHistory,
      this.budget.conversationBudget,
      currentTokens
    );
    const historyTokens = TokenCounter.countMessages(prunedHistory);
    currentTokens += historyTokens;

    // 4. Verify we're under budget
    const available = this.budget.maxTokens - this.budget.safetyMargin;
    if (currentTokens > available) {
      if (debug) {
        console.warn(`[WARNING] Context exceeds budget: ${currentTokens} > ${available}`);
      }
    }

    // Build debug info
    let debugInfo: string | undefined;
    if (debug) {
      const systemTokens = TokenCounter.countText(this.systemPrompt);
      const removedCount = conversationHistory.length - prunedHistory.length;

      const lines: string[] = [];
      lines.push('='.repeat(60));
      lines.push('TOKEN BREAKDOWN FOR THIS EXCHANGE');
      lines.push('='.repeat(60));

      // 1. System Prompt
      lines.push('');
      lines.push(`1. System Prompt: ${systemTokens} tokens`);
      lines.push(`   Budget: ${this.budget.systemPromptBudget} tokens`);
      lines.push(`   Status: ${systemTokens <= this.budget.systemPromptBudget ? '✓' : '✗'}`);

      // 2. Knowledge Entries Detail
      lines.push('');
      lines.push(`2. Knowledge Entries: ${knowledgeTokens} tokens (${selectedKnowledge.length} selected)`);
      lines.push(`   Budget: ${this.budget.knowledgeBudget} tokens`);
      lines.push(`   Status: ${knowledgeTokens <= this.budget.knowledgeBudget ? '✓' : '✗'}`);
      if (selectedKnowledge.length > 0) {
        selectedKnowledge.forEach((entry, idx) => {
          const entryTokens = TokenCounter.countKnowledgeEntry(entry);
          lines.push(`   Entry ${idx + 1}: "${entry.title.substring(0, 40)}..." = ${entryTokens} tokens`);
        });
      } else {
        lines.push('   No relevant knowledge entries found');
      }

      // 3. Conversation History Detail
      lines.push('');
      lines.push(`3. Conversation History: ${historyTokens} tokens (${prunedHistory.length} messages)`);
      lines.push(`   Budget: ${this.budget.conversationBudget} tokens`);
      lines.push(`   Status: ${historyTokens <= this.budget.conversationBudget ? '✓' : '✗'}`);
      if (prunedHistory.length > 0) {
        prunedHistory.forEach((msg, idx) => {
          const msgTokens = TokenCounter.countMessage(msg);
          const preview = msg.content.substring(0, 50).replace(/\n/g, ' ');
          lines.push(`   Msg ${idx + 1} [${msg.role}]: "${preview}..." = ${msgTokens} tokens`);
        });
      }

      // 4. Pruning Info
      if (removedCount > 0) {
        const removedTokens = TokenCounter.countMessages(conversationHistory.slice(0, removedCount));
        lines.push('');
        lines.push(`   ⚠️  PRUNED: ${removedCount} old messages (${removedTokens} tokens removed)`);
      }

      // 5. Total Summary
      lines.push('');
      lines.push('4. Summary:');
      lines.push(`   System:       ${systemTokens.toString().padStart(4)} tokens (${((systemTokens/this.budget.maxTokens)*100).toFixed(1)}%)`);
      lines.push(`   Knowledge:    ${knowledgeTokens.toString().padStart(4)} tokens (${((knowledgeTokens/this.budget.maxTokens)*100).toFixed(1)}%)`);
      lines.push(`   Conversation: ${historyTokens.toString().padStart(4)} tokens (${((historyTokens/this.budget.maxTokens)*100).toFixed(1)}%)`);
      lines.push(`   ${'─'.repeat(30)}`);
      lines.push(`   TOTAL:        ${currentTokens.toString().padStart(4)} / ${this.budget.maxTokens} tokens`);
      lines.push(`   Available:    ${(available - currentTokens).toString().padStart(4)} tokens remaining`);
      lines.push(`   Safety margin: ${this.budget.safetyMargin} tokens`);

      // 6. Visual Progress Bar
      const used = currentTokens;
      const max = this.budget.maxTokens;
      const percentage = (used / max) * 100;
      const barWidth = 40;
      const filled = Math.floor((used / max) * barWidth);
      const bar = '█'.repeat(filled) + '░'.repeat(barWidth - filled);
      lines.push('');
      lines.push(`   Usage: [${bar}] ${percentage.toFixed(1)}%`);

      if (currentTokens > available) {
        lines.push('');
        lines.push('   ⚠️  WARNING: Context exceeds safe limit!');
      }

      lines.push('='.repeat(60));

      debugInfo = '\n' + lines.join('\n') + '\n';
      console.log(debugInfo);
    }

    return {
      systemPrompt: this.formatSystemPromptWithKnowledge(this.systemPrompt, selectedKnowledge),
      knowledgeEntries: selectedKnowledge,
      conversationHistory: prunedHistory,
      totalTokens: currentTokens,
      debugInfo
    };
  }

  /**
   * Select knowledge entries that fit within budget
   */
  private selectKnowledgeEntries(
    entries: KnowledgeEntry[],
    budget: number
  ): KnowledgeEntry[] {
    const selected: KnowledgeEntry[] = [];
    let currentTokens = 0;

    for (const entry of entries) {
      const entryTokens = TokenCounter.countKnowledgeEntry(entry);

      if (currentTokens + entryTokens <= budget) {
        selected.push(entry);
        currentTokens += entryTokens;
      } else {
        break; // Budget exhausted
      }
    }

    return selected;
  }

  /**
   * Prune conversation history to fit within budget (FIFO removal)
   */
  private pruneConversationHistory(
    history: Message[],
    budget: number,
    alreadyUsedTokens: number
  ): Message[] {
    // Always include the most recent messages
    // Remove oldest messages first when budget is exceeded

    const remaining = this.budget.maxTokens - this.budget.safetyMargin - alreadyUsedTokens;
    const actualBudget = Math.min(budget, remaining);

    if (history.length === 0) {
      return [];
    }

    // Start from most recent and work backwards
    const pruned: Message[] = [];
    let currentTokens = 0;

    for (let i = history.length - 1; i >= 0; i--) {
      const message = history[i];
      const messageTokens = TokenCounter.countMessage(message);

      if (currentTokens + messageTokens <= actualBudget) {
        pruned.unshift(message); // Add to front
        currentTokens += messageTokens;
      } else {
        // Budget exhausted, stop adding older messages
        break;
      }
    }

    return pruned;
  }

  /**
   * Format system prompt with knowledge entries
   */
  private formatSystemPromptWithKnowledge(
    basePrompt: string,
    knowledge: KnowledgeEntry[]
  ): string {
    if (knowledge.length === 0) {
      return basePrompt + '\n\n[No relevant knowledge entries found]';
    }

    const knowledgeText = knowledge
      .map(entry => `### ${entry.title}\n${entry.content}`)
      .join('\n\n');

    return `${basePrompt}\n\n## Knowledge Base:\n\n${knowledgeText}`;
  }
}
