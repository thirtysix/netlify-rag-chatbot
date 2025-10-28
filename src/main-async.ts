// Import the existing main.ts content but modify the queryRAG function to use async endpoints
import './style.css'

// ... [All the interfaces and helper functions remain the same] ...

// Modified queryRAG function to use async endpoints
async function queryRAGAsync(ragId: string, query: string, model: string, complexity: string, retrievalStrategy: string, enableVerification: boolean = false, maxChunksPerPaper: number = 2, targetTokens?: number, similarityThreshold: number = 0.3, vectorWeight: number = 0.7, textWeight: number = 0.3, outputStyle: string = "structured") {
  const loadingContainer = document.getElementById('loading-container')!
  const errorContainer = document.getElementById('error-container')!
  const loadingText = loadingContainer.querySelector('span')!

  // Hide error and show loading
  errorContainer.classList.add('hidden')
  loadingContainer.classList.remove('hidden')

  try {
    // Step 1: Create job and trigger background processing directly
    loadingText.textContent = 'Creating query job...'

    // Create the job first by calling query-initiate, but don't rely on it for background processing
    const initResponse = await fetch('/.netlify/functions/query-initiate', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ ragId, query, model, complexity, retrievalStrategy, enableVerification, maxChunksPerPaper, targetTokens, similarityThreshold, vectorWeight, textWeight, outputStyle }),
    })

    if (!initResponse.ok) {
      const errorData = await initResponse.json()
      throw new Error(errorData.error || `HTTP error! status: ${initResponse.status}`)
    }

    const { jobId } = await initResponse.json()
    console.log(`Query job created with ID: ${jobId}`)

    // Step 1.5: Trigger background processing directly
    loadingText.textContent = 'Starting background processing...'

    const backgroundResponse = await fetch('/.netlify/functions/query-process-background', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ jobId, ragId, query, model, complexity, retrievalStrategy, enableVerification, maxChunksPerPaper, targetTokens, similarityThreshold, vectorWeight, textWeight, outputStyle }),
    })

    if (!backgroundResponse.ok) {
      throw new Error(`Failed to start background processing: ${backgroundResponse.statusText}`)
    }

    console.log(`Background processing started for job: ${jobId}`)

    // Step 2: Poll for results
    let pollCount = 0
    const maxPolls = 90 // 3 minutes max
    const pollInterval = 2000 // 2 seconds

    while (pollCount < maxPolls) {
      await new Promise(resolve => setTimeout(resolve, pollInterval))
      pollCount++

      const statusResponse = await fetch(`/.netlify/functions/query-status?jobId=${jobId}`)

      if (!statusResponse.ok) {
        throw new Error(`Status check failed: ${statusResponse.status}`)
      }

      const status = await statusResponse.json()

      // Update loading message
      const elapsed = (pollCount * pollInterval / 1000).toFixed(0)

      if (status.status === 'completed') {
        // Success! Process the response
        console.log('Query completed successfully')

        // Hide loading
        loadingContainer.classList.add('hidden')

        // Get RAG name
        const ragSelect = document.getElementById('rag-select') as HTMLSelectElement
        const ragName = ragSelect.selectedOptions[0]?.textContent || 'Unknown RAG'

        // Add to chat history
        const chatMessage: ChatMessage = {
          timestamp: new Date(),
          query,
          response: status.response,
          confidence: status.confidence,
          verified: status.verified,
          sources: status.sources.map((source: any) => {
            const metadata = parseMetadata(source.metadata)
            return {
              ...source,
              metadata
            }
          }),
          ragName,
          model,
          complexity,
          outputStyle
        }

        addChatMessage(chatMessage)

        // Display matching chunks in right panel
        displayMatchingChunks(status.allMatchingChunks || [])

        // Clear input
        const queryInput = document.getElementById('query-input') as HTMLTextAreaElement
        queryInput.value = ''

        return // Success!

      } else if (status.status === 'failed') {
        throw new Error(status.error || 'Query processing failed')

      } else if (status.status === 'processing') {
        loadingText.textContent = `${status.progress || 'Processing query'} (${elapsed}s elapsed)...`

      } else {
        loadingText.textContent = `Waiting for processing to start (${elapsed}s elapsed)...`
      }
    }

    // Timeout reached
    throw new Error('Query processing timeout - the query is taking longer than expected. Please try again.')

  } catch (error) {
    console.error('Error querying RAG:', error)

    // Hide loading and show error
    loadingContainer.classList.add('hidden')
    errorContainer.classList.remove('hidden')

    const errorContent = document.getElementById('error-content')!
    errorContent.textContent = `Failed to process your question: ${error instanceof Error ? error.message : 'Unknown error'}`
  }
}

// Export the async version
export { queryRAGAsync }