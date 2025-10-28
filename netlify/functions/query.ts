import type { Handler } from "@netlify/functions";
import { createRagDbConnection, RAG_METADATA, getRagConfig, type RagId } from "../../src/lib/db/separate-db";
import { embeddings } from "../../src/lib/db/separate-schema";
import { sql } from "drizzle-orm";

// ENHANCED RAG SEARCH WITH HYBRID SCORING
// Uses PostgreSQL full-text search with vector similarity for hybrid ranking.
// pg_search BM25 indexes are available but using PostgreSQL ts_rank for compatibility.
// Future: Can be upgraded to native pg_search BM25 when query syntax is resolved.

// Safe metadata parsing helper
function parseMetadata(metadata: any): any {
  if (!metadata) return {};
  if (typeof metadata === 'object') {
    // Handle case where metadata is already an object (not stringified JSON)
    return metadata;
  }
  if (typeof metadata === 'string') {
    try {
      return JSON.parse(metadata);
    } catch {
      console.warn('Failed to parse metadata JSON:', metadata);
      return {};
    }
  }
  return {};
}

// Helper function to shorten author names for token efficiency
function shortenAuthors(authors: string | undefined): string {
  if (!authors) return 'N/A';
  const authorList = authors.split(',').map(a => a.trim());
  if (authorList.length === 1) return authorList[0].split(' ').pop() + ' ' + authorList[0].split(' ')[0].charAt(0);
  if (authorList.length <= 3) return authorList.map(a => a.split(' ').pop()).join(', ');
  return authorList[0].split(' ').pop() + ' et al.';
}

// DeepInfra API configuration
const DEEPINFRA_API_URL = "https://api.deepinfra.com/v1/openai";
const DEEPINFRA_API_KEY = process.env.DEEPINFRA_API_KEY;
// EMBEDDING_MODEL is now dynamic based on RAG selection

// Token limits and validation
const TOKEN_LIMITS = {
  MAX_TARGET_TOKENS: 10000,   // Maximum tokens for responses
  MIN_TARGET_TOKENS: 100,     // Minimum useful response size
  MAX_QUERY_LENGTH: 1000,     // Character limit for user queries
  DEFAULT_TARGET_TOKENS: 1500 // Default if not specified
};

// Abuse prevention configuration
const ABUSE_PREVENTION = {
  MAX_REQUESTS_PER_MINUTE: 3,    // Rate limit per IP
  MAX_CONCURRENT_REQUESTS: 1,    // Max concurrent requests per IP
  SUSPICIOUS_PATTERNS: [
    /select.*from/i,           // SQL injection attempts
    /<script/i,                // XSS attempts
    /javascript:/i,            // JS injection
    /eval\(/i,                 // Code execution attempts
    /[\x00-\x08\x0B\x0C\x0E-\x1F]/, // Control characters
  ],
  BLOCKED_TERMS: [
    'password', 'secret', 'token', 'key', 'admin',
    'drop table', 'delete from', 'update set', 'insert into'
  ]
};

// Simple in-memory rate limiting (for production, use Redis or similar)
const rateLimitStore = new Map<string, { count: number; resetTime: number; activeRequests: number }>();

function checkRateLimit(clientIP: string): { allowed: boolean; reason?: string } {
  const now = Date.now();
  const resetTime = now + 60000; // 1 minute window
  
  if (!rateLimitStore.has(clientIP)) {
    rateLimitStore.set(clientIP, { count: 1, resetTime, activeRequests: 1 });
    return { allowed: true };
  }
  
  const entry = rateLimitStore.get(clientIP)!;
  
  // Reset if window expired
  if (now > entry.resetTime) {
    entry.count = 1;
    entry.resetTime = resetTime;
    entry.activeRequests = Math.max(0, entry.activeRequests); // Don't reset active requests abruptly
  }
  
  // Check concurrent requests
  if (entry.activeRequests >= ABUSE_PREVENTION.MAX_CONCURRENT_REQUESTS) {
    return { allowed: false, reason: `Too many concurrent requests (max ${ABUSE_PREVENTION.MAX_CONCURRENT_REQUESTS})` };
  }
  
  // Check rate limit
  if (entry.count >= ABUSE_PREVENTION.MAX_REQUESTS_PER_MINUTE) {
    return { allowed: false, reason: `Rate limit exceeded (max ${ABUSE_PREVENTION.MAX_REQUESTS_PER_MINUTE} requests per minute)` };
  }
  
  entry.count++;
  entry.activeRequests++;
  return { allowed: true };
}

function releaseRequest(clientIP: string) {
  const entry = rateLimitStore.get(clientIP);
  if (entry) {
    entry.activeRequests = Math.max(0, entry.activeRequests - 1);
  }
}

function detectSuspiciousContent(text: string): string[] {
  const issues: string[] = [];
  
  // Check for suspicious patterns
  for (const pattern of ABUSE_PREVENTION.SUSPICIOUS_PATTERNS) {
    if (pattern.test(text)) {
      issues.push(`Suspicious pattern detected`);
      break; // Don't reveal the specific pattern
    }
  }
  
  // Check for blocked terms (case insensitive)
  const lowerText = text.toLowerCase();
  for (const term of ABUSE_PREVENTION.BLOCKED_TERMS) {
    if (lowerText.includes(term.toLowerCase())) {
      issues.push(`Blocked content detected`);
      break; // Don't reveal the specific term
    }
  }
  
  return issues;
}

// Simple token estimation (rough approximation: 1 token ≈ 4 characters for English)
function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

// Input validation and sanitization
function validateAndSanitizeInput(input: any): {
  isValid: boolean;
  errors: string[];
  sanitized?: any;
} {
  const errors: string[] = [];
  
  // Basic structure validation
  if (!input || typeof input !== 'object') {
    return { isValid: false, errors: ['Invalid request format'] };
  }
  
  // Query validation
  if (!input.query || typeof input.query !== 'string') {
    errors.push('Query is required and must be a string');
  } else if (input.query.length > TOKEN_LIMITS.MAX_QUERY_LENGTH) {
    errors.push(`Query too long (max ${TOKEN_LIMITS.MAX_QUERY_LENGTH} characters)`);
  } else if (input.query.trim().length < 3) {
    errors.push('Query too short (minimum 3 characters)');
  } else {
    // Check for suspicious content
    const suspiciousIssues = detectSuspiciousContent(input.query);
    errors.push(...suspiciousIssues);
  }
  
  // RAG ID validation
  if (!input.ragId || typeof input.ragId !== 'string') {
    errors.push('RAG ID is required');
  }
  
  // Target tokens validation
  if (input.targetTokens !== undefined) {
    const tokens = parseInt(input.targetTokens);
    if (isNaN(tokens) || tokens < TOKEN_LIMITS.MIN_TARGET_TOKENS || tokens > TOKEN_LIMITS.MAX_TARGET_TOKENS) {
      errors.push(`Target tokens must be between ${TOKEN_LIMITS.MIN_TARGET_TOKENS} and ${TOKEN_LIMITS.MAX_TARGET_TOKENS}`);
    }
  }
  
  // Sanitize input
  const sanitized = {
    ragId: input.ragId?.trim(),
    query: input.query?.trim().substring(0, TOKEN_LIMITS.MAX_QUERY_LENGTH),
    model: input.model?.trim(),
    complexity: input.complexity?.trim(),
    retrievalStrategy: input.retrievalStrategy?.trim(),
    enableVerification: Boolean(input.enableVerification),
    maxChunksPerPaper: Math.min(Math.max(parseInt(input.maxChunksPerPaper) || 3, 1), 10),
    targetTokens: Math.min(Math.max(parseInt(input.targetTokens) || TOKEN_LIMITS.DEFAULT_TARGET_TOKENS, TOKEN_LIMITS.MIN_TARGET_TOKENS), TOKEN_LIMITS.MAX_TARGET_TOKENS),
    similarityThreshold: Math.min(Math.max(parseFloat(input.similarityThreshold) || 0.3, 0.1), 1.0),
    vectorWeight: Math.min(Math.max(parseFloat(input.vectorWeight) || 0.7, 0.0), 1.0),
    textWeight: Math.min(Math.max(parseFloat(input.textWeight) || 0.3, 0.0), 1.0),
    outputStyle: input.outputStyle?.trim()
  };
  
  return { isValid: errors.length === 0, errors, sanitized };
}

interface QueryRequest {
  ragId: string; // Now a string database key instead of numeric ID
  query: string;
  model?: string;
  complexity?: string;
  retrievalStrategy?: string;
  enableVerification?: boolean;
  maxChunksPerPaper?: number;
  targetTokens?: number;
  similarityThreshold?: number;
  vectorWeight?: number;
  textWeight?: number;
  outputStyle?: string;
}

const AVAILABLE_MODELS = {
  "Qwen/Qwen3-235B-A22B-Instruct-2507": "Qwen/Qwen3-235B-A22B-Instruct-2507",
  "Qwen/Qwen3-Next-80B-A3B-Instruct": "Qwen/Qwen3-Next-80B-A3B-Instruct",
  "meta-llama/Llama-4-Maverick-17B-128E-Instruct-FP8": "meta-llama/Llama-4-Maverick-17B-128E-Instruct-FP8",
  "openai/gpt-oss-120b":"openai/gpt-oss-120b",
  "deepseek-ai/DeepSeek-V3.1": "deepseek-ai/DeepSeek-V3.1",
  "moonshotai/Kimi-K2-Instruct-0905": "moonshotai/Kimi-K2-Instruct-0905"
};

const COMPLEXITY_SETTINGS = {
  "simple": {
    instruction: "Provide a clear, concise overview that captures the key points with thorough referencing. If Narrative format, aim for 1-2 paragraphs."
  },
  "complex": {
    instruction: "Explore the topic comprehensively with detailed explanations, context, and thorough referencing. If Narrative format, aim for 2-5 paragraphs."
  },
  "interpretive": {
    instruction: "Provide an in-depth, interpretive analysis with extensive detail, broader implications, and thorough referencing. If Narrative format, aim for 3-10 paragraphs."
  }
};

// Function to preprocess and expand scientific queries
function preprocessQuery(query: string): string {
  // Scientific term expansions and synonyms
  const expansions: Record<string, string[]> = {
    "gene": ["gene", "genetic", "genomic", "allele", "locus"],
    "protein": ["protein", "polypeptide", "enzyme", "amino acid"],
    "cell": ["cell", "cellular", "cytoplasm", "membrane", "organelle"],
    "DNA": ["DNA", "deoxyribonucleic acid", "nucleic acid", "genome", "chromosome"],
    "RNA": ["RNA", "ribonucleic acid", "transcript", "mRNA", "transcription"],
    "cancer": ["cancer", "tumor", "neoplasm", "oncology", "carcinoma", "malignant"],
    "calcium": ["calcium", "Ca2+", "calcium ion", "calcium binding", "calmodulin"],
    "regulation": ["regulation", "regulatory", "control", "modulation", "expression"],
    "pathway": ["pathway", "signaling", "cascade", "network", "mechanism"],
    "binding": ["binding", "interaction", "affinity", "association", "complex"]
  };

  let expandedQuery = query.toLowerCase();
  
  // Add synonyms for key terms found in the query
  for (const [term, synonyms] of Object.entries(expansions)) {
    if (expandedQuery.includes(term.toLowerCase())) {
      // Add some synonyms to broaden the search
      const additionalTerms = synonyms.slice(1, 3).join(" "); // Add 2 synonyms max
      expandedQuery += ` ${additionalTerms}`;
    }
  }
  
  // Remove excessive repetition
  const words = expandedQuery.split(' ');
  const uniqueWords = [...new Set(words)];
  
  return uniqueWords.join(' ').substring(0, 500); // Limit length
}

// Function to get embeddings from DeepInfra
async function getEmbedding(text: string, model: string): Promise<number[]> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 600000); // 10 minutes timeout

  console.log(`[${new Date().toISOString()}] Getting embedding for text length: ${text.length} using model: ${model}`);

  try {
    const response = await fetch(`${DEEPINFRA_API_URL}/embeddings`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${DEEPINFRA_API_KEY}`,
      },
      body: JSON.stringify({
        model: model,
        input: text,
      }),
      signal: controller.signal,
      // @ts-ignore - undici specific options for Node.js fetch
      headersTimeout: 600000, // 10 minutes in milliseconds
      bodyTimeout: 600000, // 10 minutes in milliseconds
    });

    clearTimeout(timeoutId);
    
    console.log(`[${new Date().toISOString()}] Embedding API response: ${response.status}`);

    if (!response.ok) {
      throw new Error(`DeepInfra API error: ${response.statusText}`);
    }

    const data = await response.json();
    console.log(`[${new Date().toISOString()}] Received embedding with length: ${data.data[0].embedding.length}`);
    return data.data[0].embedding;
  } catch (error) {
    clearTimeout(timeoutId);
    throw error;
  }
}

// Function to extract cited source indices from LLM response
function extractCitedSources(response: string, sources: any[]): Set<number> {
  const citedIndices = new Set<number>();
  
  // Look for various citation patterns like [1], (Source 2), PMID:12345, etc.
  const patterns = [
    /\[(\d+)\]/g,                    // [1], [2], etc.
    /\(Source\s+(\d+)\)/gi,          // (Source 1), (source 2), etc.
    /Source\s+(\d+)/gi,              // Source 1, source 2, etc.
    /\(\s*(\d+)\s*\)/g,              // (1), (2), etc.
  ];
  
  for (const pattern of patterns) {
    let match;
    while ((match = pattern.exec(response)) !== null) {
      const index = parseInt(match[1]);
      if (index >= 1 && index <= sources.length) {
        citedIndices.add(index);
      }
    }
  }
  
  // Also look for PMID citations and map them to source indices
  const pmidPattern = /PMID:?\s*(\d+)/gi;
  let pmidMatch;
  while ((pmidMatch = pmidPattern.exec(response)) !== null) {
    const pmid = pmidMatch[1];
    sources.forEach((source, idx) => {
      const metadata = parseMetadata(source.metadata);
      if (metadata.pmid === pmid) {
        citedIndices.add(idx + 1); // Source indices are 1-based
      }
    });
  }
  
  console.log(`[DEBUG] Extracted citations: [${Array.from(citedIndices).sort().join(', ')}] from response`);
  return citedIndices;
}

// Function to trim chunks based on token limit while preserving paper diversity
function applyTokenLimit(results: any[], targetTokens: number, query: string): any[] {
  const contextSummary = `Research Context: Query: "${query}"\n\n`;
  const contextTokens = estimateTokens(contextSummary);
  const availableTokens = targetTokens - contextTokens - 500; // Reserve 500 tokens for LLM response
  
  if (availableTokens <= 0) {
    console.log(`[DEBUG] Target tokens ${targetTokens} too low, using minimum 1 chunk`);
    return results.slice(0, 1);
  }
  
  let totalTokens = 0;
  const selectedChunks: any[] = [];
  const seenPapers = new Set<string>();
  
  // First pass: select one chunk per paper until token limit
  for (const chunk of results) {
    const metadata = parseMetadata(chunk.metadata);
    const pmid = metadata.pmid || 'unknown';
    
    if (!seenPapers.has(pmid)) {
      const chunkTokens = estimateTokens(JSON.stringify({
        content: chunk.content,
        metadata: chunk.metadata
      }));
      
      if (totalTokens + chunkTokens <= availableTokens) {
        selectedChunks.push(chunk);
        seenPapers.add(pmid);
        totalTokens += chunkTokens;
      } else {
        break;
      }
    }
  }
  
  // Second pass: add remaining chunks if space allows
  for (const chunk of results) {
    if (selectedChunks.includes(chunk)) continue;
    
    const chunkTokens = estimateTokens(JSON.stringify({
      content: chunk.content,
      metadata: chunk.metadata
    }));
    
    if (totalTokens + chunkTokens <= availableTokens) {
      selectedChunks.push(chunk);
      totalTokens += chunkTokens;
    } else {
      break;
    }
  }
  
  console.log(`[DEBUG] Token optimization: ${totalTokens}/${availableTokens} tokens used`);
  return selectedChunks;
}

// Helper function to create BM25 query for pg_search
function createBM25Query(query: string): string {
  // Enhanced stop words including generic academic terms that rarely match
  const stopWords = new Set([
    'the', 'a', 'an', 'and', 'or', 'but', 'in', 'on', 'at', 'to', 'for', 'of', 'with', 'by', 'from', 'as', 'is', 'was', 'are', 'were',
    'explain', 'describe', 'discuss', 'analyze', 'examine', 'investigate', 'study', 'research', 'show', 'demonstrate',
    'known', 'unknown', 'potential', 'possible', 'likely', 'relevant', 'important', 'significant',
    'role', 'roles', 'function', 'functions', 'effect', 'effects', 'impact', 'influence',
    'mechanism', 'mechanisms', 'pathway', 'pathways', 'process', 'processes',
    'hypothesis', 'hypothesize', 'suggest', 'propose', 'indicate', 'reveal',
    'lines', 'line', 'approach', 'approaches', 'method', 'methods', 'technique', 'techniques'
  ]);
  
  // Scientific/domain terms that should be prioritized (never filtered out)
  const scientificTerms = new Set([
    'pin1', 'pin-1', 'cancer', 'tumor', 'protein', 'gene', 'cell', 'dna', 'rna', 'enzyme',
    'mutation', 'expression', 'regulation', 'signaling', 'pathway', 'inhibitor', 'activation',
    'apoptosis', 'proliferation', 'metastasis', 'oncogene', 'suppressor', 'kinase', 'phosphorylation'
  ]);
  
  const words = query.toLowerCase()
    .split(/\s+/)
    .filter(word => {
      // Keep scientific terms regardless of length or stop word status
      if (scientificTerms.has(word)) return true;
      // Filter out short words and stop words
      return word.length > 2 && !stopWords.has(word);
    })
    .slice(0, 8); // Reduce to 8 most important words for better performance
  
  // For BM25, we use simple space-separated terms (pg_search handles the logic)
  return words.join(' ');
}

// Simplified function to find similar embeddings - using exact same pattern as working test script
async function findSimilarEmbeddings(
  db: ReturnType<typeof createRagDbConnection>, // Database connection for specific RAG
  queryEmbedding: number[], 
  query: string, 
  originalQuery: string, // Add original query for BM25 text search
  complexity: string = "complex",
  strategy: string = "enhanced",
  maxChunksPerPaper: number = 2,
  targetTokens?: number,
  similarityThreshold?: number,
  vectorWeight: number = 0.7, 
  textWeight: number = 0.3 
) {
  const embeddingString = `[${queryEmbedding.join(',')}]`;
  
  // Dynamic chunk count: Use higher limit if targetTokens specified, otherwise use complexity-based limits
  const chunkCount = targetTokens 
    ? 50  // High limit when using token-based filtering (will be trimmed by applyTokenLimit)
    : {
        "direct": 5,      
        "complex": 8,     
        "interpretive": 15 
      }[complexity] || 8;
  
  console.log(`[DEBUG] Starting basic vector similarity query...`);
  console.log(`[DEBUG] Using weights: vector=${vectorWeight}, text=${textWeight}`);
  console.log(`[DEBUG] Chunk limit strategy: ${targetTokens ? `Token-based (${targetTokens} tokens, initial limit: ${chunkCount})` : `Complexity-based (${complexity}: ${chunkCount} chunks)`}`);
  
  // Create optimized query for better handling of long queries  
  const bm25QueryString = createBM25Query(originalQuery);
  console.log(`[DEBUG] Query terms: "${originalQuery}" -> BM25 query: "${bm25QueryString}"`);
  
  // Step 1: Hybrid search with vector similarity + pg_search BM25
  // Handle edge cases where weights are 0 or 1
  const similarityCalc = vectorWeight === 0 
    ? sql`LEAST(paradedb.score(${embeddings.id}) / 10.0, 1.0)`
    : textWeight === 0
    ? sql`1 - (${embeddings.embedding} <=> ${embeddingString}::vector)`
    : sql`${vectorWeight} * (1 - (${embeddings.embedding} <=> ${embeddingString}::vector)) + ${textWeight} * LEAST(paradedb.score(${embeddings.id}) / 10.0, 1.0)`;
  
  const results = await db
    .select({
      content: embeddings.content,
      metadata: embeddings.metadata,
      vectorScore: sql`1 - (${embeddings.embedding} <=> ${embeddingString}::vector)`,
      bm25Score: sql`LEAST(paradedb.score(${embeddings.id}) / 10.0, 1.0)`,
      similarity: similarityCalc,
    })
    .from(embeddings)
    .where(
      sql`${embeddings.content} @@@ ${bm25QueryString} 
        OR (${embeddings.embedding} <=> ${embeddingString}::vector) < 0.5`
    )
    .orderBy(sql`${similarityCalc} DESC`)
    .limit(chunkCount);
  
  console.log(`[DEBUG] Vector query completed, found ${results.length} results`);
  
  // Debug: Log raw scoring components for first few results
  if (results.length > 0) {
    console.log(`[DEBUG] ⭐ SCORING DEBUG - Raw scores for first 3 results:`);
    for (let i = 0; i < Math.min(3, results.length); i++) {
      const result = results[i];
      console.log(`  ⭐ [${i+1}] Vector: ${(result as any).vectorScore?.toFixed(4) || 'N/A'}, BM25: ${(result as any).bm25Score?.toFixed(6) || 'N/A'}, Combined: ${(result.similarity as any)?.toFixed(6) || 'N/A'}`);
    }
    console.log(`[DEBUG] ⭐ END SCORING DEBUG`);
  }
  
  // Apply token limit if specified
  if (targetTokens) {
    console.log(`[DEBUG] Applying token limit of ${targetTokens}...`);
    const trimmedResults = applyTokenLimit(results, targetTokens, query);
    console.log(`[DEBUG] Trimmed from ${results.length} to ${trimmedResults.length} chunks`);
    return trimmedResults;
  }
  
  return results;
}

// Function to verify response claims against sources
async function verifyResponse(
  response: string,
  sources: any[],
  model: string = "deepseek-ai/DeepSeek-V3.1"
): Promise<{ verifiedResponse: string, confidence: number }> {
  const verificationPrompt = `You are a scientific fact-checker. Analyze the following response and verify if each claim is supported by the provided sources.

RESPONSE TO VERIFY:
${response}

SOURCES:
${sources.map((source, i) => `Source ${i + 1} (PMID: ${parseMetadata(source.metadata).pmid}): ${source.content}`).join('\n\n')}

INSTRUCTIONS:
1. Identify each factual claim in the response
2. Check if each claim is supported by the sources
3. Mark unsupported claims with [UNVERIFIED]
4. Provide an overall confidence score (0-100%)
5. Return the response with verification markers and confidence score

FORMAT:
VERIFIED_RESPONSE: [Response with [UNVERIFIED] markers for unsupported claims]
CONFIDENCE: [0-100 percentage]`;

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 600000); // 10 minutes timeout for verification

  try {
    const verificationResponse = await fetch(`${DEEPINFRA_API_URL}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${DEEPINFRA_API_KEY}`,
      },
      body: JSON.stringify({
        model: model,
        messages: [{ role: "user", content: verificationPrompt }],
        max_tokens: 800,
        temperature: 0.1, // Low temperature for consistent verification
      }),
      signal: controller.signal,
      // @ts-ignore - undici specific options for Node.js fetch
      headersTimeout: 600000, // 10 minutes in milliseconds
      bodyTimeout: 600000, // 10 minutes in milliseconds
    });

    clearTimeout(timeoutId);

    if (!verificationResponse.ok) {
      return { verifiedResponse: response, confidence: 50 }; // Fallback if verification fails
    }

    const verificationData = await verificationResponse.json();
    const verificationResult = verificationData.choices[0].message.content;
    
    // Parse the verification result
    const verifiedMatch = verificationResult.match(/VERIFIED_RESPONSE:\s*([\s\S]*?)CONFIDENCE:/);
    const confidenceMatch = verificationResult.match(/CONFIDENCE:\s*(\d+)/);
    
    const verifiedResponse = verifiedMatch ? verifiedMatch[1].trim() : response;
    const confidence = confidenceMatch ? parseInt(confidenceMatch[1]) : 50;
    
    return { verifiedResponse, confidence };
  } catch (error) {
    clearTimeout(timeoutId);
    console.error("Verification error:", error);
    return { verifiedResponse: response, confidence: 50 };
  }
}

// Generate structured analysis prompt
function generateStructuredPrompt(query: string, context: string, ragName: string, complexityConfig: any): string {
  return `You are a specialized AI assistant in biological research, operating at Professor level.

QUERY: ${query}

CONTEXT from ${ragName} research papers:
${context}

PROVIDE A STRUCTURED RESPONSE:

1. EXECUTIVE SUMMARY (2-3 sentences)
2. SCIENTIFIC ANALYSIS (mechanisms, pathways, experimental details)
3. EVIDENCE EVALUATION (cite as "Finding (2024, PMID:12345678)")
4. LIMITATIONS & GAPS
5. BIOLOGICAL CONTEXT

${complexityConfig.instruction}`;
}

// Generate narrative prompt
function generateNarrativePrompt(query: string, context: string, ragName: string, complexityConfig: any): string {
  return `You are an expert scientific writer, operating at Professor level. Write a manuscript-style narrative response.

QUERY: ${query}

CONTEXT from ${ragName} research papers:
${context}

Write a flowing narrative that:
- Establishes biological significance
- Synthesizes current understanding from literature
- Integrates citations naturally: "Studies show X (2024, PMID:12345678)"
- Discusses mechanisms and implications
- Uses scholarly tone with smooth transitions
- Avoids bullet points - write in paragraph form

${complexityConfig.instruction}`;
}

// Function to generate response using DeepInfra
async function generateResponse(
  query: string, 
  context: string, 
  ragName: string, 
  model: string = "deepseek-ai/DeepSeek-V3.1",
  complexity: string = "complex",
  outputStyle: string = "narrative"
): Promise<string> {
  console.log(`[${new Date().toISOString()}] Generating response with model: ${model}, complexity: ${complexity}, outputStyle: ${outputStyle}`);
  
  const complexityConfig = COMPLEXITY_SETTINGS[complexity] || COMPLEXITY_SETTINGS.complex;
  
  const prompt = outputStyle === "narrative" 
    ? generateNarrativePrompt(query, context, ragName, complexityConfig)
    : generateStructuredPrompt(query, context, ragName, complexityConfig);
  
  console.log(`[${new Date().toISOString()}] Using ${outputStyle === "narrative" ? "narrative" : "structured"} prompt template`);

  // Debug: Log the full prompt being sent to LLM
  console.log(`\n━━━━━━ FULL LLM PROMPT ━━━━━━`);
  console.log(prompt);
  console.log(`━━━━━━ END LLM PROMPT ━━━━━━\n`);

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 600000); // 10 minutes timeout

  try {
    const response = await fetch(`${DEEPINFRA_API_URL}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${DEEPINFRA_API_KEY}`,
      },
      body: JSON.stringify({
        model: model,
        messages: [
          {
            role: "user",
            content: prompt,
          },
        ],
        max_tokens: complexityConfig.maxTokens,
        temperature: 0.7,
      }),
      signal: controller.signal,
      // @ts-ignore - undici specific options for Node.js fetch
      headersTimeout: 600000, // 10 minutes in milliseconds
      bodyTimeout: 600000, // 10 minutes in milliseconds
    });

    clearTimeout(timeoutId);
    
    console.log(`[${new Date().toISOString()}] Chat completion API response: ${response.status}`);

    if (!response.ok) {
      throw new Error(`DeepInfra API error: ${response.statusText}`);
    }

    const data = await response.json();
    console.log(`[${new Date().toISOString()}] Generated response length: ${data.choices[0].message.content.length}`);
    return data.choices[0].message.content;
  } catch (error) {
    clearTimeout(timeoutId);
    throw error;
  }
}

export const handler: Handler = async (event, context) => {
  const headers = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
  };

  if (event.httpMethod === "OPTIONS") {
    return { statusCode: 200, headers, body: "" };
  }

  if (event.httpMethod !== "POST") {
    return {
      statusCode: 405,
      headers,
      body: JSON.stringify({ error: "Method not allowed" }),
    };
  }

  // Get client IP for rate limiting (outside try block for cleanup)
  const clientIP = event.headers['x-forwarded-for']?.split(',')[0] || 
                   event.headers['x-real-ip'] || 
                   event.requestContext?.identity?.sourceIp || 
                   'unknown';

  try {
    const startTime = Date.now();
    console.log(`[${new Date().toISOString()}] Query handler started`);
    
    // Check rate limit
    const rateLimitCheck = checkRateLimit(clientIP);
    if (!rateLimitCheck.allowed) {
      console.log(`[${new Date().toISOString()}] Rate limit exceeded for IP: ${clientIP}`);
      return {
        statusCode: 429,
        headers: {
          "Content-Type": "application/json",
          "Access-Control-Allow-Origin": "*",
          "Access-Control-Allow-Headers": "Content-Type",
          "Access-Control-Allow-Methods": "POST, OPTIONS",
          "Retry-After": "60"
        },
        body: JSON.stringify({
          error: "Rate limit exceeded",
          message: rateLimitCheck.reason
        })
      };
    }
    
    // Parse and validate input
    const rawInput = JSON.parse(event.body || "{}");
    const validation = validateAndSanitizeInput(rawInput);
    
    if (!validation.isValid) {
      console.log(`[${new Date().toISOString()}] Validation failed:`, validation.errors);
      return {
        statusCode: 400,
        headers: {
          "Content-Type": "application/json",
          "Access-Control-Allow-Origin": "*",
          "Access-Control-Allow-Headers": "Content-Type",
          "Access-Control-Allow-Methods": "POST, OPTIONS"
        },
        body: JSON.stringify({
          error: "Invalid input",
          details: validation.errors
        })
      };
    }

    const { ragId, query, model, complexity, retrievalStrategy, enableVerification, maxChunksPerPaper, targetTokens, similarityThreshold, vectorWeight, textWeight, outputStyle } = validation.sanitized!;

    console.log(`[${new Date().toISOString()}] Request params: ragId=${ragId}, query length=${query?.length || 0}, model=${model}, complexity=${complexity}, strategy=${retrievalStrategy}, verification=${enableVerification}, maxChunksPerPaper=${maxChunksPerPaper}, targetTokens=${targetTokens}, similarityThreshold=${similarityThreshold}, vectorWeight=${vectorWeight}, textWeight=${textWeight}, outputStyle=${outputStyle}`);

    // Input validation already completed above, use sanitized values directly
    const selectedModel = model && AVAILABLE_MODELS[model] ? AVAILABLE_MODELS[model] : "deepseek-ai/DeepSeek-V3.1";
    const selectedComplexity = complexity && COMPLEXITY_SETTINGS[complexity] ? complexity : "complex";
    const selectedStrategy = retrievalStrategy || "enhanced";
    
    console.log(`[${new Date().toISOString()}] Using: ${selectedModel}, ${selectedComplexity}, ${selectedStrategy}, verification=${enableVerification}, chunksPerPaper=${maxChunksPerPaper}, targetTokens=${targetTokens}, similarityThreshold=${similarityThreshold}, vectorWeight=${vectorWeight}, textWeight=${textWeight}`);

    // Validate RAG exists and create database connection
    if (!RAG_METADATA[ragId as RagId]) {
      return {
        statusCode: 404,
        headers,
        body: JSON.stringify({ error: "RAG not found" }),
      };
    }
    
    // Get RAG configuration for dynamic model selection
    let ragConfig;
    try {
      ragConfig = getRagConfig(ragId);
    } catch (error) {
      console.error(`[${new Date().toISOString()}] RAG configuration error: ${error.message}`);
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({ error: `Invalid RAG configuration: ${error.message}` }),
      };
    }

    const ragMetadata = RAG_METADATA[ragId as RagId];
    const ragDb = createRagDbConnection(ragId);

    console.log(`[${new Date().toISOString()}] Using RAG: ${ragId} (${ragConfig.dimensions}D) with model: ${ragConfig.queryModel}`);

    // Preprocess and expand the query for better matching
    const expandedQuery = preprocessQuery(query);
    console.log(`[${new Date().toISOString()}] Expanded query: "${expandedQuery.substring(0, 100)}..."`);

    // Get embedding for the expanded query using dynamic model
    console.log(`[${new Date().toISOString()}] Getting query embedding...`);
    const queryEmbedding = await getEmbedding(expandedQuery, ragConfig.queryModel);

    // Find similar embeddings using selected strategy
    console.log(`[${new Date().toISOString()}] Searching for similar embeddings...`);
    const similarEmbeddings = await findSimilarEmbeddings(ragDb, queryEmbedding, expandedQuery, query, selectedComplexity, selectedStrategy, maxChunksPerPaper, targetTokens, similarityThreshold, vectorWeight, textWeight);
    console.log(`[${new Date().toISOString()}] Found ${similarEmbeddings.length} similar embeddings`);

    // Get ALL chunks for display panel using same simple query pattern
    console.log(`[${new Date().toISOString()}] Getting all chunks above similarity threshold...`);
    const embeddingString = `[${queryEmbedding.join(',')}]`;
    
    // Create optimized BM25 query for the original query
    const bm25QueryString = createBM25Query(query);
    
    // Handle edge cases where weights are 0 or 1
    const allChunksSimilarityCalc = vectorWeight === 0 
      ? sql`LEAST(paradedb.score(${embeddings.id}) / 10.0, 1.0)`
      : textWeight === 0
      ? sql`1 - (${embeddings.embedding} <=> ${embeddingString}::vector)`
      : sql`${vectorWeight} * (1 - (${embeddings.embedding} <=> ${embeddingString}::vector)) + ${textWeight} * LEAST(paradedb.score(${embeddings.id}) / 10.0, 1.0)`;
    
    const allMatchingChunks = await ragDb
      .select({
        id: embeddings.id,
        content: embeddings.content,
        metadata: embeddings.metadata,
        similarity: allChunksSimilarityCalc,
      })
      .from(embeddings)
      .where(
        sql`${embeddings.content} @@@ ${bm25QueryString} 
          OR (${embeddings.embedding} <=> ${embeddingString}::vector) < 0.9`
      )
      .orderBy(sql`${allChunksSimilarityCalc} DESC`)
      .limit(100);

    // Filter by similarity threshold - convert to 0-1 scale
    const matchingChunks = allMatchingChunks.filter(chunk => (chunk.similarity as any) > similarityThreshold);
    console.log(`[${new Date().toISOString()}] Found ${matchingChunks.length} chunks above threshold ${similarityThreshold}`);

    if (similarEmbeddings.length === 0) {
      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({
          response: "I couldn't find any relevant information in the selected RAG dataset to answer your question.",
          sources: [],
          allMatchingChunks: matchingChunks.map((chunk, index) => ({
            index: index + 1,
            content: chunk.content,
            id: chunk.id,
            similarity: chunk.similarity,
            metadata: chunk.metadata,
            usedInContext: false, // No chunks used in context when no similar embeddings found
          })),
        }),
      };
    }

    // Prepare optimized context with enhanced formatting
    const maxContextTokens = {
      "direct": 3000,
      "complex": 5000, 
      "interpretive": 8000
    }[selectedComplexity] || 5000;
    
    // Group chunks by PMID to respect maxChunksPerPaper setting
    const chunksByPaper: Record<string, any[]> = {};
    for (const emb of similarEmbeddings) {
      const metadata = parseMetadata(emb.metadata);
      const pmid = metadata.pmid || 'no-pmid';
      if (!chunksByPaper[pmid]) chunksByPaper[pmid] = [];
      chunksByPaper[pmid].push(emb);
    }
    
    // Limit chunks per paper and flatten back
    const processedChunks: any[] = [];
    for (const [pmid, chunks] of Object.entries(chunksByPaper)) {
      const limitedChunks = chunks.slice(0, maxChunksPerPaper);
      processedChunks.push(...limitedChunks);
    }
    
    let context = '';
    let currentTokens = 0;
    const journalCounts: Record<string, number> = {};
    const authorCounts: Record<string, number> = {};
    let yearRange = { min: 2024, max: 2000 };
    
    let sourceIndex = 1;
    for (let i = 0; i < processedChunks.length; i++) {
      const emb = processedChunks[i];
      const metadata = parseMetadata(emb.metadata);
      const pmid = metadata.pmid;
      
      const year = parseInt(metadata.year) || 2020;
      const journal = metadata.journal || 'Unknown Journal';
      const firstAuthor = metadata.authors?.split(',')[0]?.trim() || 'Unknown Author';
      
      // Track statistics
      journalCounts[journal] = (journalCounts[journal] || 0) + 1;
      authorCounts[firstAuthor] = (authorCounts[firstAuthor] || 0) + 1;
      yearRange.min = Math.min(yearRange.min, year);
      yearRange.max = Math.max(yearRange.max, year);
      
      // Optimized compact formatting
      const similarity = ((emb.similarity as any) * 100).toFixed(1);
      const shortAuthors = shortenAuthors(metadata.authors);
      const shortTitle = (metadata.title || 'Unknown Title').length > 80 
        ? (metadata.title || 'Unknown Title').substring(0, 80) + '...' 
        : (metadata.title || 'Unknown Title');
      
      const chunkHeader = `[${sourceIndex}] ${shortTitle} (${journal.split(' ')[0]}, ${year}) - ${shortAuthors} - PMID:${pmid || 'N/A'} [${similarity}%]`;

      const chunkContent = emb.content.trim();
      const chunkText = `${chunkHeader}\n${chunkContent}\n`;
      
      // Rough token estimation (4 characters ≈ 1 token)
      const chunkTokens = Math.ceil(chunkText.length / 4);
      
      if (currentTokens + chunkTokens > maxContextTokens && context.length > 0) {
        // Truncate if we're over limit and have at least one chunk
        break;
      }
      
      context += chunkText + '\n';
      currentTokens += chunkTokens;
      sourceIndex++;
    }
    
    // Enhanced context summary with research landscape overview
    const topJournals = Object.entries(journalCounts)
      .sort(([,a], [,b]) => b - a)
      .slice(0, 3)
      .map(([journal, count]) => `${journal} (${count} sources)`)
      .join(', ');
    
    const contextSummary = `Research Context: ${sourceIndex - 1} sources (${yearRange.min}-${yearRange.max}) - Query: "${query}"

`;
    
    const finalContext = contextSummary + context;

    // Log the complete context being sent to the LLM for debugging
    console.log('\n🧠 LLM CONTEXT DEBUG:');
    console.log('━'.repeat(80));
    console.log(`📝 Query: "${query}"`);
    console.log(`🤖 Model: ${selectedModel}`);
    console.log(`⚙️  Complexity: ${selectedComplexity}`);
    console.log(`📊 Context token estimate: ~${Math.ceil(finalContext.length / 4)}`);
    console.log(`📄 Context length (chars): ${finalContext.length}`);
    console.log('\n📋 FULL CONTEXT SENT TO LLM:');
    console.log('─'.repeat(40));
    console.log(finalContext);
    console.log('─'.repeat(40));
    console.log('🧠 END LLM CONTEXT DEBUG\n');

    // Generate response with selected output style
    const selectedOutputStyle = outputStyle === "narrative" ? "narrative" : "structured";
    const initialResponse = await generateResponse(query, finalContext, ragMetadata.name, selectedModel, selectedComplexity, selectedOutputStyle);

    let finalResponse = initialResponse;
    let confidence = 85; // Default confidence without verification

    // Apply verification if enabled
    if (enableVerification) {
      const verificationResult = await verifyResponse(initialResponse, similarEmbeddings, selectedModel);
      finalResponse = verificationResult.verifiedResponse;
      confidence = verificationResult.confidence;
    }

    // Extract citations from the final response
    const citedSources = extractCitedSources(finalResponse, similarEmbeddings);

    // Get the complete prompt that was sent to LLM for debugging
    const debugPrompt = outputStyle === "narrative" 
      ? generateNarrativePrompt(query, finalContext, ragMetadata.name, COMPLEXITY_SETTINGS[selectedComplexity])
      : generateStructuredPrompt(query, finalContext, ragMetadata.name, COMPLEXITY_SETTINGS[selectedComplexity]);

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        response: finalResponse,
        confidence: confidence,
        verified: enableVerification,
        debugPrompt: debugPrompt, // Include the complete prompt for debugging
        debugScores: similarEmbeddings.slice(0, 3).map((emb, index) => ({ // Include raw scores for debugging
          index: index + 1,
          vectorScore: (emb as any).vectorScore,
          bm25Score: (emb as any).bm25Score,
          combinedScore: emb.similarity,
          weights: { vector: vectorWeight, text: textWeight }
        })),
        sources: similarEmbeddings.map((emb, index) => ({
          index: index + 1,
          content: emb.content,
          similarity: emb.similarity,
          metadata: emb.metadata, // Include the metadata string directly
        })),
        allMatchingChunks: matchingChunks.map((chunk, index) => ({
          index: index + 1,
          content: chunk.content,
          id: chunk.id,
          similarity: chunk.similarity,
          metadata: chunk.metadata,
          usedInContext: similarEmbeddings.some(emb => 
            emb.content === chunk.content
          ),
          citedInResponse: (() => {
            // Find the index of this chunk in similarEmbeddings (if it exists)
            const contextIndex = similarEmbeddings.findIndex(emb => 
              emb.content === chunk.content
            );
            // If chunk is in context, check if its index (1-based) is cited
            return contextIndex >= 0 && citedSources.has(contextIndex + 1);
          })()
        })),
      }),
    };
  } catch (error) {
    console.error("Error processing query:", error);
    
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ error: "Failed to process query" }),
    };
  } finally {
    // Always release the request slot when done (regardless of success or error)
    releaseRequest(clientIP);
  }
};