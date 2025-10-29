# Netlify RAG Chatbot

A production-ready RAG (Retrieval-Augmented Generation) chatbot system deployed on Netlify with Neon PostgreSQL databases and DeepInfra LLM integration.

## Demo

![Netlify RAG Chatbot Interface](example-screenshot.png)

*The chatbot interface showing query results with source citations and PMID links*

## Features

- **Multiple RAG Databases**: Deploy and query multiple specialized RAG databases
- **Async Query Processing**: Background job processing for long-running queries
- **Hybrid Search**: Combines vector similarity search (HNSW) with BM25 full-text search
- **Multiple Embedding Models**: Support for 384D and 768D embeddings (SciBERT, MPNet, etc.)
- **Citation Tracking**: Automatic PMID linking and source attribution
- **Serverless Architecture**: Netlify Functions for scalable, serverless deployment
- **Real-time Status Updates**: Job status tracking with progress indicators

## Prerequisites

- Node.js 18+
- npm or yarn
- [Neon](https://neon.tech) account (PostgreSQL database hosting)
- [DeepInfra](https://deepinfra.com) API key (for LLM queries)
- [Netlify](https://netlify.com) account (for deployment)
- [Neon CLI](https://neon.tech/docs/reference/neon-cli) installed globally: `npm install -g neonctl`

## Quick Start

### 1. Clone and Install

```bash
git clone https://github.com/thirtysix/netlify-rag-chatbot.git
cd netlify-rag-chatbot
npm install
```

### 2. Configure Environment Variables

Copy the example environment file and fill in your credentials:

```bash
cp .env.example .env
```

Edit `.env` with your values:

```bash
# REQUIRED: Your Neon Project ID (find in Neon dashboard)
NEON_PROJECT_ID=your-neon-project-id

# Base URL for RAG databases (without database name)
# Format: postgresql://username:password@host.neon.tech
DATABASE_URL_BASE=postgresql://user:password@ep-xxx.neon.tech

# Jobs database connection string (create this database first)
JOBS_DATABASE_URL=postgresql://user:password@ep-xxx.neon.tech/rag-jobs-db

# Your DeepInfra API key
DEEPINFRA_API_KEY=your_deepinfra_api_key
```

### 3. Create Jobs Database

Create a dedicated database for query job tracking:

```bash
# Using neonctl
neonctl databases create --name rag-jobs-db --project-id <your-project-id>

# Run migrations
npm run jobs:migrate
```

### 4. Configure RAG Databases

The repository includes a working `src/lib/db/separate-db.ts` with example RAG configurations. You can either:

- **Use as-is** for testing/learning
- **Modify** to add your own RAG databases (see "Deploying RAG Databases" below)
- **Reference** `src/lib/db/separate-db.ts.example` for a minimal template

### 5. Build and Test Locally

```bash
# Build the project
npm run build

# Test locally with Netlify Dev
npm run netlify:dev
```

### 6. Deploy to Netlify

```bash
# Login to Netlify
netlify login

# Deploy
netlify deploy --prod --dir=dist --functions=netlify/functions
```

**Important**: After deployment, set environment variables in Netlify Dashboard:
1. Go to Site settings → Environment variables
2. Add all variables from your `.env` file

## Deploying RAG Databases

### Using the Deployment Script

The `deploy-new-rag.ts` script automates the entire RAG database deployment process:

```bash
npx tsx scripts/deploy-new-rag.ts <embeddings-file> <database-name>
```

**Example:**
```bash
npx tsx scripts/deploy-new-rag.ts \
  "/path/to/processed_chunks.json" \
  "rag-my-topic"
```

This script will:
1. Create a new database in Neon
2. Set up the schema with vector extensions
3. Import your embeddings
4. Create optimized indexes (HNSW, BM25, metadata)

### Format of Embeddings File

Your `processed_chunks.json` should be a JSON array of objects:

```json
[
  {
    "content": "Your text content here",
    "embedding": [0.1, 0.2, ...],  // 768-dimensional array for SciBERT
    "metadata": {
      "pmid": "12345678",
      "year": "2023",
      "doc_index": "0",
      "chunk_index": "0"
    }
  }
]
```

### Registering Your RAG Database

After deploying a RAG database, add it to `src/lib/db/separate-db.ts`:

```typescript
export const RAG_DATABASES = {
  // ... existing databases
  'rag-my-topic': 'rag-my-topic',
} as const;

export const RAG_METADATA = {
  // ... existing metadata
  'rag-my-topic': {
    id: 'rag-my-topic',
    name: 'My Topic Research',
    topic: 'My Topic',
    description: 'Research papers on my topic',
    dimensions: 768,
    queryModel: 'sentence-transformers/all-mpnet-base-v2',
  },
} as const;
```

Then rebuild and redeploy:

```bash
npm run build
netlify deploy --prod --dir=dist --functions=netlify/functions
```

## Project Structure

```
.
├── netlify/
│   └── functions/          # Serverless functions
│       ├── query.ts               # Main synchronous query endpoint
│       ├── query-initiate.ts      # Async query initialization
│       ├── query-process-background.ts  # Background processing
│       ├── query-status.ts        # Job status checking
│       └── rags.ts                # List available RAGs
├── src/
│   ├── lib/
│   │   └── db/
│   │       ├── separate-db.ts         # RAG database config (user-specific)
│   │       ├── separate-db.ts.example # Template for RAG config
│   │       ├── separate-schema.ts     # RAG database schema
│   │       ├── jobs.ts                # Jobs database operations
│   │       └── jobs-schema.ts         # Jobs table schema
│   ├── main.ts            # Frontend application
│   └── style.css          # Styles
├── scripts/
│   ├── deploy-new-rag.ts           # Main RAG deployment script
│   ├── import-large-json-stream.ts # Data import utility
│   ├── migrate.ts                  # Main DB migrations
│   └── clear-rag-db.ts             # Clear a RAG database
├── migrations/            # Jobs database migrations
├── drizzle/              # Main database migrations
├── .env.example          # Environment variables template
├── netlify.toml          # Netlify configuration
├── package.json          # Dependencies and scripts
└── README.md            # This file
```

## Environment Variables Reference

| Variable | Required | Description |
|----------|----------|-------------|
| `NEON_PROJECT_ID` | Yes | Your Neon project ID (for deploy-new-rag.ts script) |
| `DATABASE_URL_BASE` | Yes | Base Neon connection string without database name |
| `JOBS_DATABASE_URL` | Yes | Connection string for the jobs tracking database |
| `DEEPINFRA_API_KEY` | Yes | API key from DeepInfra for LLM queries |

## Available Scripts

```bash
# Development
npm run dev              # Start Vite dev server
npm run netlify:dev      # Start Netlify Dev (functions + frontend)
npm run build            # Build for production
npm run preview          # Preview production build

# Database Operations
npm run db:generate      # Generate Drizzle migrations
npm run db:migrate       # Run main database migrations
npm run jobs:migrate     # Run jobs database migrations

# RAG Management
npx tsx scripts/deploy-new-rag.ts <file> <db-name>  # Deploy new RAG
npx tsx scripts/clear-rag-db.ts <db-name>            # Clear RAG database
```

## API Endpoints

### GET /api/rags
List all available RAG databases.

**Response:**
```json
{
  "rags": [
    {
      "id": "rag-example",
      "name": "Example RAG",
      "topic": "Example Topic",
      "description": "Example description"
    }
  ]
}
```

### POST /api/query
Execute a synchronous RAG query (best for quick queries).

**Request:**
```json
{
  "ragId": "rag-example",
  "query": "What is the role of...",
  "model": "meta-llama/Meta-Llama-3.1-70B-Instruct",
  "complexity": "standard",
  "retrievalStrategy": "hybrid",
  "enableVerification": false
}
```

### POST /api/query-initiate
Start an asynchronous query (for complex/long queries).

**Response:**
```json
{
  "jobId": "550e8400-e29b-41d4-a716-446655440000",
  "status": "pending"
}
```

### GET /api/query-status?jobId=...
Check the status of an async query.

**Response:**
```json
{
  "status": "completed",
  "response": "...",
  "sources": [...],
  "progress": "Query completed"
}
```

## Configuration Files

### netlify.toml
Netlify deployment configuration. Already set up for:
- Build command and output directory
- Functions directory
- Background function configuration
- CORS headers

### tsconfig.json
TypeScript configuration for the project.

### package.json
Dependencies and scripts. Main dependencies:
- `@neondatabase/serverless` - Neon PostgreSQL client
- `@netlify/functions` - Netlify Functions runtime
- `drizzle-orm` - Database ORM
- `dotenv` - Environment variable management

## Troubleshooting

### Error: "NEON_PROJECT_ID environment variable is required"
Make sure you've set `NEON_PROJECT_ID` in your `.env` file.

### Error: "Unknown RAG: rag-xxx"
You need to register your RAG database in `src/lib/db/separate-db.ts` after deploying it.

### Functions timeout
For large queries, use the async endpoints (`/api/query-initiate` + `/api/query-status`) instead of `/api/query`.

### Database connection errors
Verify your `DATABASE_URL_BASE` is correct and doesn't include the database name. The system appends the database name automatically.

## Development Workflow

1. **Add embeddings data** - Prepare your `processed_chunks.json` file
2. **Deploy RAG database** - Use `deploy-new-rag.ts` script
3. **Register in config** - Add to `src/lib/db/separate-db.ts`
4. **Build and test** - `npm run build && npm run netlify:dev`
5. **Deploy** - `netlify deploy --prod --dir=dist --functions=netlify/functions`

## Security Notes

- Never commit `.env` file (it's in `.gitignore`)
- `src/lib/db/separate-db.ts` is safe to commit (contains no credentials, only database names)
- All sensitive credentials (DATABASE_URL_BASE, API keys) must be in `.env` or Netlify environment variables
- Set environment variables in Netlify dashboard for production

## License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

## Contributing

Contributions are welcome! Please read our [Contributing Guidelines](CONTRIBUTING.md) for details on how to submit pull requests, report issues, and contribute to the project.

### Quick Contributing Steps

1. Fork the repository
2. Create a feature branch (`git checkout -b feature/amazing-feature`)
3. Commit your changes (`git commit -m 'feat: add amazing feature'`)
4. Push to the branch (`git push origin feature/amazing-feature`)
5. Open a Pull Request

See [CONTRIBUTING.md](CONTRIBUTING.md) for detailed guidelines.
