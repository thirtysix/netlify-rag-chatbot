import type { Handler } from "@netlify/functions";
import { RAG_METADATA } from "../../src/lib/db/separate-db";

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
    // Convert RAG_METADATA to array format with enhanced information
    const ragsList = Object.values(RAG_METADATA).map(rag => ({
      ...rag,
      modelInfo: `${rag.dimensions}D embeddings`,
      embeddingModel: rag.queryModel,
      isSciBert: rag.dimensions === 768
    }));

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({ rags: ragsList }),
    };
  } catch (error) {
    console.error("Error fetching RAGs:", error);
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ error: "Failed to fetch RAGs" }),
    };
  }
};