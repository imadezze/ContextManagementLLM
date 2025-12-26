/**
 * Memory Extraction Agent - Determines what to remember from conversations
 */

import OpenAI from 'openai';
import { Message } from '../types/index.js';
import { CONFIG } from '../config.js';

export interface ExtractedMemory {
  category: string;
  content: string;
}

export class MemoryExtractionAgent {
  private openai: OpenAI;

  constructor() {
    this.openai = new OpenAI({
      apiKey: process.env.OPENAI_API_KEY
    });
  }

  /**
   * Analyze a conversation exchange and extract memorable information
   * @param userMessage The user's message
   * @param assistantMessage The assistant's response
   * @returns Extracted memory or null if nothing worth remembering
   */
  async extractMemory(
    userMessage: Message,
    assistantMessage: Message
  ): Promise<ExtractedMemory | null> {
    const systemPrompt = `You are a memory extraction agent. Your task is to analyze conversation exchanges and determine if there's any important information that should be remembered for future conversations.

PREDEFINED CATEGORIES:
${CONFIG.MEMORY_CATEGORIES.map(cat => `- ${cat}`).join('\n')}

RULES:
1. Only extract information that is:
   - Factual and verifiable
   - Likely to be relevant in future conversations
   - About the user, their preferences, decisions, or important context
2. Choose the most appropriate category from the predefined list
3. Write the memory content in third person (e.g., "The user prefers X" or "The project uses Y")
4. Keep the memory content concise (1-2 sentences maximum)
5. If there's nothing worth remembering, return "NONE"

EXAMPLES:
User: "I prefer using TypeScript over JavaScript"
→ Category: user_preference, Content: "The user prefers using TypeScript over JavaScript for development"

User: "My name is Sarah and I work in healthcare"
→ Category: user_info, Content: "The user's name is Sarah and they work in the healthcare industry"

User: "Let's use React for the frontend"
→ Category: decision, Content: "The project will use React for the frontend framework"

User: "What is 2 + 2?"
Assistant: "2 + 2 equals 4"
→ NONE (no memorable information)

RESPONSE FORMAT:
If there's something to remember, respond with:
CATEGORY: <category>
CONTENT: <content>

If nothing to remember, respond with:
NONE`;

    const userPrompt = `Analyze this conversation exchange:

User: ${userMessage.content}
Assistant: ${assistantMessage.content}

Is there anything worth remembering?`;

    try {
      const response = await this.openai.chat.completions.create({
        model: 'gpt-4o-mini',
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt }
        ],
        temperature: 0.3,
        max_tokens: 150
      });

      const result = response.choices[0]?.message?.content || '';

      if (result.trim() === 'NONE') {
        return null;
      }

      // Parse the response
      const categoryMatch = result.match(/CATEGORY:\s*(.+)/i);
      const contentMatch = result.match(/CONTENT:\s*(.+)/i);

      if (!categoryMatch || !contentMatch) {
        console.warn('Memory extraction returned invalid format:', result);
        return null;
      }

      const category = categoryMatch[1].trim();
      const content = contentMatch[1].trim();

      // Validate category
      if (!CONFIG.MEMORY_CATEGORIES.includes(category as any)) {
        console.warn(`Invalid category extracted: ${category}. Defaulting to 'other'`);
        return { category: 'other', content };
      }

      return { category, content };
    } catch (error) {
      console.error('Memory extraction error:', error);
      return null;
    }
  }

  /**
   * Classify a user query into relevant memory categories
   * @param query User's query
   * @returns Array of relevant category names
   */
  async classifyQuery(query: string): Promise<string[]> {
    const systemPrompt = `You are a query classifier. Analyze user queries and determine which memory categories are relevant.

AVAILABLE CATEGORIES:
${CONFIG.MEMORY_CATEGORIES.map(cat => `- ${cat}`).join('\n')}

CATEGORY DESCRIPTIONS:
- user_preference: User's likes, dislikes, preferences, opinions
- user_info: Personal facts about the user (name, job, background)
- project_context: Current project/task information
- decision: Important decisions that were made
- instruction: User-given instructions or rules to follow
- fact: Important factual information
- other: Miscellaneous memorable information

Select 1-3 most relevant categories for the query.

RESPONSE FORMAT:
Return only the category names, one per line.`;

    const userPrompt = `Query: "${query}"

Which memory categories are relevant?`;

    try {
      const response = await this.openai.chat.completions.create({
        model: 'gpt-4o-mini',
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt }
        ],
        temperature: 0.2,
        max_tokens: 50
      });

      const result = response.choices[0]?.message?.content || '';
      const categories = result
        .split('\n')
        .map(line => line.trim().toLowerCase())
        .filter(cat => CONFIG.MEMORY_CATEGORIES.includes(cat as any));

      // If no valid categories, return all categories (search everything)
      return categories.length > 0 ? categories : [...CONFIG.MEMORY_CATEGORIES];
    } catch (error) {
      console.error('Query classification error:', error);
      // Fallback: return all categories
      return [...CONFIG.MEMORY_CATEGORIES];
    }
  }
}
