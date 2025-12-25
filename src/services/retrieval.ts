/**
 * Retrieval Service - SELECT Context Strategy
 * Retrieves relevant knowledge entries using keyword matching
 */

import { KnowledgeEntry } from '../types/index.js';
import { TextProcessor } from '../utils/text-processing.js';

interface ScoredEntry {
  entry: KnowledgeEntry;
  score: number;
}

export class RetrievalService {
  constructor(private knowledgeEntries: KnowledgeEntry[]) {}

  /**
   * Retrieve top K most relevant entries for a query
   */
  retrieve(query: string, topK: number = 3): KnowledgeEntry[] {
    if (!query.trim()) {
      return [];
    }

    // Score all entries
    const scoredEntries: ScoredEntry[] = this.knowledgeEntries.map(entry => ({
      entry,
      score: this.scoreEntry(entry, query)
    }));

    // Sort by score descending and take top K
    return scoredEntries
      .filter(scored => scored.score > 0) // Only include entries with positive scores
      .sort((a, b) => b.score - a.score)
      .slice(0, topK)
      .map(scored => scored.entry);
  }

  /**
   * Score an entry against a query using keyword matching
   */
  private scoreEntry(entry: KnowledgeEntry, query: string): number {
    const queryKeywords = TextProcessor.extractKeywords(query);
    const titleKeywords = TextProcessor.extractKeywords(entry.title);
    const contentKeywords = TextProcessor.extractKeywords(entry.content);

    let score = 0;

    // Check each query keyword
    for (const queryKeyword of queryKeywords) {
      // Title matches are weighted higher (3x)
      if (titleKeywords.includes(queryKeyword)) {
        score += 3;
      }
      // Content matches
      if (contentKeywords.includes(queryKeyword)) {
        score += 1;
      }
    }

    return score;
  }
}
