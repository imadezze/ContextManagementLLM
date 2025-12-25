/**
 * Knowledge Base Service
 * Loads and manages knowledge entries from JSON file
 */

import { readFileSync } from 'fs';
import { KnowledgeEntry } from '../types/index.js';

export class KnowledgeBaseService {
  private entries: KnowledgeEntry[] = [];

  constructor(dataPath: string) {
    this.loadKnowledgeBase(dataPath);
  }

  /**
   * Load knowledge base from JSON file
   */
  private loadKnowledgeBase(dataPath: string): void {
    try {
      const data = readFileSync(dataPath, 'utf-8');
      const parsed = JSON.parse(data);

      // Validate structure
      if (!Array.isArray(parsed)) {
        throw new Error('Knowledge base must be an array');
      }

      this.entries = parsed.map((entry: any) => {
        if (!entry.id || !entry.title || !entry.content) {
          throw new Error('Invalid entry: missing required fields (id, title, content)');
        }
        return {
          id: entry.id,
          title: entry.title,
          content: entry.content
        };
      });

      console.log(`Loaded ${this.entries.length} knowledge entries`);
    } catch (error) {
      throw new Error(`Failed to load knowledge base: ${error}`);
    }
  }

  /**
   * Get all knowledge entries
   */
  getAllEntries(): KnowledgeEntry[] {
    return this.entries;
  }

  /**
   * Get entry by ID
   */
  getEntryById(id: string): KnowledgeEntry | undefined {
    return this.entries.find(entry => entry.id === id);
  }
}
