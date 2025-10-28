import { pgTable, text, timestamp, jsonb, uuid, pgEnum } from "drizzle-orm/pg-core";

// Enum for job status
export const jobStatusEnum = pgEnum("job_status", [
  "pending",
  "processing",
  "completed",
  "failed"
]);

// Query jobs table for tracking async RAG queries
export const queryJobs = pgTable("query_jobs", {
  id: uuid("id").primaryKey().defaultRandom(),
  status: jobStatusEnum("status").notNull().default("pending"),
  progress: text("progress"), // Progress message for UI

  // Request parameters
  params: jsonb("params").notNull().$type<{
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
  }>(),

  // Response data
  response: text("response"), // LLM response text
  sources: jsonb("sources"), // Retrieved chunks and metadata
  allMatchingChunks: jsonb("all_matching_chunks"), // All chunks for display
  confidence: text("confidence"), // Confidence score if verification enabled

  // Error tracking
  error: text("error"), // Error message if failed

  // Timestamps
  createdAt: timestamp("created_at").defaultNow().notNull(),
  startedAt: timestamp("started_at"), // When processing started
  completedAt: timestamp("completed_at"), // When job finished (success or failure)

  // TTL for cleanup - jobs older than 1 hour can be deleted
  expiresAt: timestamp("expires_at").notNull(),
});

export type QueryJob = typeof queryJobs.$inferSelect;
export type NewQueryJob = typeof queryJobs.$inferInsert;