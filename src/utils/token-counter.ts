/**
 * Token counter utility
 * Uses simple character-based approximation: 1 token ≈ 4 characters
 */

import { Message, KnowledgeEntry } from '../types/index.js';

export class TokenCounter {
  private static readonly CHARS_PER_TOKEN = 4;

  /**
   * Estimate tokens for a text string
   */
  static countText(text: string): number {
    return Math.ceil(text.length / this.CHARS_PER_TOKEN);
  }

  /**
   * Count tokens in a message
   */
  static countMessage(message: Message): number {
    return this.countText(message.content);
  }

  /**
   * Count tokens in multiple messages
   */
  static countMessages(messages: Message[]): number {
    return messages.reduce((total, msg) => total + this.countMessage(msg), 0);
  }

  /**
   * Count tokens in a knowledge entry (title + content)
   */
  static countKnowledgeEntry(entry: KnowledgeEntry): number {
    return this.countText(entry.title + '\n' + entry.content);
  }

  /**
   * Count tokens in multiple knowledge entries
   */
  static countKnowledgeEntries(entries: KnowledgeEntry[]): number {
    return entries.reduce((total, entry) => total + this.countKnowledgeEntry(entry), 0);
  }
}
