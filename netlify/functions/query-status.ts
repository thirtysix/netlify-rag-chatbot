import type { Handler } from "@netlify/functions";
import { getQueryJob } from "../../src/lib/db/jobs";

export const handler: Handler = async (event, context) => {
  const headers = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Allow-Methods": "GET, OPTIONS",
  };

  if (event.httpMethod === "OPTIONS") {
    return { statusCode: 200, headers, body: "" };
  }

  if (event.httpMethod !== "GET") {
    return {
      statusCode: 405,
      headers,
      body: JSON.stringify({ error: "Method not allowed" }),
    };
  }

  try {
    const { jobId } = event.queryStringParameters || {};

    if (!jobId) {
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({ error: "Job ID is required" }),
      };
    }

    console.log(`[${new Date().toISOString()}] Checking status for job: ${jobId}`);

    // Get job from database
    const job = await getQueryJob(jobId);

    if (!job) {
      console.log(`[${new Date().toISOString()}] Job not found: ${jobId}`);
      return {
        statusCode: 404,
        headers,
        body: JSON.stringify({ error: "Job not found" }),
      };
    }

    console.log(`[${new Date().toISOString()}] Job ${jobId} status: ${job.status}`);

    // Calculate elapsed time
    const elapsedTime = job.startedAt
      ? Math.floor((new Date().getTime() - new Date(job.startedAt).getTime()) / 1000)
      : 0;

    // Check if job has expired
    if (new Date() > new Date(job.expiresAt)) {
      return {
        statusCode: 410, // Gone
        headers,
        body: JSON.stringify({
          error: "Job has expired",
          message: "Results are only available for 1 hour after creation"
        }),
      };
    }

    // Return based on status
    if (job.status === "completed") {
      // Job is complete, return full results
      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({
          jobId: job.id,
          status: job.status,
          response: job.response,
          sources: job.sources,
          allMatchingChunks: job.allMatchingChunks,
          confidence: job.confidence ? parseFloat(job.confidence) : undefined,
          verified: job.params.enableVerification,
          completedAt: job.completedAt,
          elapsedTime,
        }),
      };
    } else if (job.status === "failed") {
      // Job failed, return error
      return {
        statusCode: 200, // Still 200 as the request itself succeeded
        headers,
        body: JSON.stringify({
          jobId: job.id,
          status: job.status,
          error: job.error || "Query processing failed",
          completedAt: job.completedAt,
          elapsedTime,
        }),
      };
    } else {
      // Job is still pending or processing
      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({
          jobId: job.id,
          status: job.status,
          progress: job.progress || "Processing query...",
          estimatedTime: job.status === "pending" ? "15-60 seconds" : `${60 - elapsedTime} seconds remaining`,
          elapsedTime,
        }),
      };
    }
  } catch (error) {
    console.error("Error checking job status:", error);
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ error: "Failed to check job status" }),
    };
  }
};