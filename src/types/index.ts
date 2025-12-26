/**
 * Core type definitions for the context-aware AI agent
 */

export interface KnowledgeEntry {
  id: string;
  title: string;
  content: string;
}

export interface MemoryEntry {
  id: string;
  category: string;
  content: string;
  date: string; // ISO timestamp
}

export interface Message {
  role: 'user' | 'assistant' | 'system';
  content: string;
  timestamp: number;
}

export interface ContextWindow {
  systemPrompt: string;
  memoryEntries: MemoryEntry[];
  knowledgeEntries: KnowledgeEntry[];
  conversationHistory: Message[];
  totalTokens: number;
  debugInfo?: string; // Optional debug breakdown (when DEBUG=true)
}

export interface ContextBudget {
  maxTokens: number;
  systemPromptBudget: number;
  memoryBudget: number;
  knowledgeBudget: number;
  conversationBudget: number;
  safetyMargin: number;
}
