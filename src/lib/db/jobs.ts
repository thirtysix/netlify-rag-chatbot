import { drizzle } from "drizzle-orm/neon-http";
import { neon } from "@neondatabase/serverless";
import { eq } from "drizzle-orm";
import { queryJobs, type QueryJob, type NewQueryJob } from "./jobs-schema";

// Use a separate JOBS database connection
// This should point to a dedicated jobs database on Neon
const JOBS_DATABASE_URL = process.env.JOBS_DATABASE_URL || process.env.DATABASE_URL;

if (!JOBS_DATABASE_URL) {
  throw new Error("JOBS_DATABASE_URL environment variable is required");
}

const sql = neon(JOBS_DATABASE_URL);
const jobsDb = drizzle(sql, { schema: { queryJobs } });

/**
 * Create a database connection for testing
 */
export function createJobsConnection() {
  return jobsDb;
}

/**
 * Create a new query job
 */
export async function createQueryJob(params: {
  ragId: string;
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
}): Promise<QueryJob> {
  const expiresAt = new Date(Date.now() + 3600000); // 1 hour from now

  const [job] = await jobsDb
    .insert(queryJobs)
    .values({
      params,
      expiresAt,
    })
    .returning();

  return job;
}

/**
 * Get a job by ID
 */
export async function getQueryJob(jobId: string): Promise<QueryJob | null> {
  const [job] = await jobsDb
    .select()
    .from(queryJobs)
    .where(eq(queryJobs.id, jobId))
    .limit(1);

  return job || null;
}

/**
 * Update job status and progress
 */
export async function updateJobProgress(
  jobId: string,
  status: "pending" | "processing" | "completed" | "failed",
  progress?: string,
  error?: string
): Promise<QueryJob[]> {
  const updateData: Partial<QueryJob> = {
    status,
    progress,
  };

  if (status === "processing" && !updateData.startedAt) {
    updateData.startedAt = new Date();
  }

  if (status === "completed" || status === "failed") {
    updateData.completedAt = new Date();
  }

  if (error) {
    updateData.error = error;
  }

  const result = await jobsDb
    .update(queryJobs)
    .set(updateData)
    .where(eq(queryJobs.id, jobId))
    .returning();

  return result;
}

/**
 * Store job results
 */
export async function storeJobResults(
  jobId: string,
  results: {
    response: string;
    sources: any[];
    allMatchingChunks?: any[];
    confidence?: number;
    verified?: boolean;
  }
): Promise<void> {
  await jobsDb
    .update(queryJobs)
    .set({
      status: "completed",
      response: results.response,
      sources: results.sources,
      allMatchingChunks: results.allMatchingChunks,
      confidence: results.confidence?.toString(),
      completedAt: new Date(),
    })
    .where(eq(queryJobs.id, jobId));
}

/**
 * Mark job as failed
 */
export async function markJobFailed(jobId: string, error: string): Promise<void> {
  await jobsDb
    .update(queryJobs)
    .set({
      status: "failed",
      error,
      completedAt: new Date(),
    })
    .where(eq(queryJobs.id, jobId));
}

/**
 * Clean up expired jobs (run periodically)
 */
export async function cleanupExpiredJobs(): Promise<number> {
  const now = new Date();
  const result = await jobsDb
    .delete(queryJobs)
    .where(eq(queryJobs.expiresAt, now));

  return result.rowCount || 0;
}