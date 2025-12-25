/**
 * Context Manager - COMPRESS Context Strategy
 * Manages context window with configurable token budget
 * Supports both pruning (FIFO) and summarization strategies
 */

import { Message, KnowledgeEntry, ContextWindow, ContextBudget } from '../types/index.js';
import { TokenCounter } from '../utils/token-counter.js';
import { CONFIG } from '../config.js';
import { SummarizationService } from './summarization.js';

export class ContextManager {
  private readonly budget: ContextBudget;
  private readonly summarizationService: SummarizationService;

  constructor() {
    const maxTokens = CONFIG.MAX_TOKENS;
    // Calculate budgets as percentages of max tokens (configurable via .env)
    this.budget = {
      maxTokens,
      safetyMargin: Math.floor(maxTokens * CONFIG.BUDGET_SAFETY_MARGIN_PCT / 100),
      systemPromptBudget: Math.floor(maxTokens * CONFIG.BUDGET_SYSTEM_PROMPT_PCT / 100),
      knowledgeBudget: Math.floor(maxTokens * CONFIG.BUDGET_KNOWLEDGE_PCT / 100),
      conversationBudget: Math.floor(maxTokens * CONFIG.BUDGET_CONVERSATION_PCT / 100)
    };
    this.summarizationService = new SummarizationService();
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
   * Supports both pruning and summarization strategies
   */
  async buildContext(
    conversationHistory: Message[],
    relevantKnowledge: KnowledgeEntry[],
    currentQuery: string
  ): Promise<ContextWindow> {
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

    // 3. Add conversation history (COMPRESS strategy - pruning or summarization)
    let compressedHistory: Message[];
    let historyTokens: number;

    if (CONFIG.COMPRESSION_STRATEGY === 'summarize') {
      const result = await this.summarizeConversationHistory(
        conversationHistory,
        this.budget.conversationBudget,
        currentTokens
      );
      compressedHistory = result.messages;
      historyTokens = result.tokens;
    } else {
      // Default: prune (FIFO)
      compressedHistory = this.pruneConversationHistory(
        conversationHistory,
        this.budget.conversationBudget,
        currentTokens
      );
      historyTokens = TokenCounter.countMessages(compressedHistory);
    }

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
      lines.push(`3. Conversation History: ${historyTokens} tokens (${compressedHistory.length} messages)`);
      lines.push(`   Budget: ${this.budget.conversationBudget} tokens`);
      lines.push(`   Status: ${historyTokens <= this.budget.conversationBudget ? '✓' : '✗'}`);
      lines.push(`   Strategy: ${CONFIG.COMPRESSION_STRATEGY}`);
      if (compressedHistory.length > 0) {
        compressedHistory.forEach((msg, idx) => {
          const msgTokens = TokenCounter.countMessage(msg);

          // Show full content for summary messages, truncate others
          const isSummary = msg.role === 'system' && msg.content.includes('[Previous conversation summary');
          const preview = isSummary
            ? msg.content.replace(/\n/g, ' ')
            : msg.content.substring(0, 50).replace(/\n/g, ' ') + '...';

          lines.push(`   Msg ${idx + 1} [${msg.role}]: "${preview}" = ${msgTokens} tokens`);
        });
      }

      // 4. Compression Info
      const removedCount = conversationHistory.length - compressedHistory.length;
      const hasSummary = compressedHistory.some(m => m.role === 'system' && m.content.includes('[Previous conversation summary'));

      if (CONFIG.COMPRESSION_STRATEGY === 'summarize' && hasSummary) {
        // Count how many messages were summarized vs kept
        const keptMessages = compressedHistory.filter(m => m.role !== 'system' || !m.content.includes('[Previous conversation summary'));
        const summarizedCount = conversationHistory.length - keptMessages.length;

        lines.push('');
        lines.push(`   📝 SUMMARIZED: ${summarizedCount} old messages compressed into summary`);
        lines.push(`   ✓ KEPT INTACT: ${keptMessages.length} recent messages (no summarization)`);
      } else if (removedCount > 0) {
        const removedTokens = TokenCounter.countMessages(conversationHistory.slice(0, removedCount));
        lines.push('');
        lines.push(`   ⚠️  PRUNED: ${removedCount} old messages (${removedTokens} tokens removed)`);
      }

      // 5. Total Summary
      lines.push('');
      lines.push('4. Summary:');
      lines.push(`   System:       ${systemTokens.toString().padStart(4)} tokens (${((systemTokens/this.budget.systemPromptBudget)*100).toFixed(1)}% of ${this.budget.systemPromptBudget})`);
      lines.push(`   Knowledge:    ${knowledgeTokens.toString().padStart(4)} tokens (${((knowledgeTokens/this.budget.knowledgeBudget)*100).toFixed(1)}% of ${this.budget.knowledgeBudget})`);
      lines.push(`   Conversation: ${historyTokens.toString().padStart(4)} tokens (${((historyTokens/this.budget.conversationBudget)*100).toFixed(1)}% of ${this.budget.conversationBudget})`);
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
      conversationHistory: compressedHistory,
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
   * Summarize conversation history to fit within budget
   * Keeps recent messages, summarizes old ones
   */
  private async summarizeConversationHistory(
    history: Message[],
    budget: number,
    alreadyUsedTokens: number
  ): Promise<{ messages: Message[]; tokens: number }> {
    const remaining = this.budget.maxTokens - this.budget.safetyMargin - alreadyUsedTokens;
    const actualBudget = Math.min(budget, remaining);

    if (history.length === 0) {
      return { messages: [], tokens: 0 };
    }

    // Always keep recent messages (work backwards)
    const recentMessages: Message[] = [];
    let recentTokens = 0;

    for (let i = history.length - 1; i >= 0; i--) {
      const message = history[i];
      const messageTokens = TokenCounter.countMessage(message);

      if (recentTokens + messageTokens <= actualBudget) {
        recentMessages.unshift(message);
        recentTokens += messageTokens;
      } else {
        break;
      }
    }

    // If all messages fit, no summarization needed
    if (recentMessages.length === history.length) {
      return { messages: recentMessages, tokens: recentTokens };
    }

    // Determine how many old messages to summarize
    const oldMessages = history.slice(0, history.length - recentMessages.length);

    // Only summarize if we have enough old messages to make it worthwhile
    const oldMessagesTokens = TokenCounter.countMessages(oldMessages);
    if (!this.summarizationService.shouldSummarize(oldMessages.length, oldMessagesTokens)) {
      // Just prune instead
      return { messages: recentMessages, tokens: recentTokens };
    }

    // Calculate target token count for summary (aim for 30% of original)
    const targetSummaryTokens = Math.floor(oldMessagesTokens * 0.3);

    try {
      // Summarize old messages
      const summary = await this.summarizationService.summarizeMessages(
        oldMessages,
        targetSummaryTokens
      );

      const summaryTokens = TokenCounter.countMessage(summary);

      // Check if summary + recent messages fit in budget
      if (summaryTokens + recentTokens <= actualBudget) {
        return {
          messages: [summary, ...recentMessages],
          tokens: summaryTokens + recentTokens
        };
      } else {
        // Summary too large, just use recent messages
        return { messages: recentMessages, tokens: recentTokens };
      }
    } catch (error) {
      console.error('Summarization failed, falling back to pruning:', error);
      // Fallback to pruning
      return { messages: recentMessages, tokens: recentTokens };
    }
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
