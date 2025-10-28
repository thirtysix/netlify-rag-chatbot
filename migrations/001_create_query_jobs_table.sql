-- Migration: Create query_jobs table for async query processing
-- Run this migration on your Neon database

-- Create job status enum
CREATE TYPE job_status AS ENUM ('pending', 'processing', 'completed', 'failed');

-- Create query_jobs table
CREATE TABLE IF NOT EXISTS query_jobs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    status job_status NOT NULL DEFAULT 'pending',
    progress TEXT,

    -- Request parameters (stored as JSONB)
    params JSONB NOT NULL,

    -- Response data
    response TEXT,
    sources JSONB,
    all_matching_chunks JSONB,
    confidence TEXT,

    -- Error tracking
    error TEXT,

    -- Timestamps
    created_at TIMESTAMP DEFAULT NOW() NOT NULL,
    started_at TIMESTAMP,
    completed_at TIMESTAMP,
    expires_at TIMESTAMP NOT NULL,

    -- Indexes for performance
    CONSTRAINT valid_expires_at CHECK (expires_at > created_at)
);

-- Create indexes for efficient queries
CREATE INDEX idx_query_jobs_status ON query_jobs(status);
CREATE INDEX idx_query_jobs_created_at ON query_jobs(created_at);
CREATE INDEX idx_query_jobs_expires_at ON query_jobs(expires_at);

-- Create a function to automatically clean up expired jobs
CREATE OR REPLACE FUNCTION cleanup_expired_jobs()
RETURNS void AS $$
BEGIN
    DELETE FROM query_jobs WHERE expires_at < NOW();
END;
$$ LANGUAGE plpgsql;

-- Optional: Create a scheduled job to clean up expired jobs periodically
-- Note: This requires pg_cron extension which may need to be enabled
-- CREATE EXTENSION IF NOT EXISTS pg_cron;
-- SELECT cron.schedule('cleanup-expired-jobs', '0 * * * *', 'SELECT cleanup_expired_jobs();');

-- Grant necessary permissions (adjust based on your database user)
-- GRANT ALL PRIVILEGES ON TABLE query_jobs TO your_app_user;
-- GRANT USAGE ON TYPE job_status TO your_app_user;