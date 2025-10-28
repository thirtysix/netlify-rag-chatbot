import type { Handler } from "@netlify/functions";
import { createQueryJob, markJobFailed } from "../../src/lib/db/jobs";
import { RAG_METADATA, type RagId } from "../../src/lib/db/separate-db";

// Token limits and validation (shared with query.ts)
const TOKEN_LIMITS = {
  MAX_TARGET_TOKENS: 10000,
  MIN_TARGET_TOKENS: 100,
  MAX_QUERY_LENGTH: 1000,
  DEFAULT_TARGET_TOKENS: 1500
};

// Abuse prevention configuration
const ABUSE_PREVENTION = {
  MAX_REQUESTS_PER_MINUTE: 3,
  SUSPICIOUS_PATTERNS: [
    /select.*from/i,
    /<script/i,
    /javascript:/i,
    /eval\(/i,
    /[\x00-\x08\x0B\x0C\x0E-\x1F]/,
  ],
  BLOCKED_TERMS: [
    'password', 'secret', 'token', 'key', 'admin',
    'drop table', 'delete from', 'update set', 'insert into'
  ]
};

// Simple in-memory rate limiting (shared with query.ts)
const rateLimitStore = new Map<string, { count: number; resetTime: number }>();

function checkRateLimit(clientIP: string): { allowed: boolean; reason?: string } {
  const now = Date.now();
  const resetTime = now + 60000; // 1 minute window

  if (!rateLimitStore.has(clientIP)) {
    rateLimitStore.set(clientIP, { count: 1, resetTime });
    return { allowed: true };
  }

  const entry = rateLimitStore.get(clientIP)!;

  if (now > entry.resetTime) {
    entry.count = 1;
    entry.resetTime = resetTime;
  }

  if (entry.count >= ABUSE_PREVENTION.MAX_REQUESTS_PER_MINUTE) {
    return { allowed: false, reason: `Rate limit exceeded (max ${ABUSE_PREVENTION.MAX_REQUESTS_PER_MINUTE} requests per minute)` };
  }

  entry.count++;
  return { allowed: true };
}

function detectSuspiciousContent(text: string): string[] {
  const issues: string[] = [];

  for (const pattern of ABUSE_PREVENTION.SUSPICIOUS_PATTERNS) {
    if (pattern.test(text)) {
      issues.push(`Suspicious pattern detected`);
      break;
    }
  }

  const lowerText = text.toLowerCase();
  for (const term of ABUSE_PREVENTION.BLOCKED_TERMS) {
    if (lowerText.includes(term.toLowerCase())) {
      issues.push(`Blocked content detected`);
      break;
    }
  }

  return issues;
}

function validateAndSanitizeInput(input: any): {
  isValid: boolean;
  errors: string[];
  sanitized?: any;
} {
  const errors: string[] = [];

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

  // Get client IP for rate limiting
  const clientIP = event.headers['x-forwarded-for']?.split(',')[0] ||
                   event.headers['x-real-ip'] ||
                   'unknown';

  try {
    console.log(`[${new Date().toISOString()}] Query initiation started`);

    // Check rate limit
    const rateLimitCheck = checkRateLimit(clientIP);
    if (!rateLimitCheck.allowed) {
      console.log(`[${new Date().toISOString()}] Rate limit exceeded for IP: ${clientIP}`);
      return {
        statusCode: 429,
        headers: { ...headers, "Retry-After": "60" },
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
        headers,
        body: JSON.stringify({
          error: "Invalid input",
          details: validation.errors
        })
      };
    }

    const params = validation.sanitized!;

    // Validate RAG exists
    if (!RAG_METADATA[params.ragId as RagId]) {
      return {
        statusCode: 404,
        headers,
        body: JSON.stringify({ error: "RAG not found" }),
      };
    }

    // Create job in database
    console.log(`[${new Date().toISOString()}] Creating job for query: "${params.query}"`);
    const job = await createQueryJob(params);
    console.log(`[${new Date().toISOString()}] Created job with ID: ${job.id}`);

    // Job created successfully - frontend will trigger background processing
    console.log(`[${new Date().toISOString()}] Job created, returning to frontend for background triggering`);
    console.log(`[${new Date().toISOString()}] Environment: ${process.env.CONTEXT || 'production'}`);

    // Return immediately with job ID
    return {
      statusCode: 202, // Accepted
      headers,
      body: JSON.stringify({
        jobId: job.id,
        message: "Query processing started",
        checkStatusUrl: `/.netlify/functions/query-status?jobId=${job.id}`,
        estimatedTime: "15-60 seconds"
      })
    };

  } catch (error) {
    console.error("Error initiating query:", error);
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ error: "Failed to initiate query" }),
    };
  }
};