/**
 * Configuration constants
 */

import { config } from 'dotenv';

// Load environment variables before reading them
config();

export const CONFIG = {
  DATA_PATH: './data/tellia_assessment_demo.json',
  MAX_TOKENS: parseInt(process.env.MAX_TOKENS || '1500', 10),
  TOP_K_RETRIEVAL: parseInt(process.env.TOP_K_RETRIEVAL || '3', 10),

  // Budget allocation percentages
  BUDGET_SAFETY_MARGIN_PCT: parseInt(process.env.BUDGET_SAFETY_MARGIN_PCT || '7', 10),
  BUDGET_SYSTEM_PROMPT_PCT: parseInt(process.env.BUDGET_SYSTEM_PROMPT_PCT || '10', 10),
  BUDGET_KNOWLEDGE_PCT: parseInt(process.env.BUDGET_KNOWLEDGE_PCT || '40', 10),
  BUDGET_CONVERSATION_PCT: parseInt(process.env.BUDGET_CONVERSATION_PCT || '43', 10),

  // Compression strategy: 'prune' or 'summarize'
  COMPRESSION_STRATEGY: (process.env.COMPRESSION_STRATEGY || 'prune') as 'prune' | 'summarize',

  // Maximum tokens for summary generation (when using summarization strategy)
  SUMMARY_MAX_TOKENS: parseInt(process.env.SUMMARY_MAX_TOKENS || '500', 10)
} as const;
