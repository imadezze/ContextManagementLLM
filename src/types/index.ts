/**
 * Core type definitions for the context-aware AI agent
 */

export interface KnowledgeEntry {
  id: string;
  title: string;
  content: string;
}

export interface Message {
  role: 'user' | 'assistant' | 'system';
  content: string;
  timestamp: number;
}

export interface ContextWindow {
  systemPrompt: string;
  knowledgeEntries: KnowledgeEntry[];
  conversationHistory: Message[];
  totalTokens: number;
}

export interface ContextBudget {
  maxTokens: number;
  systemPromptBudget: number;
  knowledgeBudget: number;
  conversationBudget: number;
  safetyMargin: number;
}
