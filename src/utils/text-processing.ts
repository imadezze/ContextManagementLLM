/**
 * Text processing utilities for keyword extraction
 */

const STOP_WORDS = new Set([
  'a', 'an', 'and', 'are', 'as', 'at', 'be', 'by', 'for', 'from',
  'has', 'he', 'in', 'is', 'it', 'its', 'of', 'on', 'that', 'the',
  'to', 'was', 'will', 'with', 'what', 'when', 'where', 'who', 'how',
  'about', 'all', 'any', 'but', 'can', 'did', 'do', 'if', 'no', 'not',
  'or', 'so', 'such', 'than', 'then', 'there', 'these', 'they', 'this',
  'those', 'you', 'your'
]);

export class TextProcessor {
  /**
   * Extract keywords from text by removing stop words and normalizing
   */
  static extractKeywords(text: string): string[] {
    return text
      .toLowerCase()
      .replace(/[^\w\s]/g, ' ') // Remove punctuation
      .split(/\s+/)
      .filter(word => word.length > 2 && !STOP_WORDS.has(word));
  }

  /**
   * Calculate term frequency for keywords in text
   */
  static calculateTermFrequency(text: string): Map<string, number> {
    const keywords = this.extractKeywords(text);
    const frequency = new Map<string, number>();

    for (const keyword of keywords) {
      frequency.set(keyword, (frequency.get(keyword) || 0) + 1);
    }

    return frequency;
  }
}
