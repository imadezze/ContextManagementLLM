# Context-Aware AI Agent

A Node.js/TypeScript AI agent with custom context management, enforcing a strict 1500-token limit while maintaining conversation continuity and knowledge base retrieval.

## Overview

This project demonstrates explicit context engineering for AI agents:

- **SELECT Context**: Retrieve only relevant knowledge entries via keyword-based RAG
- **COMPRESS Context**: Trim and manage conversation history to fit token budget

## Setup Instructions

### Prerequisites

- Node.js 18+ and npm
- OpenAI API key

### Installation

1. Install dependencies:
```bash
npm install
```

2. Create `.env` file:
```bash
cp .env.example .env
```

3. Add your OpenAI API key to `.env`:
```bash
OPENAI_API_KEY=your_api_key_here
DEBUG=false                         # Set to true for detailed token usage logs
MAX_TOKENS=1500                     # Optional: Adjust token budget (default: 1500)
TOP_K_RETRIEVAL=3                   # Optional: Max knowledge entries to retrieve (default: 3)
COMPRESSION_STRATEGY=prune          # Optional: prune (default) or summarize
SUMMARY_MAX_TOKENS_PCT=33           # Optional: Max summary tokens as % of MAX_TOKENS (default: 33%)
ALLOW_SUMMARIZATION_FALLBACK=true   # Optional: Allow fallback to pruning (default: true)
MIN_RECENT_MESSAGES=0               # Optional: Min recent messages to keep intact (default: 0)

# Optional: Budget allocation percentages (default values shown)
BUDGET_SAFETY_MARGIN_PCT=7     # Safety buffer [105 tokens for 1500]
BUDGET_SYSTEM_PROMPT_PCT=10    # System instructions [150 tokens for 1500]
BUDGET_KNOWLEDGE_PCT=40        # Knowledge entries [600 tokens for 1500]
BUDGET_CONVERSATION_PCT=43     # Conversation history [645 tokens for 1500]
```

**Configuration Options**:
- `OPENAI_API_KEY` (required): Your OpenAI API key
- `DEBUG` (optional): `true` for detailed logs, `false` for normal mode
- `MAX_TOKENS` (optional): Maximum context window size (default: 1500)
- `TOP_K_RETRIEVAL` (optional): Max knowledge entries per query (default: 3)
- `COMPRESSION_STRATEGY` (optional): `prune` (default, fast) or `summarize` (preserves context)
- `SUMMARY_MAX_TOKENS_PCT` (optional): Max summary tokens as % of MAX_TOKENS (default: 33%)
- `ALLOW_SUMMARIZATION_FALLBACK` (optional): Allow fallback to pruning for small message sets (default: true)
- `MIN_RECENT_MESSAGES` (optional): Minimum recent messages to keep intact (default: 0)
- `BUDGET_*_PCT` (optional): Budget allocation percentages (see above for defaults)

4. Build the project:
```bash
npm run build
```

### Running the Agent

```bash
npm start
```

**Commands**:
- Type your questions and press Enter
- `exit` - Quit the application
- `/save` - Save current conversation to file

**Saved conversations** are stored in `saved_conversations/` folder as Markdown files.

## How Context is Built

The context window is constructed in three stages:

### 1. System Prompt (10% of budget - ~150 tokens)
- Base instructions for the agent (handles greetings and casual conversation naturally)
- Formatted knowledge base entries
- Rules for prioritizing knowledge base for factual questions

### 2. Knowledge Entries (40% of budget - ~600 tokens)
- **SELECT Strategy**: Retrieves top 3 most relevant entries using keyword matching
- Scores entries by term frequency (title matches weighted 3x)
- Adds entries until knowledge budget exhausted

### 3. Conversation History (43% of budget - ~650 tokens)
- **COMPRESS Strategy**: Most recent messages prioritized
- FIFO removal when budget exceeded
- Always preserves at least the current exchange

### 4. Safety Margin (7% of budget - ~100 tokens)
- Buffer for estimation variance
- Prevents hard limit breaches

### Example Context Window Structure

```
System Prompt + Knowledge Entries (750 tokens)
  ├─ "You are a helpful assistant..."
  └─ Relevant knowledge entries (up to 3)

Conversation History (650 tokens)
  ├─ user: "What is X?" (100 tokens)
  ├─ assistant: "X is..." (200 tokens)
  ├─ user: "Tell me more" (50 tokens)
  └─ assistant: "..." (300 tokens)

Total: ~1400/1500 tokens (safety margin preserved)
```

## How Token Limit is Enforced

### Token Counting Method
- Simple character-based approximation: **1 token ≈ 4 characters**
- Fast, no external dependencies
- Good enough for budget enforcement

### Budget Allocation
Defined in `src/services/context-manager.ts`:

```typescript
{
  maxTokens: 1500,
  safetyMargin: 100,
  systemPromptBudget: 150,
  knowledgeBudget: 600,
  conversationBudget: 650
}
```

### Enforcement Steps

1. Count system prompt tokens
2. Add knowledge entries until budget exhausted
3. Add conversation messages (newest first) until budget exhausted
4. Verify total < (1500 - 100) safety limit

## What Happens When Conversation Gets Long

The system supports two compression strategies (configurable via `COMPRESSION_STRATEGY`).

**Important**: If the total context exceeds `MAX_TOKENS` (even when individual components are within their budgets), the system **automatically triggers aggressive compression** to reduce the conversation history and fit within the budget. See [Automatic Budget Enforcement](docs/configuration.md#automatic-budget-enforcement) for details.

### Strategy 1: Pruning (Default - FIFO)

When conversation history exceeds its budget:

1. **Keep most recent messages** - Work backwards from newest
2. **Remove oldest first** - FIFO (First In, First Out)
3. **Log pruning** - Debug mode shows what was removed
4. **Graceful degradation** - Context quality degrades smoothly
5. **Fast & free** - No additional API calls required

### Strategy 2: Summarization

Alternative approach that preserves old context:

1. **Keep recent messages** - Latest exchanges preserved intact
2. **Summarize old messages** - Older context compressed into summary
3. **Preserve information** - Key points from old messages retained
4. **Additional cost** - Requires extra API call to create summary
5. **Better continuity** - Maintains more conversational context

### Example: Before Pruning

```
Messages (800 tokens - exceeds 650 budget):
1. user: "Old question" (100 tokens)
2. assistant: "Old answer" (150 tokens)
3. user: "Another question" (100 tokens)
4. assistant: "Another answer" (200 tokens)
5. user: "Latest question" (100 tokens)
6. assistant: "Latest answer" (150 tokens)
```

### After Pruning

```
Messages (550 tokens - fits in budget):
3. user: "Another question" (100 tokens)
4. assistant: "Another answer" (200 tokens)
5. user: "Latest question" (100 tokens)
6. assistant: "Latest answer" (150 tokens)

Removed: Messages 1-2 (oldest 250 tokens)
```

## Architecture & Design Decisions

### Framework Choice
**Decision**: OpenAI Agents JS with custom context management
**Rationale**:
- Framework handles agent loop and LLM calls
- We implement explicit context management (per assessment requirement)
- TypeScript-first design
- Simple, minimal API

### Retrieval Method (SELECT Strategy)
**Decision**: Keyword matching with term frequency scoring
**Rationale**:
- No external dependencies
- Fast and explainable
- Title matches weighted 3x for better precision
- Easy to upgrade to embeddings later

**Alternative Considered**: Embedding-based similarity
- Better semantic understanding
- Requires additional API calls
- More complexity
- Overkill for this dataset size

### Pruning Strategy (COMPRESS Strategy)
**Decision**: Recency-based with FIFO removal
**Rationale**:
- Simple and predictable
- Most relevant information is usually recent
- Maintains conversational coherence
- Aligns with human working memory

**Alternative Considered**: Importance-based scoring
- Could preserve critical context
- Adds complexity
- Harder to explain and debug

### Token Counting
**Decision**: Character-based approximation (chars/4)
**Rationale**:
- No external tokenizer needed
- Fast computation
- Good enough for budget enforcement
- Transparent and explainable

**Alternative Considered**: Actual tokenizer (tiktoken)
- More accurate
- External dependency
- Slower
- Unnecessary precision for this use case

### Interface
**Decision**: CLI with readline
**Rationale**:
- Simple to implement
- Easy to demo and test
- No frontend required
- Native Node.js module

## Project Structure

```
src/
  ├── types/
  │   └── index.ts              # Core type definitions
  ├── services/
  │   ├── knowledge-base.ts     # Load & manage knowledge entries
  │   ├── retrieval.ts          # SELECT: Keyword-based retrieval
  │   ├── context-manager.ts    # COMPRESS: Token budgeting & pruning
  │   └── agent.ts              # OpenAI Agent setup
  ├── utils/
  │   ├── token-counter.ts      # Token estimation
  │   └── text-processing.ts    # Keyword extraction
  ├── index.ts                  # CLI entry point
  └── config.ts                 # Configuration constants
```

## Key Implementation Details

### Custom Context Management

The `ContextManager` class (`src/services/context-manager.ts`) is the core of our implementation:

```typescript
buildContext(
  conversationHistory: Message[],
  relevantKnowledge: KnowledgeEntry[],
  currentQuery: string
): ContextWindow
```

This method:
1. Allocates token budgets
2. Selects knowledge entries (SELECT)
3. Prunes conversation history (COMPRESS)
4. Verifies we're under limit
5. Returns formatted context window

### Context Injection

We bypass the OpenAI Agents SDK's built-in conversation management:

```typescript
// Create fresh agent per turn
const contextualAgent = createAgent();

// Inject our custom context into instructions
contextualAgent.instructions =
  context.systemPrompt +
  '\n\nPrevious conversation:\n' +
  formattedHistory;

// Run with just current message
const result = await run(contextualAgent, userInput);
```

This ensures **we control every message** sent to the LLM.

## What Would Be Improved With More Time

### Retrieval Improvements
1. **Embedding-based retrieval** - Better semantic matching
2. **Hybrid search** - Combine keyword + embeddings
3. **Re-ranking** - Score candidates with cross-encoder
4. **Query expansion** - Handle synonyms and related terms

### Context Management Improvements
1. ✅ **Summarization** - Implemented as alternative compression strategy
2. **Importance scoring** - Keep critical context even if old
3. **Sliding window with overlap** - Preserve more coherence
4. **Dynamic budget allocation** - Adjust based on conversation needs
5. **Hybrid compression** - Combine summarization + importance scoring

### Production Features
1. **Session persistence** - Save/restore conversations
2. **Conversation branching** - Support multiple threads
3. **Actual tokenizer** - Use tiktoken for accuracy
4. **Error recovery** - Better handling of API failures
5. **Rate limiting** - Respect API quotas
6. **Metrics & monitoring** - Track performance
7. **Tests** - Unit and integration tests
8. **Configuration** - Runtime adjustable budgets

### Performance Optimizations
1. **Cache knowledge embeddings** - Pre-compute at startup
2. **Batch processing** - Multiple queries in parallel
3. **Streaming responses** - Better UX for long answers

## Testing

To test the context management:

### Short Conversation (2-3 exchanges)
- Verify knowledge retrieval works
- Check token counting accuracy

### Long Conversation (10+ exchanges)
- Verify pruning activates
- Confirm context stays under 1500 tokens
- Check agent maintains coherence

### Edge Cases
- Very long user messages
- Questions not in knowledge base
- Multiple relevant knowledge entries

Enable debug mode to see detailed logs:
```bash
DEBUG=true npm start
```
## License

MIT
