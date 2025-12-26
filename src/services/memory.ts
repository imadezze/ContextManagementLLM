/**
 * Memory Service - Manages persistent memory storage
 */

import { readFileSync, writeFileSync, readdirSync, existsSync, mkdirSync } from 'fs';
import { join } from 'path';
import { MemoryEntry } from '../types/index.js';

export class MemoryService {
  private memories: MemoryEntry[] = [];
  private memoryPath: string;
  private nextId: number = 1;

  constructor(memoryPath: string = './memory') {
    this.memoryPath = memoryPath;
    this.loadMemories();
  }

  /**
   * Load all memory entries from the memory folder
   */
  private loadMemories(): void {
    try {
      if (!existsSync(this.memoryPath)) {
        console.log(`Memory folder not found. Creating at: ${this.memoryPath}`);
        return;
      }

      const files = readdirSync(this.memoryPath).filter(f => f.endsWith('.json'));

      for (const file of files) {
        try {
          const filePath = join(this.memoryPath, file);
          const data = readFileSync(filePath, 'utf-8');
          const memory: MemoryEntry = JSON.parse(data);

          // Validation
          if (!memory.id || !memory.category || !memory.content || !memory.date) {
            console.warn(`Invalid memory file ${file}: missing required fields`);
            continue;
          }

          this.memories.push(memory);

          // Track highest ID for generating new IDs
          const idNum = parseInt(memory.id.replace('mem_', ''));
          if (!isNaN(idNum) && idNum >= this.nextId) {
            this.nextId = idNum + 1;
          }
        } catch (error) {
          console.error(`Failed to load memory file ${file}:`, error);
        }
      }

      console.log(`Loaded ${this.memories.length} memory entries`);
    } catch (error) {
      console.error(`Failed to load memories:`, error);
    }
  }

  /**
   * Save a new memory entry
   */
  saveMemory(category: string, content: string): MemoryEntry {
    const memory: MemoryEntry = {
      id: `mem_${this.nextId.toString().padStart(3, '0')}`,
      category,
      content,
      date: new Date().toISOString()
    };

    this.nextId++;

    try {
      // Ensure memory directory exists
      if (!existsSync(this.memoryPath)) {
        mkdirSync(this.memoryPath, { recursive: true });
      }

      const filePath = join(this.memoryPath, `${memory.id}.json`);
      writeFileSync(filePath, JSON.stringify(memory, null, 2), 'utf-8');
      this.memories.push(memory);
      console.log(`Saved memory: ${memory.id} (${category})`);
      return memory;
    } catch (error) {
      console.error(`Failed to save memory:`, error);
      throw error;
    }
  }

  /**
   * Get memories by category
   */
  getMemoriesByCategory(category: string): MemoryEntry[] {
    return this.memories
      .filter(m => m.category === category)
      .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime()); // Most recent first
  }

  /**
   * Get memories by multiple categories
   */
  getMemoriesByCategories(categories: string[]): MemoryEntry[] {
    return this.memories
      .filter(m => categories.includes(m.category))
      .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime()); // Most recent first
  }

  /**
   * Get all memories
   */
  getAllMemories(): MemoryEntry[] {
    return this.memories.sort((a, b) =>
      new Date(b.date).getTime() - new Date(a.date).getTime()
    );
  }

  /**
   * Get all unique categories
   */
  getCategories(): string[] {
    const categories = new Set(this.memories.map(m => m.category));
    return Array.from(categories);
  }

  /**
   * Get memory count
   */
  getCount(): number {
    return this.memories.length;
  }
}
