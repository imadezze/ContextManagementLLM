/**
 * Summarization Service - COMPRESS Context Strategy (Alternative)
 * Summarizes old conversation messages instead of dropping them
 */

import OpenAI from 'openai';
import { Message } from '../types/index.js';
import { CONFIG } from '../config.js';

export class SummarizationService {
  private openai: OpenAI;

  constructor() {
    this.openai = new OpenAI({
      apiKey: process.env.OPENAI_API_KEY
    });
  }

  /**
   * Summarize a segment of conversation messages
   * @param messages Messages to summarize (oldest messages)
   * @param targetTokens Target token count for the summary
   * @returns Summary message
   */
  async summarizeMessages(messages: Message[], targetTokens: number): Promise<Message> {
    if (messages.length === 0) {
      throw new Error('Cannot summarize empty message array');
    }

    // Format messages for summarization
    const conversationText = messages
      .map(m => `${m.role}: ${m.content}`)
      .join('\n');

    // Create summarization prompt
    const systemPrompt = `You are a conversation summarizer. Your task is to create a concise summary of the conversation that preserves key information, context, and important details.

The summary should:
- Capture the main topics discussed
- Preserve important facts, decisions, and conclusions
- Maintain chronological flow
- Be approximately ${Math.floor(targetTokens * 4)} characters (about ${targetTokens} tokens)
- Use third person ("The user asked about...", "The assistant explained...")`;

    const userPrompt = `Summarize this conversation segment:\n\n${conversationText}`;

    try {
      const response = await this.openai.chat.completions.create({
        model: 'gpt-4o-mini', // Using mini for cost efficiency
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt }
        ],
        temperature: 0.3, // Low temperature for consistent summaries
        max_tokens: Math.min(targetTokens * 2, CONFIG.SUMMARY_MAX_TOKENS) // Allow up to 2x target tokens or configured max
      });

      const summaryContent = response.choices[0]?.message?.content || 'Summary unavailable';

      // Return as a system message
      return {
        role: 'system',
        content: `[Previous conversation summary: ${summaryContent}]`,
        timestamp: Date.now()
      };
    } catch (error) {
      console.error('Summarization error:', error);
      // Fallback: create a simple summary without API call
      return {
        role: 'system',
        content: `[Previous conversation: ${messages.length} messages exchanged between ${new Date(messages[0].timestamp).toLocaleTimeString()} and ${new Date(messages[messages.length - 1].timestamp).toLocaleTimeString()}]`,
        timestamp: Date.now()
      };
    }
  }

  /**
   * Determine if summarization would be beneficial
   * @param messagesToSummarize Number of messages that would be summarized
   * @param currentTokens Current token count of those messages
   * @returns Whether summarization is worthwhile
   */
  shouldSummarize(messagesToSummarize: number, currentTokens: number): boolean {
    // Only summarize if:
    // 1. We have at least 4 messages to summarize (2 exchanges)
    // 2. The summary would save at least 50% of tokens
    return messagesToSummarize >= 4 && currentTokens > 100;
  }
}
