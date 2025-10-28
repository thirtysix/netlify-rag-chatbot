#!/usr/bin/env -S npx tsx
import 'dotenv/config';
import { neon } from '@neondatabase/serverless';

// Generate database connection string from base URL and database name
function getDatabaseUrl(dbName: string): string {
  const baseUrl = process.env.DATABASE_URL_BASE;
  if (!baseUrl) {
    throw new Error('DATABASE_URL_BASE environment variable is required');
  }
  return `${baseUrl}/${dbName}?sslmode=require&channel_binding=require`;
}

// Fallback to specific environment variables for backward compatibility
function getConnectionString(dbKey: string): string {
  // Try dynamic generation first
  if (process.env.DATABASE_URL_BASE) {
    return getDatabaseUrl(dbKey);
  }
  
  // Fallback to specific environment variables
  const DB_CONNECTIONS: Record<string, string | undefined> = {
    'rag-gene-regulation': process.env.DATABASE_URL_GENE_REGULATION,
    'rag-genome-evolution': process.env.DATABASE_URL_GENOME_EVOLUTION,
    'rag-transcription-factors': process.env.DATABASE_URL_TRANSCRIPTION_FACTORS,
    'gene_regulation_evolution': process.env.DATABASE_URL_GENE_REGULATION,
    'genome_evolution': process.env.DATABASE_URL_GENOME_EVOLUTION,
    'transcription_factors': process.env.DATABASE_URL_TRANSCRIPTION_FACTORS,
  };
  
  const connectionString = DB_CONNECTIONS[dbKey];
  if (!connectionString) {
    throw new Error(`No database connection found for: ${dbKey}`);
  }
  
  return connectionString;
}

async function clearRagDatabase(dbKey: string) {
  const connectionString = getConnectionString(dbKey);

  try {
    const sql = neon(connectionString);
    
    // Get count before clearing
    const beforeCount = await sql`SELECT COUNT(*) as count FROM embeddings`;
    console.log(`📊 Current embeddings in ${dbKey}: ${beforeCount[0].count}`);
    
    // Clear all embeddings
    await sql`TRUNCATE TABLE embeddings`;
    
    // Verify cleared
    const afterCount = await sql`SELECT COUNT(*) as count FROM embeddings`;
    console.log(`✅ Cleared ${dbKey} database - now has ${afterCount[0].count} embeddings`);
    
  } catch (error) {
    console.error(`❌ Error clearing ${dbKey}:`, error.message);
  }
}

async function main() {
  const dbKey = process.argv[2];
  
  if (!dbKey) {
    console.log('Usage: npx tsx scripts/clear-rag-db.ts <database-key>');
    console.log('Example: npx tsx scripts/clear-rag-db.ts rag-ovarian-cancer');
    process.exit(1);
  }

  // Check if we can connect using base URL (for any rag-* database)
  if (!process.env.DATABASE_URL_BASE && !dbKey.startsWith('rag-')) {
    console.error(`❌ DATABASE_URL_BASE environment variable is required`);
    process.exit(1);
  }

  console.log(`🗑️ Clearing ${dbKey} database...`);
  await clearRagDatabase(dbKey);
}

main().catch(console.error);