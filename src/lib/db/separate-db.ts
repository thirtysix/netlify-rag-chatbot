import { drizzle } from "drizzle-orm/neon-http";
import { neon } from "@neondatabase/serverless";
import * as schema from "./separate-schema";

// Generate database connection string from base URL and database name
function getDatabaseUrl(dbName: string): string {
  const baseUrl = process.env.DATABASE_URL_BASE;
  if (!baseUrl) {
    throw new Error('DATABASE_URL_BASE environment variable is required');
  }
  return `${baseUrl}/${dbName}?sslmode=require&channel_binding=require`;
}

// Create database connection for a specific RAG
export function createRagDbConnection(dbName: string) {
  const connectionString = getDatabaseUrl(dbName);
  const sql = neon(connectionString);
  return drizzle(sql, { schema });
}

// Available RAG database mappings
export const RAG_DATABASES = {
  'rag-gene-regulation': 'rag-gene-regulation',
  'rag-genome-evolution': 'rag-genome-evolution',
  'rag-transcription-factors': 'rag-transcription-factors',
  'pin1-cancer': 'pin1-cancer',
  'rag-carbonic-anhydrases': 'rag-carbonic-anhydrases',
  'rag-ovarian-cancer': 'rag-ovarian-cancer',
  // SciBERT variants
  'rag-gene-regulation-scibert': 'rag-gene-regulation-scibert',
  'rag-scRNA-Seq': 'rag-scRNA-Seq',
  'rag-Wnts': 'rag-Wnts',
  'rag-FOXO3':'rag-FOXO3',
  'rag-DYRK1B': 'rag-DYRK1B',
  // Add new RAGs here as needed
} as const;

// RAG metadata (replaces the main database rags table)
export const RAG_METADATA = {
  'rag-gene-regulation': {
    id: 'rag-gene-regulation',
    name: 'Gene Regulation Evolution',
    topic: 'Gene Regulation',
    description: 'Research papers on gene regulation and evolutionary biology',
    dimensions: 768,
    queryModel: 'sentence-transformers/all-mpnet-base-v2',
  },
  'rag-genome-evolution': {
    id: 'rag-genome-evolution',
    name: 'Genome Evolution',
    topic: 'Evolutionary Genomics',
    description: 'Research papers on genome evolution and comparative genomics',
    dimensions: 384,
    queryModel: 'sentence-transformers/all-MiniLM-L6-v2',
  },
  'rag-transcription-factors': {
    id: 'rag-transcription-factors',
    name: 'Transcription Factors',
    topic: 'Transcriptional Regulation',
    description: 'Research papers on transcription factors and gene expression',
    dimensions: 768,
    queryModel: 'sentence-transformers/all-mpnet-base-v2',
  },
  'pin1-cancer': {
    id: 'pin1-cancer',
    name: 'PIN1 and Cancer',
    topic: 'Cancer Biology',
    description: 'Research papers on PIN1 protein and cancer mechanisms',
    dimensions: 768,
    queryModel: 'sentence-transformers/all-mpnet-base-v2',
  },
  'rag-carbonic-anhydrases': {
    id: 'rag-carbonic-anhydrases',
    name: 'Carbonic Anhydrases',
    topic: 'Carbonic Anhydrases',
    description: 'Research papers on Carbonic Anhydrases',
    dimensions: 384,
    queryModel: 'sentence-transformers/all-MiniLM-L6-v2',
  },
  'rag-ovarian-cancer': {
    id: 'rag-ovarian-cancer',
    name: 'Ovarian Cancer',
    topic: 'Ovarian Cancer',
    description: 'Research papers on ovarian cancer',
    dimensions: 384,
    queryModel: 'sentence-transformers/all-MiniLM-L6-v2',
  },
  // SciBERT variants (to be added manually when ready)
  'rag-gene-regulation-scibert': {
    id: 'rag-gene-regulation-scibert',
    name: '768 Gene Regulation Evolution',
    topic: 'Gene Regulation',
    description: 'Research papers on gene regulation and evolutionary biology (SciBERT embeddings)',
    dimensions: 768,
    queryModel: 'sentence-transformers/all-mpnet-base-v2',
  },

  'rag-scRNA-Seq': {
    id: 'rag-scRNA-Seq',
    name: 'scRNA-Seq',
    topic: 'Gene Regulation',
    description: 'Research papers on scRNA-Seq',
    dimensions: 768,
    queryModel: 'sentence-transformers/all-mpnet-base-v2',
  },

  'rag-Wnts': {
    id: 'rag-Wnts',
    name: 'Wnts',
    topic: 'Wnt Signalling',
    description: 'Research papers on Wnt Signalling',
    dimensions: 768,
    queryModel: 'sentence-transformers/all-mpnet-base-v2',
  },

  'rag-FOXO3': {
    id: 'rag-FOXO3',
    name: 'FOXO3',
    topic: 'FOXO3',
    description: 'Research papers on FOXO3',
    dimensions: 768,
    queryModel: 'sentence-transformers/all-mpnet-base-v2',
  },

  'rag-DYRK1B': {
    id: 'rag-DYRK1B',
    name: 'DYRK1B',
    topic: 'DYRK1B',
    description: 'Research papers on DYRK1B',
    dimensions: 768,
    queryModel: 'sentence-transformers/all-mpnet-base-v2',
  },

  // Add new RAGs here as needed
} as const;

export type RagId = keyof typeof RAG_DATABASES;
export type RagMetadata = typeof RAG_METADATA[RagId];

// Helper functions for dual-dimension support
export function getRagConfig(ragId: string) {
  const config = RAG_METADATA[ragId as RagId];
  if (!config) {
    throw new Error(`Unknown RAG: ${ragId}`);
  }
  return {
    queryModel: config.queryModel,
    dimensions: config.dimensions,
    name: config.name,
    description: config.description
  };
}

export function getRagDimensions(ragId: string): number {
  const metadata = RAG_METADATA[ragId as RagId];
  return metadata?.dimensions || 384; // Default fallback
}

export function isSciBertRag(ragId: string): boolean {
  return ragId.includes('-scibert');
}