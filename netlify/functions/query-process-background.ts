import type { BackgroundHandler } from "@netlify/functions";
import { createRagDbConnection, RAG_METADATA, getRagConfig, type RagId } from "../../src/lib/db/separate-db";
import { embeddings } from "../../src/lib/db/separate-schema";
import { sql } from "drizzle-orm";
import { updateJobProgress, storeJobResults, markJobFailed } from "../../src/lib/db/jobs";

// DeepInfra API configuration
const DEEPINFRA_API_URL = "https://api.deepinfra.com/v1/openai";
const DEEPINFRA_API_KEY = process.env.DEEPINFRA_API_KEY;
// EMBEDDING_MODEL is now dynamic based on RAG selection

const AVAILABLE_MODELS = {
  "Qwen/Qwen3-235B-A22B-Instruct-2507": "Qwen/Qwen3-235B-A22B-Instruct-2507",
  "Qwen/Qwen3-Next-80B-A3B-Instruct": "Qwen/Qwen3-Next-80B-A3B-Instruct",
  "meta-llama/Llama-4-Maverick-17B-128E-Instruct-FP8": "meta-llama/Llama-4-Maverick-17B-128E-Instruct-FP8",
  "openai/gpt-oss-120b": "openai/gpt-oss-120b",
  "deepseek-ai/DeepSeek-V3.1": "deepseek-ai/DeepSeek-V3.1",
  "moonshotai/Kimi-K2-Instruct-0905": "moonshotai/Kimi-K2-Instruct-0905"
};

const COMPLEXITY_SETTINGS = {
  "simple": {
    instruction: "Provide a clear, concise overview that captures the key points with thorough referencing. If Narrative format, aim for 1-2 paragraphs.",
    maxTokens: 800
  },
  "complex": {
    instruction: "Explore the topic comprehensively with detailed explanations, context, and thorough referencing. If Narrative format, aim for 2-5 paragraphs.",
    maxTokens: 1500
  },
  "interpretive": {
    instruction: "Provide an in-depth, interpretive analysis with extensive detail, broader implications, and thorough referencing. If Narrative format, aim for 3-10 paragraphs.",
    maxTokens: 2500
  }
};

// Helper functions (copied from query.ts)
function parseMetadata(metadata: any): any {
  if (!metadata) return {};
  if (typeof metadata === 'object') return metadata;
  if (typeof metadata === 'string') {
    try {
      return JSON.parse(metadata);
    } catch {
      return {};
    }
  }
  return {};
}

function shortenAuthors(authors: string | undefined): string {
  if (!authors) return 'N/A';
  const authorList = authors.split(',').map(a => a.trim());
  if (authorList.length === 1) return authorList[0].split(' ').pop() + ' ' + authorList[0].split(' ')[0].charAt(0);
  if (authorList.length <= 3) return authorList.map(a => a.split(' ').pop()).join(', ');
  return authorList[0].split(' ').pop() + ' et al.';
}

function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

function preprocessQuery(query: string): string {
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

  for (const [term, synonyms] of Object.entries(expansions)) {
    if (expandedQuery.includes(term.toLowerCase())) {
      const additionalTerms = synonyms.slice(1, 3).join(" ");
      expandedQuery += ` ${additionalTerms}`;
    }
  }

  const words = expandedQuery.split(' ');
  const uniqueWords = [...new Set(words)];

  return uniqueWords.join(' ').substring(0, 500);
}

function createBM25Query(query: string): string {
  const stopWords = new Set([
    'the', 'a', 'an', 'and', 'or', 'but', 'in', 'on', 'at', 'to', 'for', 'of', 'with', 'by', 'from', 'as', 'is', 'was', 'are', 'were',
    'explain', 'describe', 'discuss', 'analyze', 'examine', 'investigate', 'study', 'research', 'show', 'demonstrate',
    'known', 'unknown', 'potential', 'possible', 'likely', 'relevant', 'important', 'significant'
  ]);

  const scientificTerms = new Set([
    'pin1', 'pin-1', 'cancer', 'tumor', 'protein', 'gene', 'cell', 'dna', 'rna', 'enzyme',
    'mutation', 'expression', 'regulation', 'signaling', 'pathway', 'inhibitor', 'activation'
  ]);

  const words = query.toLowerCase()
    // Remove apostrophes and other special characters that could break ParadeDB parsing
    .replace(/['"''""]/g, '')
    .replace(/[^\w\s-]/g, ' ')
    .split(/\s+/)
    .filter(word => {
      // Clean the word of any remaining special characters
      const cleanWord = word.replace(/[^\w-]/g, '');
      if (scientificTerms.has(cleanWord)) return true;
      return cleanWord.length > 2 && !stopWords.has(cleanWord);
    })
    .slice(0, 8);

  return words.join(' ');
}

function applyTokenLimit(results: any[], targetTokens: number, query: string): any[] {
  const contextSummary = `Research Context: Query: "${query}"\n\n`;
  const contextTokens = estimateTokens(contextSummary);
  const availableTokens = targetTokens - contextTokens - 500;

  if (availableTokens <= 0) {
    return results.slice(0, 1);
  }

  let totalTokens = 0;
  const selectedChunks: any[] = [];
  const seenPapers = new Set<string>();

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

  return selectedChunks;
}

async function getEmbedding(text: string, model: string): Promise<number[]> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 600000); // 10 minutes timeout for background function

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

    if (!response.ok) {
      throw new Error(`DeepInfra API error: ${response.statusText}`);
    }

    const data = await response.json();
    return data.data[0].embedding;
  } catch (error) {
    clearTimeout(timeoutId);
    throw error;
  }
}

async function findSimilarEmbeddings(
  db: ReturnType<typeof createRagDbConnection>,
  queryEmbedding: number[],
  query: string,
  originalQuery: string,
  complexity: string = "complex",
  strategy: string = "enhanced",
  maxChunksPerPaper: number = 2,
  targetTokens?: number,
  similarityThreshold?: number,
  vectorWeight: number = 0.7,
  textWeight: number = 0.3
) {
  const embeddingString = `[${queryEmbedding.join(',')}]`;

  const chunkCount = targetTokens ? 50 : {
    "simple": 5,
    "complex": 8,
    "interpretive": 15
  }[complexity] || 8;

  const bm25QueryString = createBM25Query(originalQuery);

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

  if (targetTokens) {
    const trimmedResults = applyTokenLimit(results, targetTokens, query);
    return trimmedResults;
  }

  return results;
}

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

async function generateResponse(
  query: string,
  context: string,
  ragName: string,
  model: string = "deepseek-ai/DeepSeek-V3.1",
  complexity: string = "complex",
  outputStyle: string = "narrative"
): Promise<string> {
  const complexityConfig = COMPLEXITY_SETTINGS[complexity] || COMPLEXITY_SETTINGS.complex;

  const prompt = outputStyle === "narrative"
    ? generateNarrativePrompt(query, context, ragName, complexityConfig)
    : generateStructuredPrompt(query, context, ragName, complexityConfig);

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 600000); // 10 minutes timeout for background function

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

    if (!response.ok) {
      throw new Error(`DeepInfra API error: ${response.statusText}`);
    }

    const data = await response.json();
    return data.choices[0].message.content;
  } catch (error) {
    clearTimeout(timeoutId);
    throw error;
  }
}

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
  const timeoutId = setTimeout(() => controller.abort(), 600000); // 10 minutes for verification

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
        temperature: 0.1,
      }),
      signal: controller.signal,
      // @ts-ignore - undici specific options for Node.js fetch
      headersTimeout: 600000, // 10 minutes in milliseconds
      bodyTimeout: 600000, // 10 minutes in milliseconds
    });

    clearTimeout(timeoutId);

    if (!verificationResponse.ok) {
      return { verifiedResponse: response, confidence: 50 };
    }

    const verificationData = await verificationResponse.json();
    const verificationResult = verificationData.choices[0].message.content;

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

function extractCitedSources(response: string, sources: any[]): Set<number> {
  const citedIndices = new Set<number>();

  const patterns = [
    /\[(\d+)\]/g,
    /\(Source\s+(\d+)\)/gi,
    /Source\s+(\d+)/gi,
    /\(\s*(\d+)\s*\)/g,
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

  const pmidPattern = /PMID:?\s*(\d+)/gi;
  let pmidMatch;
  while ((pmidMatch = pmidPattern.exec(response)) !== null) {
    const pmid = pmidMatch[1];
    sources.forEach((source, idx) => {
      const metadata = parseMetadata(source.metadata);
      if (metadata.pmid === pmid) {
        citedIndices.add(idx + 1);
      }
    });
  }

  return citedIndices;
}

export const handler: BackgroundHandler = async (event) => {
  const { jobId, ragId, query, model, complexity, retrievalStrategy, enableVerification, maxChunksPerPaper, targetTokens, similarityThreshold, vectorWeight, textWeight, outputStyle } = JSON.parse(event.body || "{}");

  const logPrefix = `[BACKGROUND-${jobId?.substring(0, 8)}]`;
  console.log(`[${new Date().toISOString()}] ${logPrefix} 🚀 Background processing started for job: ${jobId}`);
  console.log(`[${new Date().toISOString()}] ${logPrefix} 📊 Query: "${query?.substring(0, 100)}..."`);
  console.log(`[${new Date().toISOString()}] ${logPrefix} 🎯 RAG: ${ragId}, Model: ${model}`);

  // Debug environment variables
  console.log(`[${new Date().toISOString()}] ${logPrefix} 🔍 Checking environment variables...`);
  console.log(`[${new Date().toISOString()}] ${logPrefix} 📊 JOBS_DATABASE_URL present: ${!!process.env.JOBS_DATABASE_URL}`);
  console.log(`[${new Date().toISOString()}] ${logPrefix} 📊 DATABASE_URL_BASE present: ${!!process.env.DATABASE_URL_BASE}`);
  console.log(`[${new Date().toISOString()}] ${logPrefix} 📊 DEEPINFRA_API_KEY present: ${!!process.env.DEEPINFRA_API_KEY}`);

  // Test database connection first
  console.log(`[${new Date().toISOString()}] ${logPrefix} 🧪 Testing jobs database connection...`);
  try {
    const { getQueryJob } = await import('../../src/lib/db/jobs');
    const testJob = await getQueryJob(jobId);
    console.log(`[${new Date().toISOString()}] ${logPrefix} ✅ Jobs DB connection successful, job exists: ${!!testJob}`);
  } catch (connError) {
    console.error(`[${new Date().toISOString()}] ${logPrefix} ❌ Jobs DB connection failed:`, connError);
    throw new Error(`Database connection failed: ${connError instanceof Error ? connError.message : String(connError)}`);
  }

  try {
    // Update job status to processing
    console.log(`[${new Date().toISOString()}] ${logPrefix} 📝 Updating job status to processing...`);
    console.log(`[${new Date().toISOString()}] ${logPrefix} 📝 Job ID: ${jobId}`);
    console.log(`[${new Date().toISOString()}] ${logPrefix} 📝 Target status: processing`);

    try {
      console.log(`[${new Date().toISOString()}] ${logPrefix} 🔄 About to call updateJobProgress...`);
      const updateResult = await updateJobProgress(jobId, "processing", "Initializing query processing...");
      console.log(`[${new Date().toISOString()}] ${logPrefix} ✅ updateJobProgress returned:`, updateResult);
      console.log(`[${new Date().toISOString()}] ${logPrefix} ✅ Job status updated successfully`);
    } catch (dbError) {
      console.error(`[${new Date().toISOString()}] ${logPrefix} ❌ Database update failed:`, dbError);
      console.error(`[${new Date().toISOString()}] ${logPrefix} ❌ DB Error details:`, {
        name: dbError instanceof Error ? dbError.name : 'Unknown',
        message: dbError instanceof Error ? dbError.message : String(dbError),
        stack: dbError instanceof Error ? dbError.stack : 'No stack',
        code: (dbError as any)?.code,
        errno: (dbError as any)?.errno,
        sqlState: (dbError as any)?.sqlState
      });

      // Try to get more details about the database connection
      console.log(`[${new Date().toISOString()}] ${logPrefix} 🔍 Checking database connection details...`);
      try {
        const { createJobsConnection } = await import('../../src/lib/db/jobs');
        const db = createJobsConnection();
        console.log(`[${new Date().toISOString()}] ${logPrefix} 📊 Jobs DB instance created successfully`);

        // Try a simple query to test connection
        const testQuery = await db.execute(sql`SELECT 1 as test`);
        console.log(`[${new Date().toISOString()}] ${logPrefix} ✅ Test query successful:`, testQuery);
      } catch (testError) {
        console.error(`[${new Date().toISOString()}] ${logPrefix} ❌ Test query failed:`, testError);
      }

      throw dbError; // Re-throw to trigger main catch block
    }

    // Validate RAG exists
    console.log(`[${new Date().toISOString()}] ${logPrefix} 🔍 Validating RAG exists: ${ragId}`);
    if (!RAG_METADATA[ragId as RagId]) {
      console.error(`[${new Date().toISOString()}] ${logPrefix} ❌ RAG not found: ${ragId}`);
      throw new Error("RAG not found");
    }

    // Get RAG configuration for dynamic model selection
    let ragConfig;
    try {
      ragConfig = getRagConfig(ragId);
    } catch (error) {
      console.error(`[${new Date().toISOString()}] ${logPrefix} ❌ RAG configuration error: ${error.message}`);
      throw new Error(`Invalid RAG configuration: ${error.message}`);
    }

    const ragMetadata = RAG_METADATA[ragId as RagId];
    console.log(`[${new Date().toISOString()}] ${logPrefix} ✅ RAG found: ${ragMetadata.name} (${ragConfig.dimensions}D) with model: ${ragConfig.queryModel}`);

    console.log(`[${new Date().toISOString()}] ${logPrefix} 🔌 Creating database connection...`);
    const ragDb = createRagDbConnection(ragId);

    // Select model and complexity
    const selectedModel = model && AVAILABLE_MODELS[model] ? AVAILABLE_MODELS[model] : "deepseek-ai/DeepSeek-V3.1";
    const selectedComplexity = complexity && COMPLEXITY_SETTINGS[complexity] ? complexity : "complex";
    const selectedStrategy = retrievalStrategy || "enhanced";

    // Preprocess query
    await updateJobProgress(jobId, "processing", "Preparing query for processing...");
    const expandedQuery = preprocessQuery(query);
    console.log(`[${new Date().toISOString()}] Expanded query: "${expandedQuery.substring(0, 100)}..."`);

    // Get embedding using dynamic model
    await updateJobProgress(jobId, "processing", "Generating query embeddings...");
    console.log(`[${new Date().toISOString()}] Getting query embedding using model: ${ragConfig.queryModel}...`);
    const queryEmbedding = await getEmbedding(expandedQuery, ragConfig.queryModel);

    // Find similar embeddings
    await updateJobProgress(jobId, "processing", "Searching knowledge base...");
    console.log(`[${new Date().toISOString()}] Searching for similar embeddings...`);
    const similarEmbeddings = await findSimilarEmbeddings(
      ragDb, queryEmbedding, expandedQuery, query, selectedComplexity,
      selectedStrategy, maxChunksPerPaper, targetTokens, similarityThreshold,
      vectorWeight, textWeight
    );
    console.log(`[${new Date().toISOString()}] Found ${similarEmbeddings.length} similar embeddings`);

    // Get all matching chunks for display
    await updateJobProgress(jobId, "processing", "Retrieving all matching content...");
    const embeddingString = `[${queryEmbedding.join(',')}]`;
    const bm25QueryString = createBM25Query(query);

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

    const matchingChunks = allMatchingChunks.filter(chunk => (chunk.similarity as any) > similarityThreshold);
    console.log(`[${new Date().toISOString()}] Found ${matchingChunks.length} chunks above threshold ${similarityThreshold}`);

    if (similarEmbeddings.length === 0) {
      await storeJobResults(jobId, {
        response: "I couldn't find any relevant information in the selected RAG dataset to answer your question.",
        sources: [],
        allMatchingChunks: matchingChunks.map((chunk, index) => ({
          index: index + 1,
          content: chunk.content,
          id: chunk.id,
          similarity: chunk.similarity,
          metadata: chunk.metadata,
          usedInContext: false,
        })),
      });
      return;
    }

    // Prepare context
    await updateJobProgress(jobId, "processing", "Preparing context for LLM...");
    const maxContextTokens = {
      "simple": 3000,
      "complex": 5000,
      "interpretive": 8000
    }[selectedComplexity] || 5000;

    const chunksByPaper: Record<string, any[]> = {};
    for (const emb of similarEmbeddings) {
      const metadata = parseMetadata(emb.metadata);
      const pmid = metadata.pmid || 'no-pmid';
      if (!chunksByPaper[pmid]) chunksByPaper[pmid] = [];
      chunksByPaper[pmid].push(emb);
    }

    const processedChunks: any[] = [];
    for (const [pmid, chunks] of Object.entries(chunksByPaper)) {
      const limitedChunks = chunks.slice(0, maxChunksPerPaper);
      processedChunks.push(...limitedChunks);
    }

    let context = '';
    let currentTokens = 0;
    const journalCounts: Record<string, number> = {};
    let yearRange = { min: 2024, max: 2000 };

    let sourceIndex = 1;
    for (let i = 0; i < processedChunks.length; i++) {
      const emb = processedChunks[i];
      const metadata = parseMetadata(emb.metadata);
      const pmid = metadata.pmid;

      const year = parseInt(metadata.year) || 2020;
      const journal = metadata.journal || 'Unknown Journal';

      journalCounts[journal] = (journalCounts[journal] || 0) + 1;
      yearRange.min = Math.min(yearRange.min, year);
      yearRange.max = Math.max(yearRange.max, year);

      const similarity = ((emb.similarity as any) * 100).toFixed(1);
      const shortAuthors = shortenAuthors(metadata.authors);
      const shortTitle = (metadata.title || 'Unknown Title').length > 80
        ? (metadata.title || 'Unknown Title').substring(0, 80) + '...'
        : (metadata.title || 'Unknown Title');

      const chunkHeader = `[${sourceIndex}] ${shortTitle} (${journal.split(' ')[0]}, ${year}) - ${shortAuthors} - PMID:${pmid || 'N/A'} [${similarity}%]`;
      const chunkContent = emb.content.trim();
      const chunkText = `${chunkHeader}\n${chunkContent}\n`;

      const chunkTokens = Math.ceil(chunkText.length / 4);

      if (currentTokens + chunkTokens > maxContextTokens && context.length > 0) {
        break;
      }

      context += chunkText + '\n';
      currentTokens += chunkTokens;
      sourceIndex++;
    }

    const contextSummary = `Research Context: ${sourceIndex - 1} sources (${yearRange.min}-${yearRange.max}) - Query: "${query}"\n\n`;
    const finalContext = contextSummary + context;

    // Generate response
    await updateJobProgress(jobId, "processing", "Generating response with AI model...");
    console.log(`[${new Date().toISOString()}] Generating response...`);
    const selectedOutputStyle = outputStyle === "narrative" ? "narrative" : "structured";
    const initialResponse = await generateResponse(
      query, finalContext, ragMetadata.name, selectedModel,
      selectedComplexity, selectedOutputStyle
    );

    let finalResponse = initialResponse;
    let confidence = 85;

    // Apply verification if enabled
    if (enableVerification) {
      await updateJobProgress(jobId, "processing", "Verifying response accuracy...");
      const verificationResult = await verifyResponse(initialResponse, similarEmbeddings, selectedModel);
      finalResponse = verificationResult.verifiedResponse;
      confidence = verificationResult.confidence;
    }

    // Extract citations
    const citedSources = extractCitedSources(finalResponse, similarEmbeddings);

    // Store results
    await updateJobProgress(jobId, "processing", "Saving results...");
    await storeJobResults(jobId, {
      response: finalResponse,
      sources: similarEmbeddings.map((emb, index) => ({
        index: index + 1,
        content: emb.content,
        similarity: emb.similarity,
        metadata: emb.metadata,
      })),
      allMatchingChunks: matchingChunks.map((chunk, index) => ({
        index: index + 1,
        content: chunk.content,
        id: chunk.id,
        similarity: chunk.similarity,
        metadata: chunk.metadata,
        usedInContext: similarEmbeddings.some(emb => emb.content === chunk.content),
        citedInResponse: (() => {
          const contextIndex = similarEmbeddings.findIndex(emb => emb.content === chunk.content);
          return contextIndex >= 0 && citedSources.has(contextIndex + 1);
        })()
      })),
      confidence: confidence,
      verified: enableVerification
    });

    console.log(`[${new Date().toISOString()}] Background processing completed for job: ${jobId}`);

  } catch (error) {
    console.error(`[${new Date().toISOString()}] ❌ CRITICAL ERROR processing job ${jobId}:`, error);
    console.error(`[${new Date().toISOString()}] ❌ Error type:`, typeof error);
    console.error(`[${new Date().toISOString()}] ❌ Error message:`, error instanceof Error ? error.message : String(error));
    console.error(`[${new Date().toISOString()}] ❌ Error stack:`, error instanceof Error ? error.stack : 'No stack trace');

    try {
      await markJobFailed(jobId, error instanceof Error ? error.message : "Unknown error occurred");
      console.log(`[${new Date().toISOString()}] ✅ Job marked as failed in database`);
    } catch (dbError) {
      console.error(`[${new Date().toISOString()}] ❌ Failed to mark job as failed:`, dbError);
    }
  }
};