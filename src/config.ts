/**
 * Configuration constants
 */

export const CONFIG = {
  DATA_PATH: './data/tellia_assessment_demo.json',
  MAX_TOKENS: parseInt(process.env.MAX_TOKENS || '1500', 10),
  TOP_K_RETRIEVAL: 3
} as const;
