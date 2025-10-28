import * as fs from 'fs';
import * as path from 'path';
import { neon } from '@neondatabase/serverless';
import dotenv from 'dotenv';

// Load .env
dotenv.config();

interface EmbeddingRecord {
  content: string;
  embedding: string;
  metadata: string;
}

async function insertBatch(sql: any, batch: EmbeddingRecord[]): Promise<number> {
  if (batch.length === 0) return 0;

  try {
    // Use json_to_recordset for efficient batch insert
    await sql`
      INSERT INTO embeddings (content, embedding, metadata)
      SELECT
        content,
        embedding::vector,
        metadata::jsonb
      FROM json_to_recordset(${JSON.stringify(batch)})
      AS x(content text, embedding text, metadata text)
    `;

    return batch.length;
  } catch (error) {
    console.error('❌ Batch insert error:', error);
    return 0;
  }
}

async function processStreamingJSON(filePath: string, sql: any) {
  const BATCH_SIZE = 100;
  const CHUNK_SIZE = 5 * 1024 * 1024; // 5MB chunks

  const fileStats = fs.statSync(filePath);
  const fileSize = fileStats.size;
  console.log(`📦 File size: ${(fileSize / (1024 * 1024)).toFixed(2)} MB`);

  // Clear existing data
  console.log('🗑️ Clearing existing data...');
  await sql`TRUNCATE TABLE embeddings`;

  const stream = fs.createReadStream(filePath, {
    highWaterMark: CHUNK_SIZE,
    encoding: 'utf8'
  });

  let buffer = '';
  let batch: EmbeddingRecord[] = [];
  let totalInserted = 0;
  let totalProcessed = 0;
  let bytesProcessed = 0;
  let inArray = false;
  let depth = 0;

  console.log('🔄 Processing file with streaming...');

  return new Promise((resolve, reject) => {
    stream.on('data', async (chunk: string) => {
      stream.pause(); // Pause to handle backpressure

      bytesProcessed += Buffer.byteLength(chunk);
      buffer += chunk;

      // Find complete JSON objects in buffer
      let startIndex = 0;
      let braceCount = 0;
      let inString = false;
      let escapeNext = false;

      for (let i = 0; i < buffer.length; i++) {
        const char = buffer[i];

        if (escapeNext) {
          escapeNext = false;
          continue;
        }

        if (char === '\\') {
          escapeNext = true;
          continue;
        }

        if (char === '"') {
          inString = !inString;
          continue;
        }

        if (inString) continue;

        // Track array boundaries
        if (char === '[' && braceCount === 0) {
          inArray = true;
          startIndex = i + 1;
          continue;
        }

        if (char === ']' && braceCount === 0 && inArray) {
          // End of array
          buffer = '';
          break;
        }

        if (char === '{') {
          if (braceCount === 0) {
            startIndex = i;
          }
          braceCount++;
        } else if (char === '}') {
          braceCount--;

          if (braceCount === 0 && startIndex >= 0) {
            // Found complete object
            const jsonStr = buffer.substring(startIndex, i + 1);

            try {
              const obj = JSON.parse(jsonStr);
              totalProcessed++;

              // Extract fields
              const content = obj.text || obj.content || obj.page_content || obj.pageContent;
              const embedding = obj.embedding || obj.embeddings || obj.vector;

              if (content && embedding && Array.isArray(embedding)) {
                let metadata = obj.metadata || {};
                if (typeof metadata === 'string') {
                  metadata = JSON.parse(metadata);
                }

                batch.push({
                  content: content,
                  embedding: `[${embedding.join(',')}]`,
                  metadata: JSON.stringify(metadata)
                });

                // Insert batch if full
                if (batch.length >= BATCH_SIZE) {
                  const inserted = await insertBatch(sql, batch);
                  totalInserted += inserted;

                  if (totalInserted % 1000 === 0) {
                    console.log(`✅ Inserted ${totalInserted} embeddings...`);
                  }

                  batch = [];
                }
              }
            } catch (e) {
              // Skip malformed objects
            }

            // Remove processed object from buffer
            buffer = buffer.substring(i + 1);
            i = -1; // Reset loop counter for new buffer
            startIndex = 0;
          }
        }
      }

      // Progress update
      const progress = ((bytesProcessed / fileSize) * 100).toFixed(1);
      if (parseFloat(progress) % 5 === 0) {
        console.log(`📊 Progress: ${progress}% (${totalInserted} inserted, ${totalProcessed} processed)`);
      }

      stream.resume(); // Resume stream
    });

    stream.on('end', async () => {
      // Insert remaining batch
      if (batch.length > 0) {
        const inserted = await insertBatch(sql, batch);
        totalInserted += inserted;
      }

      console.log(`\n🎉 Import complete!`);
      console.log(`📊 Total processed: ${totalProcessed}`);
      console.log(`✅ Successfully imported: ${totalInserted}`);
      console.log(`❌ Skipped: ${totalProcessed - totalInserted}`);

      // Verify
      const count = await sql`SELECT COUNT(*) as count FROM embeddings`;
      console.log(`🔍 Database verification: ${count[0].count} embeddings stored`);

      resolve(totalInserted);
    });

    stream.on('error', (error) => {
      console.error('💥 Stream error:', error);
      reject(error);
    });
  });
}

async function main() {
  const args = process.argv.slice(2);
  let filePath: string | undefined;
  let connectionString: string | undefined;

  // Parse arguments
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--connection-string' && i + 1 < args.length) {
      connectionString = args[i + 1];
      i++;
    } else if (!filePath && !args[i].startsWith('--')) {
      filePath = args[i];
    }
  }

  if (!filePath) {
    console.error('❌ Please provide a JSON file path');
    process.exit(1);
  }

  filePath = path.resolve(filePath);

  if (!fs.existsSync(filePath)) {
    console.error(`❌ File not found: ${filePath}`);
    process.exit(1);
  }

  // Use provided connection string or env variable
  const dbConnectionString = connectionString || process.env.DATABASE_URL;

  if (!dbConnectionString) {
    console.error('❌ No database connection string provided');
    console.error('Use --connection-string or set DATABASE_URL in .env');
    process.exit(1);
  }

  // Extract database name from connection string
  const dbName = dbConnectionString.split('/').pop()?.split('?')[0] || 'database';

  console.log(`🚀 Starting streaming import from ${path.basename(filePath)} to ${dbName}...`);
  console.log(`📡 Connecting to ${dbName} database...`);

  const sql = neon(dbConnectionString);

  try {
    await processStreamingJSON(filePath, sql);
  } catch (error) {
    console.error(`💥 Import failed:`, error);
    process.exit(1);
  }
}

main().catch(console.error);