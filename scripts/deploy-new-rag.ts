#!/usr/bin/env -S npx tsx
/**
 * Unified RAG Deployment Script
 *
 * Automates the entire process of deploying a new RAG database:
 * 1. Creates database in Neon
 * 2. Sets up initial schema (table structure only)
 * 3. Imports embeddings from JSON file
 * 4. Creates indexes after data import (optimized)
 *
 * Usage:
 *   npx tsx scripts/deploy-new-rag.ts <embeddings-file> <db-name>
 *
 * Example:
 *   npx tsx scripts/deploy-new-rag.ts \
 *     "/path/to/processed_chunks.json" \
 *     "rag-FOXO3"
 */

import 'dotenv/config'
import { execSync } from 'child_process'
import { neon } from '@neondatabase/serverless'
import * as fs from 'fs'
import * as path from 'path'

const NEON_PROJECT_ID = process.env.NEON_PROJECT_ID || ''

if (!NEON_PROJECT_ID) {
  console.error('Error: NEON_PROJECT_ID environment variable is required')
  process.exit(1)
}

// Color codes for terminal output
const colors = {
  reset: '\x1b[0m',
  bright: '\x1b[1m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  red: '\x1b[31m',
}

function log(message: string, color = colors.reset) {
  console.log(`${color}${message}${colors.reset}`)
}

function logStep(step: number, message: string) {
  log(`\n${'='.repeat(60)}`, colors.bright)
  log(`Step ${step}: ${message}`, colors.blue + colors.bright)
  log('='.repeat(60), colors.bright)
}

function execCommand(command: string, description: string): string {
  log(`  🔧 ${description}...`, colors.yellow)
  try {
    const output = execSync(command, { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] })
    log(`  ✅ ${description} - Success`, colors.green)
    return output.trim()
  } catch (error: any) {
    log(`  ❌ ${description} - Failed`, colors.red)
    throw error
  }
}

async function createDatabase(dbName: string): Promise<string> {
  logStep(1, `Creating database: ${dbName}`)

  try {
    execCommand(
      `neonctl databases create --name "${dbName}" --project-id ${NEON_PROJECT_ID}`,
      `Creating database ${dbName}`
    )

    log(`  ✨ Database "${dbName}" created successfully`, colors.green)
    return dbName
  } catch (error: any) {
    if (error.message?.includes('already exists')) {
      log(`  ⚠️  Database "${dbName}" already exists, continuing...`, colors.yellow)
      return dbName
    }
    throw error
  }
}

async function getConnectionString(dbName: string): Promise<string> {
  logStep(2, 'Getting database connection string')

  const connectionString = execCommand(
    `neonctl connection-string --project-id ${NEON_PROJECT_ID} --database-name "${dbName}"`,
    'Fetching connection string'
  )

  // Remove channel_binding parameter for schema operations
  const cleanedConnectionString = connectionString.replace('&channel_binding=require', '')

  log(`  📝 Connection string obtained`, colors.green)
  log(`  🧹 Removed channel_binding parameter for compatibility`, colors.blue)

  return cleanedConnectionString
}

async function setupInitialSchema(connectionString: string, dbName: string): Promise<void> {
  logStep(3, 'Setting up initial database schema (table structure)')

  const sql = neon(connectionString)

  try {
    // 1. Install vector extension
    log(`  📦 Installing vector extension...`, colors.yellow)
    await sql`CREATE EXTENSION IF NOT EXISTS vector`

    // 2. Create embeddings table with 768 dimensions for SciBERT
    log(`  🗃️  Creating embeddings table (768-dim vectors)...`, colors.yellow)
    await sql`
      CREATE TABLE IF NOT EXISTS embeddings (
        id SERIAL PRIMARY KEY,
        content TEXT NOT NULL,
        embedding VECTOR(768) NOT NULL,
        metadata JSONB,
        created_at TIMESTAMP DEFAULT NOW()
      )
    `

    // 3. Clear any existing data
    log(`  🗑️  Clearing any existing data...`, colors.yellow)
    await sql`TRUNCATE TABLE embeddings`

    log(`  ✅ Initial schema setup complete`, colors.green)
    log(`  📊 Table created, ready for data import`, colors.blue)

  } catch (error: any) {
    log(`  ❌ Schema setup failed: ${error.message}`, colors.red)
    throw error
  }
}

async function importEmbeddings(embeddingsFile: string, connectionString: string): Promise<void> {
  logStep(4, 'Importing embeddings from JSON file')

  if (!fs.existsSync(embeddingsFile)) {
    throw new Error(`Embeddings file not found: ${embeddingsFile}`)
  }

  const fileStats = fs.statSync(embeddingsFile)
  const fileSizeMB = (fileStats.size / (1024 * 1024)).toFixed(2)
  log(`  📦 File size: ${fileSizeMB} MB`, colors.blue)
  log(`  📂 File: ${path.basename(embeddingsFile)}`, colors.blue)

  // Add channel_binding back for import operation
  const importConnectionString = connectionString.includes('channel_binding')
    ? connectionString
    : connectionString.replace('?', '?channel_binding=require&')

  log(`  🚀 Starting import (this may take several minutes)...`, colors.yellow)
  log(`  ⏳ Progress updates will appear below...`, colors.blue)

  try {
    execSync(
      `npx tsx scripts/import-large-json-stream.ts "${embeddingsFile}" --connection-string "${importConnectionString}"`,
      {
        encoding: 'utf-8',
        stdio: 'inherit' // Show progress in real-time
      }
    )

    log(`  ✅ Import completed successfully`, colors.green)
  } catch (error: any) {
    log(`  ❌ Import failed: ${error.message}`, colors.red)
    throw error
  }
}

async function createIndexesAfterImport(connectionString: string, dbName: string): Promise<void> {
  logStep(5, 'Creating optimized indexes on imported data')

  const sql = neon(connectionString)

  try {
    // 1. Create HNSW vector index (optimized for 768 dimensions with data present)
    log(`  🚀 Creating HNSW vector index (optimized for 768-dim)...`, colors.yellow)
    await sql`
      CREATE INDEX IF NOT EXISTS embedding_hnsw_idx ON embeddings
      USING hnsw (embedding vector_cosine_ops)
      WITH (m=24, ef_construction=128)
    `

    // 2. Create timestamp index
    log(`  📊 Creating timestamp index...`, colors.yellow)
    await sql`
      CREATE INDEX IF NOT EXISTS embeddings_created_at_idx
      ON embeddings (created_at)
    `

    // 3. Create metadata indexes
    log(`  📑 Creating metadata indexes...`, colors.yellow)
    await sql`
      CREATE INDEX IF NOT EXISTS embeddings_metadata_pmid_idx
      ON embeddings ((metadata->>'pmid'))
    `
    await sql`
      CREATE INDEX IF NOT EXISTS embeddings_metadata_year_idx
      ON embeddings ((metadata->>'year'))
    `
    await sql`
      CREATE INDEX IF NOT EXISTS embeddings_metadata_doc_idx
      ON embeddings ((metadata->>'doc_index'))
    `

    // 4. Setup pg_search for BM25 text search
    log(`  🔍 Setting up pg_search BM25...`, colors.yellow)

    const libResult = await sql`
      SELECT setting FROM pg_settings WHERE name = 'shared_preload_libraries'
    `
    const libraries = libResult[0]?.setting || 'none'

    if (libraries.includes('pg_search')) {
      try {
        await sql`CREATE EXTENSION IF NOT EXISTS pg_search`

        // Drop existing BM25 index if it exists
        try {
          await sql`DROP INDEX IF EXISTS embeddings_content_bm25_idx`
        } catch (e) {
          // Ignore
        }

        // Create BM25 index
        await sql`
          CREATE INDEX embeddings_content_bm25_idx ON embeddings
          USING bm25 (id, content)
          WITH (key_field='id')
        `
        log(`    ✓ BM25 index created`, colors.green)
      } catch (error: any) {
        log(`    ⚠️  pg_search setup failed: ${error.message}`, colors.yellow)
        log(`    ℹ️  BM25 search will not be available`, colors.yellow)
      }
    } else {
      log(`    ⚠️  pg_search not available in shared libraries`, colors.yellow)
      log(`    ℹ️  Enable it in Neon dashboard for BM25 search`, colors.blue)
    }

    // 5. Verify final setup
    log(`  🔍 Verifying database setup...`, colors.yellow)

    const count = await sql`SELECT COUNT(*) as count FROM embeddings`
    const indexes = await sql`
      SELECT indexname FROM pg_indexes
      WHERE tablename = 'embeddings'
    `

    log(`  ✅ All indexes created successfully`, colors.green)
    log(`  📊 Total embeddings: ${count[0].count}`, colors.green)
    log(`  🔍 Indexes: ${indexes.map(i => i.indexname).join(', ')}`, colors.blue)

  } catch (error: any) {
    log(`  ❌ Index creation failed: ${error.message}`, colors.red)
    throw error
  }
}

function printNextSteps(dbName: string, embeddingsFile: string) {
  log(`\n${'='.repeat(60)}`, colors.bright)
  log(`✨ RAG Database Deployment Complete! ✨`, colors.green + colors.bright)
  log('='.repeat(60), colors.bright)

  log(`\n📋 Next Steps:`, colors.blue + colors.bright)
  log(`\n1. Update src/lib/db/separate-db.ts:`, colors.yellow)
  log(`   Add to RAG_DATABASES:`)
  log(`     '${dbName}': '${dbName}',`, colors.blue)

  log(`\n   Add to RAG_METADATA:`)
  log(`     '${dbName}': {`, colors.blue)
  log(`       id: '${dbName}',`, colors.blue)
  log(`       name: 'YOUR_NAME_HERE',`, colors.blue)
  log(`       topic: 'YOUR_TOPIC_HERE',`, colors.blue)
  log(`       description: 'YOUR_DESCRIPTION_HERE',`, colors.blue)
  log(`       dimensions: 768,`, colors.blue)
  log(`       queryModel: 'sentence-transformers/all-mpnet-base-v2',`, colors.blue)
  log(`     },`, colors.blue)

  log(`\n2. Build and deploy:`, colors.yellow)
  log(`     npm run build && netlify deploy --prod --dir=dist --functions=netlify/functions`, colors.blue)

  log(`\n📊 Database Info:`, colors.blue + colors.bright)
  log(`   Database name: ${dbName}`, colors.blue)
  log(`   Source file: ${path.basename(embeddingsFile)}`, colors.blue)
  log(`   Dimensions: 768 (SciBERT compatible)`, colors.blue)
}

async function main() {
  const args = process.argv.slice(2)

  if (args.length < 2) {
    console.log('Usage: npx tsx scripts/deploy-new-rag.ts <embeddings-file> <database-name>')
    console.log('')
    console.log('Example:')
    console.log('  npx tsx scripts/deploy-new-rag.ts \\')
    console.log('    "/home/user/processed_chunks.json" \\')
    console.log('    "rag-FOXO3"')
    console.log('')
    console.log('Parameters:')
    console.log('  embeddings-file   Path to processed_chunks.json file')
    console.log('  database-name     Name for the new database (e.g., rag-FOXO3)')
    process.exit(1)
  }

  const embeddingsFile = path.resolve(args[0])
  const dbName = args[1]

  log(`\n🚀 RAG Database Deployment`, colors.bright + colors.green)
  log(`   Database: ${dbName}`, colors.blue)
  log(`   Source: ${embeddingsFile}`, colors.blue)

  try {
    // Step 1: Create database
    await createDatabase(dbName)

    // Step 2: Get connection string
    const connectionString = await getConnectionString(dbName)

    // Step 3: Setup initial schema (table only, no indexes yet)
    await setupInitialSchema(connectionString, dbName)

    // Step 4: Import embeddings
    await importEmbeddings(embeddingsFile, connectionString)

    // Step 5: Create indexes after data is imported
    await createIndexesAfterImport(connectionString, dbName)

    // Print next steps
    printNextSteps(dbName, embeddingsFile)

  } catch (error: any) {
    log(`\n❌ Deployment failed: ${error.message}`, colors.red)
    console.error(error)
    process.exit(1)
  }
}

main().catch(console.error)
