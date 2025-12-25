/**
 * Configuration constants
 */

import { config } from 'dotenv';

// Load environment variables before reading them
config();

const maxTokens = parseInt(process.env.MAX_TOKENS || '1500', 10);
const summaryMaxTokensPct = parseInt(process.env.SUMMARY_MAX_TOKENS_PCT || '33', 10);

export const CONFIG = {
  DATA_PATH: './data/tellia_assessment_demo.json',
  MAX_TOKENS: maxTokens,
  TOP_K_RETRIEVAL: parseInt(process.env.TOP_K_RETRIEVAL || '3', 10),

  // Budget allocation percentages
  BUDGET_SAFETY_MARGIN_PCT: parseInt(process.env.BUDGET_SAFETY_MARGIN_PCT || '7', 10),
  BUDGET_SYSTEM_PROMPT_PCT: parseInt(process.env.BUDGET_SYSTEM_PROMPT_PCT || '10', 10),
  BUDGET_KNOWLEDGE_PCT: parseInt(process.env.BUDGET_KNOWLEDGE_PCT || '40', 10),
  BUDGET_CONVERSATION_PCT: parseInt(process.env.BUDGET_CONVERSATION_PCT || '43', 10),

  // Compression strategy: 'prune' or 'summarize'
  COMPRESSION_STRATEGY: (process.env.COMPRESSION_STRATEGY || 'prune') as 'prune' | 'summarize',

  // Maximum tokens for summary generation (calculated from percentage of MAX_TOKENS)
  SUMMARY_MAX_TOKENS_PCT: summaryMaxTokensPct,
  SUMMARY_MAX_TOKENS: Math.floor(maxTokens * summaryMaxTokensPct / 100),

  // Allow summarization to fall back to pruning for small message sets
  ALLOW_SUMMARIZATION_FALLBACK: process.env.ALLOW_SUMMARIZATION_FALLBACK !== 'false',

  // Minimum number of recent messages to keep intact (not summarized)
  MIN_RECENT_MESSAGES: parseInt(process.env.MIN_RECENT_MESSAGES || '0', 10)
} as const;
