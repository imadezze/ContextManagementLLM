/**
 * Context Manager - COMPRESS Context Strategy
 * Manages context window with strict 1500 token budget
 */

import { Message, KnowledgeEntry, ContextWindow, ContextBudget } from '../types/index.js';
import { TokenCounter } from '../utils/token-counter.js';

export class ContextManager {
  private readonly budget: ContextBudget = {
    maxTokens: 1500,
    safetyMargin: 100,
    systemPromptBudget: 150,
    knowledgeBudget: 600,
    conversationBudget: 650
  };

  private readonly systemPrompt = `You are a helpful assistant that answers questions based on a knowledge base.

IMPORTANT RULES:
1. If the answer is in the provided knowledge base below, use that information to answer
2. If the answer is NOT in the knowledge base, clearly state: "I don't have that information in my knowledge base"
3. Be concise and accurate
4. Reference the knowledge base entries when appropriate`;

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

    if (debug) {
      console.log('\n[CONTEXT BREAKDOWN]');
      console.log(`System prompt: ${TokenCounter.countText(this.systemPrompt)} tokens`);
      console.log(`Knowledge entries: ${knowledgeTokens} tokens (${selectedKnowledge.length} entries)`);
      console.log(`Conversation history: ${historyTokens} tokens (${prunedHistory.length} messages)`);
      console.log(`Total: ${currentTokens}/${this.budget.maxTokens} tokens`);
      console.log(`Available: ${available - currentTokens} tokens remaining\n`);
    }

    return {
      systemPrompt: this.formatSystemPromptWithKnowledge(this.systemPrompt, selectedKnowledge),
      knowledgeEntries: selectedKnowledge,
      conversationHistory: prunedHistory,
      totalTokens: currentTokens
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

    const removedCount = history.length - pruned.length;
    if (removedCount > 0 && process.env.DEBUG === 'true') {
      console.log(`[PRUNED] Removed ${removedCount} old messages to fit budget`);
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
