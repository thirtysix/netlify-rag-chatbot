import './style.css'

interface Rag {
  id: string;
  name: string;
  topic: string;
  description?: string;
}

// Helper function to safely parse metadata that could be an object or JSON string
function parseMetadata(metadata: any): any {
  if (!metadata) return {};
  
  // If it's already an object, use it directly
  if (typeof metadata === 'object' && metadata !== null) {
    return metadata;
  }
  
  // If it's a string, try to parse it as JSON
  if (typeof metadata === 'string') {
    // Skip parsing if it looks like "[object Object]" 
    if (metadata === '[object Object]' || metadata.trim() === '') {
      return {};
    }
    
    try {
      return JSON.parse(metadata);
    } catch (error) {
      console.warn('Failed to parse metadata as JSON:', metadata);
      return {};
    }
  }
  
  // For any other type, return empty object
  return {};
}

interface QueryResponse {
  response: string;
  confidence?: number;
  verified?: boolean;
  sources: Array<{
    index: number;
    content: string;
    chunkIndex: number;
    similarity: number;
    metadata?: any;
  }>;
  allMatchingChunks?: Array<{
    index: number;
    content: string;
    chunkIndex: number;
    similarity: number;
    metadata?: any;
    usedInContext: boolean;
    citedInResponse: boolean;
  }>;
}

interface ChatMessage {
  timestamp: Date;
  query: string;
  response: string;
  confidence?: number;
  verified?: boolean;
  sources: any[];
  ragName: string;
  model: string;
  complexity: string;
  outputStyle: string;
}

let chatHistory: ChatMessage[] = [];
let isAuthenticated = false;

const app = document.querySelector<HTMLDivElement>('#app')!

function renderLoginScreen() {
  app.innerHTML = `
    <div class="min-h-screen bg-gray-100 flex items-center justify-center py-12 px-4 sm:px-6 lg:px-8">
      <div class="max-w-md w-full space-y-8">
        <div>
          <h2 class="mt-6 text-center text-3xl font-extrabold text-gray-900">
            Scientific RAG Chatbot
          </h2>
          <p class="mt-2 text-center text-sm text-gray-600">
            Access to research literature analysis
          </p>
        </div>
        <form class="mt-8 space-y-6" id="login-form">
          <div>
            <label for="password" class="sr-only">
              Access Code
            </label>
            <input
              id="password"
              name="password"
              type="password"
              required
              class="appearance-none rounded-md relative block w-full px-3 py-2 border border-gray-300 placeholder-gray-500 text-gray-900 focus:outline-none focus:ring-indigo-500 focus:border-indigo-500 focus:z-10 sm:text-sm"
              placeholder="Enter access code"
            >
          </div>
          <div id="login-error" class="text-red-600 text-sm text-center hidden">
            Invalid access code. Please try again.
          </div>
          <div>
            <button
              type="submit"
              class="group relative w-full flex justify-center py-2 px-4 border border-transparent text-sm font-medium rounded-md text-white bg-indigo-600 hover:bg-indigo-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-indigo-500"
            >
              Access System
            </button>
          </div>
        </form>
        <div class="text-center text-xs text-gray-500">
          <p>This system is for authorized research use only.</p>
        </div>
      </div>
    </div>
  `;

  const loginForm = document.getElementById('login-form') as HTMLFormElement;
  const passwordInput = document.getElementById('password') as HTMLInputElement;
  const errorDiv = document.getElementById('login-error') as HTMLDivElement;

  loginForm.addEventListener('submit', (e) => {
    e.preventDefault();
    const password = passwordInput.value;
    
    // Simple password check - replace with your desired access code
    if (password === 'research2025' || password === 'scirag') {
      isAuthenticated = true;
      localStorage.setItem('auth_token', 'authenticated');
      renderMainApp();
    } else {
      errorDiv.classList.remove('hidden');
      passwordInput.value = '';
      passwordInput.focus();
    }
  });
}

function renderMainApp() {
  app.innerHTML = `
  <div class="min-h-screen bg-gray-100 py-6 px-4">
    <div class="max-w-none mx-auto" style="width: 96%;">
      <div class="flex justify-between items-center mb-6">
        <h1 class="text-3xl font-bold text-gray-800">
          Scientific RAG Chatbot
        </h1>
        <button
          id="logout-btn"
          class="px-4 py-2 text-sm text-gray-600 hover:text-gray-800 hover:bg-gray-200 rounded-md transition-colors"
        >
          Logout
        </button>
      </div>
      
      <div class="grid grid-cols-1 xl:grid-cols-6 gap-6">
        <!-- Left Sidebar - Controls -->
        <div class="xl:col-span-1">
          <div class="bg-white rounded-lg shadow-md p-4 sticky top-6">
            <h2 class="text-lg font-semibold mb-4 text-gray-800">Settings</h2>
            
            <!-- RAG Selection -->
            <div class="mb-4">
              <label for="rag-select" class="block text-sm font-medium text-gray-700 mb-2">
                RAG Dataset:
              </label>
              <select id="rag-select" class="w-full px-3 py-2 text-sm border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500">
                <option value="">Loading...</option>
              </select>
            </div>
            
            <!-- Model Selection -->
            <div class="mb-4">
              <label for="model-select" class="block text-sm font-medium text-gray-700 mb-2">
                AI Model:
              </label>
              <select id="model-select" class="w-full px-3 py-2 text-sm border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500">
                <option value="meta-llama/Llama-4-Maverick-17B-128E-Instruct-FP8" selected>Llama 4 Maverick</option>
                <option value="openai/gpt-oss-120b">GPT OSS 120b</option>
                <option value="deepseek-ai/DeepSeek-V3.1">DeepSeek V3.1</option>
                <option value="Qwen/Qwen3-235B-A22B-Instruct-2507">Qwen3 235B Instruct</option>
                <option value="Qwen/Qwen3-Next-80B-A3B-Instruct">Qwen3 Next 80B</option>
                <option value="moonshotai/Kimi-K2-Instruct-0905">Kimi K2 0905</option>
              </select>
            </div>
            
            <!-- Complexity Selection -->
            <div class="mb-4">
              <label for="complexity-select" class="block text-sm font-medium text-gray-700 mb-2">
                Answer Complexity:
              </label>
              <select id="complexity-select" class="w-full px-3 py-2 text-sm border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500">
                <option value="simple" selected>Simple (concise overview)</option>
                <option value="complex">Complex (comprehensive exploration)</option>
                <option value="interpretive">Interpretive (in-depth analysis)</option>
              </select>
            </div>
            
            <!-- Output Style Selection -->
            <div class="mb-4">
              <label for="output-style-select" class="block text-sm font-medium text-gray-700 mb-2">
                Output Style:
              </label>
              <select id="output-style-select" class="w-full px-3 py-2 text-sm border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500">
                <option value="narrative" selected>Narrative Style (manuscript format)</option>
                <option value="structured">Structured Analysis (5-section format)</option>
              </select>
              <p class="text-xs text-gray-500 mt-1">Choose structured sections or flowing narrative format</p>
            </div>
            
            <!-- Chunks per Paper -->
            <div class="mb-4">
              <label for="chunks-per-paper" class="block text-sm font-medium text-gray-700 mb-2">
                Max Chunks per Paper:
              </label>
              <select id="chunks-per-paper" class="w-full px-3 py-2 text-sm border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500">
                <option value="1">1 chunk (most diverse)</option>
                <option value="2" selected>2 chunks (balanced)</option>
                <option value="3">3 chunks (focused)</option>
                <option value="4">4 chunks (comprehensive)</option>
                <option value="5">5 chunks (maximum)</option>
              </select>
              <p class="text-xs text-gray-500 mt-1">Controls diversity vs depth per paper</p>
            </div>
            
            <!-- Target Tokens -->
            <div class="mb-4">
              <label for="target-tokens" class="block text-sm font-medium text-gray-700 mb-2">
                Target Tokens (optional):
              </label>
              <input 
                type="number" 
                id="target-tokens" 
                min="100" 
                max="10000" 
                step="100"
                placeholder="e.g. 2000"
                class="w-full px-3 py-2 text-sm border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
              >
              <p class="text-xs text-gray-500 mt-1">Fill context to token limit instead of fixed chunk count</p>
            </div>
            
            <!-- Similarity Threshold -->
            <div class="mb-4">
              <label for="similarity-threshold" class="block text-sm font-medium text-gray-700 mb-2">
                Similarity Threshold:
              </label>
              <div class="flex items-center space-x-2">
                <input 
                  type="range" 
                  id="similarity-threshold" 
                  min="0.1" 
                  max="0.9" 
                  step="0.1" 
                  value="0.3"
                  class="flex-1"
                >
                <span id="threshold-value" class="text-sm font-mono w-8">0.3</span>
              </div>
              <p class="text-xs text-gray-500 mt-1">Minimum similarity for chunk display panel</p>
            </div>
            
            <!-- Hybrid Search Weights -->
            <div class="mb-4">
              <h3 class="text-sm font-medium text-gray-700 mb-3">Hybrid Search Weights:</h3>
              
              <!-- Vector Weight -->
              <div class="mb-3">
                <label for="vector-weight" class="block text-xs font-medium text-gray-600 mb-1">
                  Vector Similarity:
                </label>
                <div class="flex items-center space-x-2">
                  <input 
                    type="range" 
                    id="vector-weight" 
                    min="0.0" 
                    max="1.0" 
                    step="0.1" 
                    value="0.7"
                    class="flex-1"
                  >
                  <span id="vector-weight-value" class="text-xs font-mono w-8">0.7</span>
                </div>
              </div>
              
              <!-- Text Weight -->
              <div class="mb-2">
                <label for="text-weight" class="block text-xs font-medium text-gray-600 mb-1">
                  Text Search (BM25):
                </label>
                <div class="flex items-center space-x-2">
                  <input 
                    type="range" 
                    id="text-weight" 
                    min="0.0" 
                    max="1.0" 
                    step="0.1" 
                    value="0.3"
                    class="flex-1"
                  >
                  <span id="text-weight-value" class="text-xs font-mono w-8">0.3</span>
                </div>
              </div>
              
              <p class="text-xs text-gray-500 mt-1">Balance between semantic similarity and exact text matching</p>
            </div>
            
            <!-- Verification Toggle -->
            <div class="mb-4">
              <label class="flex items-center cursor-pointer">
                <input 
                  type="checkbox" 
                  id="verification-toggle"
                  class="h-4 w-4 text-blue-600 border-gray-300 rounded focus:ring-2 focus:ring-blue-500"
                >
                <span class="ml-2 text-sm font-medium text-gray-700">Enable Response Verification</span>
              </label>
              <p class="text-xs text-gray-500 mt-1">Verify claims against sources (slower, but more accurate)</p>
            </div>
            
            <!-- Export Button -->
            <button 
              id="export-btn" 
              class="w-full bg-green-600 text-white py-2 px-4 rounded-md hover:bg-green-700 focus:outline-none focus:ring-2 focus:ring-green-500 text-sm disabled:opacity-50"
            >
              Export Chat to HTML
            </button>
          </div>
        </div>
        
        <!-- Main Chat Area -->
        <div class="xl:col-span-3">
          <!-- Question Input -->
          <div class="bg-white rounded-lg shadow-md p-6 mb-6">
            <div class="mb-4">
              <label for="query-input" class="block text-sm font-medium text-gray-700 mb-2">
                Ask a Question:
              </label>
              <textarea 
                id="query-input" 
                class="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500" 
                rows="3" 
                placeholder="Ask a question about the selected scientific topic..."
              ></textarea>
            </div>
            
            <button 
              id="submit-btn" 
              class="w-full bg-blue-600 text-white py-2 px-4 rounded-md hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:opacity-50"
            >
              Ask Question
            </button>
          </div>
          
          <!-- Loading -->
          <div id="loading-container" class="bg-white rounded-lg shadow-md p-6 mb-6 hidden">
            <div class="flex items-center justify-center">
              <div class="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
              <span class="ml-3 text-gray-600">Processing your question...</span>
            </div>
          </div>
          
          <!-- Error -->
          <div id="error-container" class="bg-red-50 border border-red-200 rounded-lg p-6 mb-6 hidden">
            <h3 class="text-lg font-semibold mb-3 text-red-800">Error:</h3>
            <div id="error-content" class="text-red-700"></div>
          </div>
          
          <!-- Chat History -->
          <div id="chat-history" class="space-y-6">
            <!-- Chat messages will be inserted here -->
          </div>
        </div>
        
        <!-- Right Sidebar - Matching Chunks Panel -->
        <div class="xl:col-span-2">
          <div class="bg-white rounded-lg shadow-md p-4 sticky top-6">
            <div class="flex justify-between items-center mb-4">
              <h2 class="text-lg font-semibold text-gray-800">Matching Chunks</h2>
              <button 
                id="export-chunks-btn" 
                class="text-sm bg-gray-600 text-white py-1 px-3 rounded-md hover:bg-gray-700 focus:outline-none focus:ring-2 focus:ring-gray-500 disabled:opacity-50"
                disabled
              >
                Export Chunks
              </button>
            </div>
            <div id="chunks-info" class="text-sm text-gray-600 mb-4 hidden">
              Found <span id="chunks-count">0</span> chunks above similarity threshold
            </div>
            <div id="chunks-container" class="space-y-3 max-h-[48rem] overflow-y-auto">
              <div class="text-gray-500 text-sm text-center py-8">
                Submit a question to see matching chunks
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  </div>
`;

  // Initialize the main app functionality
  initializeApp();
}

// Initialize authentication check
function init() {
  // Check for existing session (basic implementation)
  const authToken = localStorage.getItem('auth_token');
  if (authToken === 'authenticated') {
    isAuthenticated = true;
    renderMainApp();
  } else {
    renderLoginScreen();
  }
}

// Load RAG datasets
async function loadRags() {
  try {
    const response = await fetch('/.netlify/functions/rags')
    const data = await response.json()
    
    const ragSelect = document.getElementById('rag-select') as HTMLSelectElement
    ragSelect.innerHTML = '<option value="">Select a RAG dataset...</option>'
    
    data.rags.forEach((rag: Rag) => {
      const option = document.createElement('option')
      option.value = rag.id.toString()
      option.textContent = `${rag.name} (${rag.topic})`
      ragSelect.appendChild(option)
    })
  } catch (error) {
    console.error('Error loading RAGs:', error)
    const ragSelect = document.getElementById('rag-select') as HTMLSelectElement
    ragSelect.innerHTML = '<option value="">Error loading datasets</option>'
  }
}

// Create PMID hyperlinks
function createPMIDLinks(text: string): string {
  return text.replace(/PMID:?\s*(\d+)/gi, '<a href="https://pubmed.ncbi.nlm.nih.gov/$1" target="_blank" class="text-blue-600 hover:text-blue-800 underline">PMID: $1</a>')
}

// Simple markdown formatter for response text
function formatMarkdown(text: string): string {
  return text
    // First handle headers before converting newlines
    // Match headers at start of line or after double newline: ## Header Text
    .replace(/(^|(\n\n))#{1,6}\s*([^\n]+)/gm, '$1<strong>$3</strong>')
    // Convert line breaks to HTML  
    .replace(/\n/g, '<br>')
    // Format standalone section headers (lines ending with colon)
    .replace(/^([^<#]+):(?=<br>|$)/gm, '<strong>$1:</strong>')
    // Format numbered sections: 1. TEXT -> <strong>1. TEXT</strong>  
    .replace(/^(\d+\.)\s*([^<#]+?)(?=<br>|$)/gm, '<strong>$1 $2</strong>')
    // Bold text: **text** -> <strong>text</strong>
    .replace(/\*\*([^*<]+?)\*\*/g, '<strong>$1</strong>')
    // Italic text: *text* -> <em>text</em> (simple version)
    .replace(/\*([^*<]+?)\*/g, '<em>$1</em>')
}

// Add chat message to history
function addChatMessage(chatMessage: ChatMessage) {
  chatHistory.push(chatMessage)
  
  const chatHistoryContainer = document.getElementById('chat-history')!
  const messageDiv = document.createElement('div')
  messageDiv.className = 'bg-white rounded-lg shadow-md p-6'
  
  messageDiv.innerHTML = `
    <div class="border-b pb-4 mb-4">
      <div class="flex justify-between items-start mb-2">
        <h3 class="text-lg font-semibold text-gray-800">Question:</h3>
        <div class="text-sm text-gray-500">
          ${chatMessage.timestamp.toLocaleString()} | ${chatMessage.model} | ${chatMessage.complexity}
          ${chatMessage.verified ? ` | Verified: ${chatMessage.confidence}%` : ''}
        </div>
      </div>
      <p class="text-gray-700">${chatMessage.query}</p>
    </div>
    
    <div class="mb-4">
      <div class="flex items-center justify-between mb-3">
        <h4 class="text-md font-semibold text-gray-800">Response:</h4>
        ${chatMessage.verified && chatMessage.confidence !== undefined ? `
          <div class="px-3 py-1 rounded-full text-sm font-medium ${
            chatMessage.confidence >= 80 ? 'bg-green-100 text-green-800' :
            chatMessage.confidence >= 60 ? 'bg-yellow-100 text-yellow-800' :
            'bg-red-100 text-red-800'
          }">
            ${chatMessage.confidence >= 80 ? '✓' : chatMessage.confidence >= 60 ? '⚠' : '⚠'} Confidence: ${chatMessage.confidence}%
          </div>
        ` : ''}
      </div>
      <div class="prose max-w-none text-gray-800 leading-relaxed">
        ${createPMIDLinks(formatMarkdown(chatMessage.response))}
      </div>
    </div>
    
    ${chatMessage.sources.length > 0 ? `
      <div class="border-t pt-4">
        <h4 class="text-md font-semibold mb-3 text-gray-700">Sources:</h4>
        <div class="space-y-3">
          ${chatMessage.sources.map((source, index) => {
            const metadata = source.metadata || {};
            const pmid = metadata.pmid || 'Unknown';
            return `
              <div class="bg-gray-50 p-4 rounded-lg">
                <div class="text-sm font-medium text-gray-600 mb-2 flex justify-between">
                  <span>Source ${source.index} (Similarity: ${(source.similarity * 100).toFixed(1)}%)</span>
                  <a href="https://pubmed.ncbi.nlm.nih.gov/${pmid}" target="_blank" class="text-blue-600 hover:text-blue-800 underline">
                    PMID: ${pmid}
                  </a>
                </div>
                <div class="text-sm text-gray-800">${source.content}</div>
                ${metadata.title ? `<div class="text-xs text-gray-600 mt-2 italic">"${metadata.title}"</div>` : ''}
              </div>
            `;
          }).join('')}
        </div>
      </div>
    ` : ''}
  `
  
  chatHistoryContainer.appendChild(messageDiv)
  
  // Scroll to new message
  messageDiv.scrollIntoView({ behavior: 'smooth', block: 'start' })
}

// Export chat to HTML
function exportChatToHTML() {
  if (chatHistory.length === 0) {
    alert('No chat history to export.')
    return
  }
  
  const html = `
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Scientific RAG Chat Export</title>
    <style>
        body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', 'Roboto', sans-serif; margin: 40px; line-height: 1.6; }
        .chat-message { background: #f9f9f9; border-radius: 8px; padding: 20px; margin-bottom: 20px; border-left: 4px solid #3b82f6; }
        .question { font-weight: bold; color: #1f2937; margin-bottom: 10px; }
        .response { margin-bottom: 15px; }
        .sources { background: #f3f4f6; border-radius: 6px; padding: 15px; margin-top: 15px; }
        .source-item { margin-bottom: 10px; padding: 10px; background: white; border-radius: 4px; }
        .metadata { font-size: 0.9em; color: #6b7280; margin-bottom: 10px; }
        .pmid-link { color: #3b82f6; text-decoration: none; }
        .pmid-link:hover { text-decoration: underline; }
        h1 { color: #1f2937; border-bottom: 2px solid #e5e7eb; padding-bottom: 10px; }
        h2 { color: #374151; }
    </style>
</head>
<body>
    <h1>Scientific RAG Chat Export</h1>
    <p>Exported on: ${new Date().toLocaleString()}</p>
    
    ${chatHistory.map((chat, index) => `
        <div class="chat-message">
            <div class="metadata">
                Chat ${index + 1} | ${chat.timestamp.toLocaleString()} | Model: ${chat.model} | Complexity: ${chat.complexity} | Style: ${chat.outputStyle} | RAG: ${chat.ragName}
            </div>
            <div class="question">Q: ${chat.query}</div>
            <div class="response">
                <strong>Response:</strong><br>
                ${createPMIDLinks(formatMarkdown(chat.response))}
            </div>
            
            ${chat.sources.length > 0 ? `
                <div class="sources">
                    <strong>Sources:</strong>
                    ${chat.sources.map(source => {
                        const metadata = source.metadata || {};
                        const pmid = metadata.pmid || 'Unknown';
                        return `
                            <div class="source-item">
                                <div style="font-size: 0.9em; color: #6b7280; margin-bottom: 5px;">
                                    Source ${source.index} (Similarity: ${(source.similarity * 100).toFixed(1)}%) | 
                                    <a href="https://pubmed.ncbi.nlm.nih.gov/${pmid}" target="_blank" class="pmid-link">PMID: ${pmid}</a>
                                </div>
                                <div>${source.content}</div>
                                ${metadata.title ? `<div style="font-style: italic; font-size: 0.9em; color: #6b7280; margin-top: 5px;">"${metadata.title}"</div>` : ''}
                            </div>
                        `;
                    }).join('')}
                </div>
            ` : ''}
        </div>
    `).join('')}
</body>
</html>
  `
  
  const blob = new Blob([html], { type: 'text/html' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `rag-chat-export-${new Date().toISOString().split('T')[0]}.html`
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  URL.revokeObjectURL(url)
}

// Display matching chunks in the right panel
function displayMatchingChunks(chunks: any[]) {
  const chunksContainer = document.getElementById('chunks-container')!
  const chunksInfo = document.getElementById('chunks-info')!
  const chunksCount = document.getElementById('chunks-count')!
  const exportChunksBtn = document.getElementById('export-chunks-btn') as HTMLButtonElement
  
  // Update info and enable export
  chunksCount.textContent = chunks.length.toString()
  chunksInfo.classList.remove('hidden')
  exportChunksBtn.disabled = chunks.length === 0
  
  // Clear existing chunks
  chunksContainer.innerHTML = ''
  
  if (chunks.length === 0) {
    chunksContainer.innerHTML = '<div class="text-gray-500 text-sm text-center py-8">No chunks above similarity threshold</div>'
    return
  }
  
  // Display chunks
  chunks.forEach((chunk, index) => {
    const metadata = parseMetadata(chunk.metadata);

    const chunkDiv = document.createElement('div')
    const borderClass = chunk.usedInContext
      ? 'border border-green-300 bg-green-50'
      : 'border border-gray-200 hover:bg-gray-50'
    chunkDiv.className = `${borderClass} rounded-md p-3`

    const pmid = (metadata as any).pmid || 'Unknown'
    const title = (metadata as any).title || 'Unknown Title'
    const authors = (metadata as any).authors || ''
    const year = (metadata as any).year || ''
    const similarity = (chunk.similarity * 100).toFixed(1)

    // Helper function to shorten authors display
    function shortenAuthors(authors: string): string {
      if (!authors) return '';
      const authorList = authors.split(',').map(a => a.trim());
      if (authorList.length === 1) {
        const parts = authorList[0].split(' ');
        return parts.length > 1 ? `${parts[parts.length - 1]} ${parts[0].charAt(0)}` : authorList[0];
      }
      if (authorList.length <= 3) {
        return authorList.map(a => {
          const parts = a.split(' ');
          return parts.length > 1 ? parts[parts.length - 1] : a;
        }).join(', ');
      }
      const firstAuthor = authorList[0].split(' ');
      const lastName = firstAuthor.length > 1 ? firstAuthor[firstAuthor.length - 1] : authorList[0];
      return `${lastName} et al.`;
    }

    // Format author and year display
    const authorYear = [];
    if (authors) authorYear.push(shortenAuthors(authors));
    if (year) authorYear.push(year);
    const authorYearText = authorYear.length > 0 ? ` • ${authorYear.join(', ')}` : '';

    // Add checkmark icon only for chunks cited in response
    const citedIcon = chunk.citedInResponse
      ? '<span class="inline-flex items-center text-green-600 mr-1" title="Cited in response">✓</span>'
      : ''

    chunkDiv.innerHTML = `
      <div class="flex justify-between items-start mb-2">
        <div class="flex items-center">
          ${citedIcon}
          <a href="https://pubmed.ncbi.nlm.nih.gov/${pmid}" target="_blank" class="text-xs font-medium text-blue-600 hover:text-blue-800" style="text-decoration: none;">PMID: ${pmid}</a>
          <span class="text-xs text-gray-500">${authorYearText}</span>
        </div>
        <div class="text-xs text-gray-500">${similarity}% similar</div>
      </div>
      <div class="text-sm font-medium text-gray-800 mb-2 line-clamp-2">${title}</div>
      <div class="text-xs text-gray-600 line-clamp-3">${chunk.content.substring(0, 200)}...</div>
    `
    
    chunksContainer.appendChild(chunkDiv)
  })
  
  // Store chunks for export
  ;(window as any).currentMatchingChunks = chunks
}

// Export matching chunks to HTML
function exportMatchingChunks() {
  const chunks = (window as any).currentMatchingChunks || []
  
  if (chunks.length === 0) {
    alert('No chunks to export')
    return
  }
  
  const timestamp = new Date().toISOString().split('T')[0]
  const chunksHtml = chunks.map((chunk: any, index: number) => {
    const metadata = parseMetadata(chunk.metadata);
    
    const pmid = (metadata as any).pmid || 'Unknown'
    const title = (metadata as any).title || 'Unknown Title'
    const authors = (metadata as any).authors || 'Unknown Authors'
    const journal = (metadata as any).journal || 'Unknown Journal'
    const year = (metadata as any).year || 'Unknown Year'
    const similarity = (chunk.similarity * 100).toFixed(1)
    
    const pmidUrl = pmid && pmid !== 'Unknown' ? `https://pubmed.ncbi.nlm.nih.gov/${pmid}` : '#'
    const pmidLink = pmid && pmid !== 'Unknown' ? `<a href="${pmidUrl}" target="_blank" style="color: #2563eb; text-decoration: none;">PMID: ${pmid}</a>` : `PMID: ${pmid}`
    
    // Add context and citation indicators
    const contextIndicator = chunk.usedInContext 
      ? '<span style="color: #16a34a; font-weight: bold; margin-right: 8px;" title="Used in LLM context">🔍 In Context</span>'
      : ''
    const citationIndicator = chunk.citedInResponse 
      ? '<span style="color: #16a34a; font-weight: bold; margin-right: 8px;" title="Cited in response">✓ Cited</span>'
      : ''
    const borderStyle = chunk.usedInContext 
      ? 'border: 2px solid #16a34a; background-color: #f0fdf4;' 
      : 'border: 1px solid #e5e7eb;'
    
    return `
      <div style="${borderStyle} border-radius: 8px; padding: 16px; margin-bottom: 16px;">
        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px;">
          <div style="display: flex; align-items: center;">
            ${contextIndicator}${citationIndicator}
            <strong>${pmidLink}</strong>
          </div>
          <span style="color: #6b7280; font-size: 14px;">Similarity: ${similarity}%</span>
        </div>
        <h3 style="font-size: 16px; font-weight: bold; margin-bottom: 8px;">${title}</h3>
        <p style="color: #6b7280; font-size: 14px; margin-bottom: 8px;">
          <strong>Authors:</strong> ${authors}<br>
          <strong>Journal:</strong> ${journal} (${year})
        </p>
        <div style="background-color: #f9fafb; padding: 12px; border-radius: 6px;">
          <p>${chunk.content}</p>
        </div>
      </div>
    `
  }).join('')
  
  const html = `
    <!DOCTYPE html>
    <html>
    <head>
      <title>Matching Chunks Export - ${timestamp}</title>
      <meta charset="utf-8">
      <style>
        body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 800px; margin: 0 auto; padding: 20px; }
        .header { border-bottom: 2px solid #e5e7eb; padding-bottom: 20px; margin-bottom: 20px; }
      </style>
    </head>
    <body>
      <div class="header">
        <h1>Matching Chunks Export</h1>
        <p>Exported on: ${new Date().toLocaleString()}</p>
        <p>Total chunks: ${chunks.length}</p>
      </div>
      ${chunksHtml}
    </body>
    </html>
  `
  
  const blob = new Blob([html], { type: 'text/html' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `matching-chunks-${timestamp}.html`
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  URL.revokeObjectURL(url)
}

// Query the selected RAG using async background functions
async function queryRAG(ragId: string, query: string, model: string, complexity: string, retrievalStrategy: string, enableVerification: boolean = false, maxChunksPerPaper: number = 2, targetTokens?: number, similarityThreshold: number = 0.3, vectorWeight: number = 0.7, textWeight: number = 0.3, outputStyle: string = "structured") {
  const loadingContainer = document.getElementById('loading-container')!
  const errorContainer = document.getElementById('error-container')!
  const loadingText = loadingContainer.querySelector('span')!

  // Hide error and show loading
  errorContainer.classList.add('hidden')
  loadingContainer.classList.remove('hidden')

  try {
    // Step 1: Initiate the query
    loadingText.textContent = 'Initiating query...'

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
    console.log(`Query initiated with job ID: ${jobId}`)

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
          sources: (status.sources || []).map((source: any) => {
            const metadata = parseMetadata(source.metadata);
            return {
              ...source,
              metadata
            };
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

        return // Exit the function successfully

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

// Initialize app functionality
function initializeApp() {
  loadRags();
  
  // Event listeners
  // Logout functionality
  document.getElementById('logout-btn')?.addEventListener('click', () => {
    localStorage.removeItem('auth_token');
    isAuthenticated = false;
    renderLoginScreen();
  });
document.getElementById('submit-btn')?.addEventListener('click', () => {
  const ragSelect = document.getElementById('rag-select') as HTMLSelectElement
  const queryInput = document.getElementById('query-input') as HTMLTextAreaElement
  const modelSelect = document.getElementById('model-select') as HTMLSelectElement
  const complexitySelect = document.getElementById('complexity-select') as HTMLSelectElement
  const chunksPerPaperSelect = document.getElementById('chunks-per-paper') as HTMLSelectElement
  const targetTokensInput = document.getElementById('target-tokens') as HTMLInputElement
  const similarityThresholdInput = document.getElementById('similarity-threshold') as HTMLInputElement
  const verificationToggle = document.getElementById('verification-toggle') as HTMLInputElement
  const vectorWeightInput = document.getElementById('vector-weight') as HTMLInputElement
  const textWeightInput = document.getElementById('text-weight') as HTMLInputElement
  const outputStyleSelect = document.getElementById('output-style-select') as HTMLSelectElement
  
  if (!ragSelect.value || !queryInput.value.trim()) {
    alert('Please select a RAG dataset and enter a question.')
    return
  }
  
  const targetTokens = targetTokensInput.value ? parseInt(targetTokensInput.value) : undefined
  const similarityThreshold = parseFloat(similarityThresholdInput.value)
  const vectorWeight = parseFloat(vectorWeightInput.value)
  const textWeight = parseFloat(textWeightInput.value)
  const outputStyle = outputStyleSelect.value || "structured"
  
  queryRAG(
    ragSelect.value, 
    queryInput.value.trim(),
    modelSelect.value,
    complexitySelect.value,
    "enhanced", // Always use enhanced strategy
    verificationToggle.checked,
    parseInt(chunksPerPaperSelect.value),
    targetTokens,
    similarityThreshold,
    vectorWeight,
    textWeight,
    outputStyle
  )
})

document.getElementById('export-btn')?.addEventListener('click', exportChatToHTML)
document.getElementById('export-chunks-btn')?.addEventListener('click', exportMatchingChunks)

// Allow Enter key to submit (with Shift+Enter for new line)
document.getElementById('query-input')?.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault()
    document.getElementById('submit-btn')?.click()
  }
})

// Update similarity threshold display
document.getElementById('similarity-threshold')?.addEventListener('input', (e) => {
  const value = (e.target as HTMLInputElement).value
  const display = document.getElementById('threshold-value')!
  display.textContent = value
})

// Update weight displays and keep them synchronized
document.getElementById('vector-weight')?.addEventListener('input', (e) => {
  const value = parseFloat((e.target as HTMLInputElement).value)
  const display = document.getElementById('vector-weight-value')!
  const textWeightSlider = document.getElementById('text-weight') as HTMLInputElement
  const textWeightDisplay = document.getElementById('text-weight-value')!
  
  display.textContent = value.toFixed(1)
  
  // Auto-adjust text weight to maintain sum = 1.0
  const textWeight = Math.max(0, Math.min(1, 1 - value))
  textWeightSlider.value = textWeight.toString()
  textWeightDisplay.textContent = textWeight.toFixed(1)
})

document.getElementById('text-weight')?.addEventListener('input', (e) => {
  const value = parseFloat((e.target as HTMLInputElement).value)
  const display = document.getElementById('text-weight-value')!
  const vectorWeightSlider = document.getElementById('vector-weight') as HTMLInputElement
  const vectorWeightDisplay = document.getElementById('vector-weight-value')!
  
  display.textContent = value.toFixed(1)
  
  // Auto-adjust vector weight to maintain sum = 1.0
  const vectorWeight = Math.max(0, Math.min(1, 1 - value))
  vectorWeightSlider.value = vectorWeight.toString()
  vectorWeightDisplay.textContent = vectorWeight.toFixed(1)
})

  console.log('Enhanced RAG Chatbot initialized')
}

// Initialize the application
init()