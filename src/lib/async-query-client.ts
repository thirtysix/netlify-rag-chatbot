/**
 * Client-side helper for handling async RAG queries with background processing
 */

export interface QueryInitiationResponse {
  jobId: string;
  message: string;
  checkStatusUrl: string;
  estimatedTime: string;
}

export interface QueryStatusResponse {
  jobId: string;
  status: "pending" | "processing" | "completed" | "failed";
  progress?: string;
  estimatedTime?: string;
  elapsedTime?: number;
  response?: string;
  sources?: any[];
  allMatchingChunks?: any[];
  confidence?: number;
  verified?: boolean;
  completedAt?: string;
  error?: string;
}

export interface QueryOptions {
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
}

export interface AsyncQueryCallbacks {
  onProgress?: (status: QueryStatusResponse) => void;
  onComplete?: (result: QueryStatusResponse) => void;
  onError?: (error: Error) => void;
}

/**
 * Initiate an async query
 */
export async function initiateQuery(options: QueryOptions): Promise<QueryInitiationResponse> {
  const response = await fetch('/.netlify/functions/query-initiate', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(options),
  });

  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.error || 'Failed to initiate query');
  }

  return response.json();
}

/**
 * Check the status of a query job
 */
export async function checkQueryStatus(jobId: string): Promise<QueryStatusResponse> {
  const response = await fetch(`/.netlify/functions/query-status?jobId=${jobId}`, {
    method: 'GET',
    headers: {
      'Content-Type': 'application/json',
    },
  });

  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.error || 'Failed to check query status');
  }

  return response.json();
}

/**
 * Execute a query with polling and callbacks
 */
export async function executeAsyncQuery(
  options: QueryOptions,
  callbacks: AsyncQueryCallbacks = {},
  pollInterval: number = 2000,
  maxPolls: number = 90 // 3 minutes max
): Promise<QueryStatusResponse> {
  try {
    // Initiate the query
    const initResponse = await initiateQuery(options);
    console.log('Query initiated:', initResponse.jobId);

    // Poll for results
    for (let i = 0; i < maxPolls; i++) {
      // Wait before polling (except first iteration)
      if (i > 0) {
        await new Promise(resolve => setTimeout(resolve, pollInterval));
      }

      try {
        const status = await checkQueryStatus(initResponse.jobId);

        // Call progress callback
        if (callbacks.onProgress) {
          callbacks.onProgress(status);
        }

        // Check if completed or failed
        if (status.status === 'completed') {
          if (callbacks.onComplete) {
            callbacks.onComplete(status);
          }
          return status;
        } else if (status.status === 'failed') {
          const error = new Error(status.error || 'Query processing failed');
          if (callbacks.onError) {
            callbacks.onError(error);
          }
          throw error;
        }

        // Continue polling...
      } catch (error) {
        // Handle polling errors gracefully - continue trying
        console.warn('Polling error:', error);
        // Only throw if this is the last attempt
        if (i === maxPolls - 1) {
          throw error;
        }
      }
    }

    // Timeout reached
    const timeoutError = new Error('Query processing timeout - please try again');
    if (callbacks.onError) {
      callbacks.onError(timeoutError);
    }
    throw timeoutError;

  } catch (error) {
    // Handle initiation errors
    if (callbacks.onError && error instanceof Error) {
      callbacks.onError(error);
    }
    throw error;
  }
}

/**
 * React Hook for async queries (if using React)
 */
export function useAsyncQuery() {
  const [loading, setLoading] = useState(false);
  const [progress, setProgress] = useState<string>('');
  const [result, setResult] = useState<QueryStatusResponse | null>(null);
  const [error, setError] = useState<Error | null>(null);

  const execute = useCallback(async (options: QueryOptions) => {
    setLoading(true);
    setProgress('Initiating query...');
    setError(null);
    setResult(null);

    try {
      const response = await executeAsyncQuery(options, {
        onProgress: (status) => {
          setProgress(status.progress || `${status.status}...`);
        },
        onComplete: (status) => {
          setResult(status);
          setLoading(false);
          setProgress('');
        },
        onError: (err) => {
          setError(err);
          setLoading(false);
          setProgress('');
        },
      });

      return response;
    } catch (err) {
      setError(err as Error);
      setLoading(false);
      setProgress('');
      throw err;
    }
  }, []);

  return {
    execute,
    loading,
    progress,
    result,
    error,
    reset: () => {
      setLoading(false);
      setProgress('');
      setResult(null);
      setError(null);
    },
  };
}

// Import React hooks if available (for the React hook)
declare const useState: any;
declare const useCallback: any;