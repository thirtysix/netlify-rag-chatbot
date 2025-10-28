import { pgTable, serial, text, timestamp, vector, index, jsonb } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

// Function to create embeddings schema with configurable dimensions
export function createEmbeddingsSchema(dimensions: number = 384) {
  return pgTable("embeddings", {
    id: serial("id").primaryKey(),
    content: text("content").notNull(),
    embedding: vector("embedding", { dimensions }), // Dynamic dimensions
    metadata: jsonb("metadata"), // JSONB for better querying and indexing
    createdAt: timestamp("created_at").defaultNow().notNull(),
  }, (table) => ({
    // HNSW index for fast vector similarity search
    // Adjust parameters based on dimensions
    embeddingHnswIndex: index("embedding_hnsw_idx")
      .using("hnsw", table.embedding.op("vector_cosine_ops"))
      .with({
        m: dimensions >= 768 ? 24 : 16,
        ef_construction: dimensions >= 768 ? 128 : 64
      }),
    // GIN index for full-text search on content
    contentGinIndex: index("content_gin_idx")
      .using("gin", sql`to_tsvector('english', ${table.content})`),
    // Index on created_at for performance
    createdAtIndex: index("embeddings_created_at_idx").on(table.createdAt),
  }));
}

// Default 384D schema for backward compatibility
export const embeddings = createEmbeddingsSchema(384);

// 768D schema for SciBERT
export const embeddings768 = createEmbeddingsSchema(768);

export type Embedding = typeof embeddings.$inferSelect;
export type NewEmbedding = typeof embeddings.$inferInsert;