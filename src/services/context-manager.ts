/**
 * Context Manager - COMPRESS Context Strategy
 * Manages context window with configurable token budget
 * Supports both pruning (FIFO) and summarization strategies
 */

import { Message, KnowledgeEntry, MemoryEntry, ContextWindow, ContextBudget } from '../types/index.js';
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
      memoryBudget: Math.floor(maxTokens * CONFIG.BUDGET_MEMORY_PCT / 100),
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
    relevantMemories: MemoryEntry[],
    relevantKnowledge: KnowledgeEntry[],
    currentQuery: string
  ): Promise<ContextWindow> {
    const debug = process.env.DEBUG === 'true';

    // 1. Start with system prompt
    let currentTokens = TokenCounter.countText(this.systemPrompt);

    // 2. Add memory entries (SELECT strategy - highest priority)
    const selectedMemories = this.selectMemoryEntries(
      relevantMemories,
      this.budget.memoryBudget
    );
    const memoryTokens = TokenCounter.countMemoryEntries(selectedMemories);
    currentTokens += memoryTokens;

    // 3. Add knowledge entries (SELECT strategy)
    const selectedKnowledge = this.selectKnowledgeEntries(
      relevantKnowledge,
      this.budget.knowledgeBudget
    );
    const knowledgeTokens = TokenCounter.countKnowledgeEntries(selectedKnowledge);
    currentTokens += knowledgeTokens;

    // 4. Add conversation history (COMPRESS strategy - pruning or summarization)
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

    // 4. Verify we're under budget - if not, aggressively compress conversation
    const available = this.budget.maxTokens - this.budget.safetyMargin;
    if (currentTokens > available) {
      if (debug) {
        console.warn(`[WARNING] Context exceeds budget: ${currentTokens} > ${available}`);
        console.log(`[INFO] Attempting aggressive compression to fit within budget...`);
      }

      // Calculate how much we need to reduce
      const excess = currentTokens - available;
      const systemAndKnowledgeTokens = TokenCounter.countText(this.systemPrompt) + knowledgeTokens;
      const reducedConversationBudget = Math.max(
        this.budget.conversationBudget - excess - 50, // Extra 50 token safety buffer
        100 // Minimum 100 tokens for conversation
      );

      if (debug) {
        console.log(`[INFO] Reducing conversation budget from ${this.budget.conversationBudget} to ${reducedConversationBudget} tokens`);
      }

      // Recompress conversation history with reduced budget
      if (CONFIG.COMPRESSION_STRATEGY === 'summarize') {
        if (debug) {
          console.log(`[INFO] Using summarization strategy for aggressive compression`);
          console.log(`[INFO] ALLOW_SUMMARIZATION_FALLBACK=${CONFIG.ALLOW_SUMMARIZATION_FALLBACK}`);
        }
        const result = await this.summarizeConversationHistory(
          conversationHistory,
          reducedConversationBudget,
          systemAndKnowledgeTokens
        );
        compressedHistory = result.messages;
        historyTokens = result.tokens;

        if (debug) {
          const hasSummary = compressedHistory.some(m => m.role === 'system' && m.content.includes('[Previous conversation summary'));
          console.log(`[INFO] Summarization result: ${hasSummary ? 'Created summary' : 'No summary created (fallback to recent messages only)'}`);
        }
      } else {
        if (debug) {
          console.log(`[INFO] Using pruning strategy for aggressive compression`);
        }
        compressedHistory = this.pruneConversationHistory(
          conversationHistory,
          reducedConversationBudget,
          systemAndKnowledgeTokens
        );
        historyTokens = TokenCounter.countMessages(compressedHistory);
      }

      // Recalculate total
      currentTokens = systemAndKnowledgeTokens + historyTokens;

      if (debug) {
        console.log(`[INFO] After aggressive compression: ${currentTokens} tokens (target: ${available})`);
      }

      // If still over budget, warn but proceed
      if (currentTokens > available) {
        if (debug) {
          console.warn(`[WARNING] Still exceeds budget after aggressive compression. Proceeding anyway.`);
        }
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

      // 2. Memory Entries Detail
      lines.push('');
      lines.push(`2. Memory Entries: ${memoryTokens} tokens (${selectedMemories.length} selected)`);
      lines.push(`   Budget: ${this.budget.memoryBudget} tokens`);
      lines.push(`   Status: ${memoryTokens <= this.budget.memoryBudget ? '✓' : '✗'}`);
      if (selectedMemories.length > 0) {
        selectedMemories.forEach((entry, idx) => {
          const entryTokens = TokenCounter.countMemoryEntry(entry);
          lines.push(`   Memory ${idx + 1} [${entry.category}]: "${entry.content.substring(0, 50)}..." = ${entryTokens} tokens`);
        });
      } else {
        lines.push('   No relevant memories found');
      }

      // 3. Knowledge Entries Detail
      lines.push('');
      lines.push(`3. Knowledge Entries: ${knowledgeTokens} tokens (${selectedKnowledge.length} selected)`);
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

      // 4. Conversation History Detail
      lines.push('');
      lines.push(`4. Conversation History: ${historyTokens} tokens (${compressedHistory.length} messages)`);
      lines.push(`   Budget: ${this.budget.conversationBudget} tokens`);
      lines.push(`   Status: ${historyTokens <= this.budget.conversationBudget ? '✓' : '✗'}`);
      lines.push(`   Strategy: ${CONFIG.COMPRESSION_STRATEGY}`);
      if (compressedHistory.length > 0) {
        compressedHistory.forEach((msg, idx) => {
          const msgTokens = TokenCounter.countMessage(msg);

          // Show full content for all messages (replace newlines with spaces for readability)
          const preview = msg.content.replace(/\n/g, ' ');

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
      lines.push('5. Summary:');
      lines.push(`   System:       ${systemTokens.toString().padStart(4)} tokens (${((systemTokens/this.budget.systemPromptBudget)*100).toFixed(1)}% of ${this.budget.systemPromptBudget})`);
      lines.push(`   Memory:       ${memoryTokens.toString().padStart(4)} tokens (${((memoryTokens/this.budget.memoryBudget)*100).toFixed(1)}% of ${this.budget.memoryBudget})`);
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
      const filled = Math.min(Math.floor((used / max) * barWidth), barWidth); // Clamp to barWidth
      const empty = Math.max(barWidth - filled, 0); // Prevent negative
      const bar = '█'.repeat(filled) + '░'.repeat(empty);
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
      systemPrompt: this.formatSystemPromptWithMemoryAndKnowledge(this.systemPrompt, selectedMemories, selectedKnowledge),
      memoryEntries: selectedMemories,
      knowledgeEntries: selectedKnowledge,
      conversationHistory: compressedHistory,
      totalTokens: currentTokens,
      debugInfo
    };
  }

  /**
   * Select memory entries that fit within budget (most recent first)
   */
  private selectMemoryEntries(
    entries: MemoryEntry[],
    budget: number
  ): MemoryEntry[] {
    const selected: MemoryEntry[] = [];
    let currentTokens = 0;

    // Memories are already sorted by date (most recent first) from MemoryService
    for (const entry of entries) {
      const entryTokens = TokenCounter.countMemoryEntry(entry);

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

      // Keep message if:
      // 1. It fits in the token budget, OR
      // 2. We haven't reached MIN_RECENT_MESSAGES yet
      const needsMoreMessages = pruned.length < CONFIG.MIN_RECENT_MESSAGES;
      const fitsInBudget = currentTokens + messageTokens <= actualBudget;

      if (fitsInBudget || needsMoreMessages) {
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
    const debug = process.env.DEBUG === 'true';
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

      // Keep message if:
      // 1. It fits in the token budget, OR
      // 2. We haven't reached MIN_RECENT_MESSAGES yet
      const needsMoreMessages = recentMessages.length < CONFIG.MIN_RECENT_MESSAGES;
      const fitsInBudget = recentTokens + messageTokens <= actualBudget;

      if (fitsInBudget || needsMoreMessages) {
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
    // (unless ALLOW_SUMMARIZATION_FALLBACK is disabled, then always attempt summarization)
    const oldMessagesTokens = TokenCounter.countMessages(oldMessages);
    const shouldSummarize = this.summarizationService.shouldSummarize(oldMessages.length, oldMessagesTokens);

    if (debug) {
      console.log(`   [Summarization check] Old messages: ${oldMessages.length} (${oldMessagesTokens} tokens)`);
      console.log(`   [Summarization check] shouldSummarize: ${shouldSummarize} (requires >=4 messages AND >=100 tokens)`);
      console.log(`   [Summarization check] ALLOW_SUMMARIZATION_FALLBACK: ${CONFIG.ALLOW_SUMMARIZATION_FALLBACK}`);
    }

    if (CONFIG.ALLOW_SUMMARIZATION_FALLBACK && !shouldSummarize) {
      // Just prune instead (fallback enabled and conditions not met)
      if (debug) {
        console.log(`   ℹ️  Falling back to pruning: ${oldMessages.length} messages (${oldMessagesTokens} tokens) below threshold`);
        console.log(`   ℹ️  Keeping only recent messages (no summary created)`);
      }
      return { messages: recentMessages, tokens: recentTokens };
    }

    if (!shouldSummarize && debug) {
      console.log(`   ⚠️  Forcing summarization despite low message count (ALLOW_SUMMARIZATION_FALLBACK=false)`);
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
   * Format system prompt with memory and knowledge entries
   */
  private formatSystemPromptWithMemoryAndKnowledge(
    basePrompt: string,
    memories: MemoryEntry[],
    knowledge: KnowledgeEntry[]
  ): string {
    let result = basePrompt;

    // Add memories first (highest priority)
    if (memories.length > 0) {
      const memoryText = memories
        .map(entry => `[${entry.category}] ${entry.content}`)
        .join('\n');
      result += `\n\n## Important Context (from Memory):\n\n${memoryText}`;
    }

    // Add knowledge entries
    if (knowledge.length > 0) {
      const knowledgeText = knowledge
        .map(entry => `### ${entry.title}\n${entry.content}`)
        .join('\n\n');
      result += `\n\n## Knowledge Base:\n\n${knowledgeText}`;
    }

    if (memories.length === 0 && knowledge.length === 0) {
      result += '\n\n[No relevant context found]';
    }

    return result;
  }
}
