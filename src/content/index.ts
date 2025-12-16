/**
 * Content Script
 * 
 * Injected into SCRI trial pages to:
 * - Add tabbed interface with AI Chat and original Search
 * - Replace the main search area with enhanced experience
 * - Bridge communication with background worker
 */

import type { ExtensionMessage, ChatMessage } from '@/types';

// State
let chatMessages: ChatMessage[] = [];
let isLoading = false;
let originalSearchContent: HTMLElement | null = null;

/**
 * Initialize the content script
 */
function init(): void {
  console.log('SCRI Trial Agent content script loaded');
  
  // Try to find search-container immediately
  const existing = document.querySelector('.search-container');
  if (existing) {
    injectTabbedInterface();
    return;
  }

  // Otherwise, watch for it to appear (dynamic rendering)
  watchForSearchContainer();
}

/**
 * Watch for .search-container to appear in the DOM
 */
function watchForSearchContainer(): void {
  let injected = false;
  
  const observer = new MutationObserver((mutations, obs) => {
    if (injected) return;
    
    const searchContainer = document.querySelector('.search-container');
    if (searchContainer) {
      console.log('SCRI Agent: Found .search-container, injecting interface');
      injected = true;
      obs.disconnect();
      injectTabbedInterface();
    }
  });

  // Observe the entire document for added nodes
  observer.observe(document.body, {
    childList: true,
    subtree: true,
  });

  // Timeout after 30 seconds to avoid infinite watching
  setTimeout(() => {
    if (!injected) {
      console.warn('SCRI Agent: .search-container not found after 30s, giving up');
      observer.disconnect();
    }
  }, 30000);
}

/**
 * Find the search-container and replace its content with tabbed interface
 */
function injectTabbedInterface(): void {
  // Target the search-container specifically
  const searchContainer = document.querySelector('.search-container') as HTMLElement;
  
  if (!searchContainer) {
    console.warn('SCRI Agent: Could not find .search-container');
    return;
  }

  // Store original content by moving all child nodes to a document fragment
  // This preserves event listeners and component state
  originalSearchContent = document.createElement('div');
  while (searchContainer.firstChild) {
    originalSearchContent.appendChild(searchContainer.firstChild);
  }

  // Now inject the tabbed interface into the empty container
  createTabbedInterface(searchContainer);
}

/**
 * Create the tabbed interface
 */
function createTabbedInterface(searchContainer: HTMLElement): void {
  // Replace the container's content entirely
  searchContainer.innerHTML = `
    <div id="scri-agent-wrapper">
      <div class="scri-agent-tabs-container">
        <!-- Tab Navigation -->
        <div class="scri-agent-tab-nav">
          <button class="scri-agent-tab-btn active" data-tab="chat">
            <span class="scri-agent-tab-icon">💬</span>
            <span>AI Navigator</span>
          </button>
          <button class="scri-agent-tab-btn" data-tab="search">
            <span class="scri-agent-tab-icon">🔍</span>
            <span>Search Trials</span>
          </button>
        </div>

        <!-- Tab Content -->
        <div class="scri-agent-tab-content">
          <!-- Chat Tab -->
          <div id="scri-agent-chat-tab" class="scri-agent-tab-panel active">
            <div class="scri-agent-chat-container" id="scri-agent-chat-container">
              <!-- Welcome State (centered) -->
              <div class="scri-agent-welcome" id="scri-agent-welcome">
                <div class="scri-agent-welcome-icon">🔬</div>
                <h1 class="scri-agent-welcome-title">Find Your Clinical Trial</h1>
                <p class="scri-agent-welcome-subtitle">I'll help you discover SCRI trials that match your needs</p>
                
                <div class="scri-agent-welcome-input-area">
                  <textarea 
                    id="scri-agent-input" 
                    class="scri-agent-input" 
                    placeholder="Tell me about your cancer type and location..."
                    rows="1"
                  ></textarea>
                  <button id="scri-agent-send" class="scri-agent-send-btn" aria-label="Send message">
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="2" style="width: 20px !important; height: 20px !important; min-width: 20px; min-height: 20px;">
                      <line x1="22" y1="2" x2="11" y2="13"></line>
                      <polygon points="22 2 15 22 11 13 2 9 22 2"></polygon>
                    </svg>
                  </button>
                </div>
                
                <div class="scri-agent-suggestions">
                  <button class="scri-agent-suggestion" data-query="I have breast cancer and live in Nashville, TN (37203)">
                    🎀 Breast cancer near Nashville
                  </button>
                  <button class="scri-agent-suggestion" data-query="I have lung cancer and live in Denver, CO (80202)">
                    🫁 Lung cancer near Denver
                  </button>
                  <button class="scri-agent-suggestion" data-query="What types of cancer do you have trials for?">
                    📋 See all cancer types
                  </button>
                </div>
              </div>
              
              <!-- Chat State (after first message) -->
              <div class="scri-agent-chat-active" id="scri-agent-chat-active" style="display: none;">
                <div id="scri-agent-messages" class="scri-agent-messages">
                  <!-- Messages will be inserted here -->
                </div>
                
                <div class="scri-agent-input-area-bottom">
                  <textarea 
                    id="scri-agent-input-active" 
                    class="scri-agent-input" 
                    placeholder="Ask a follow-up question..."
                    rows="1"
                  ></textarea>
                  <button id="scri-agent-send-active" class="scri-agent-send-btn" aria-label="Send message">
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="2" style="width: 20px !important; height: 20px !important; min-width: 20px; min-height: 20px;">
                      <line x1="22" y1="2" x2="11" y2="13"></line>
                      <polygon points="22 2 15 22 11 13 2 9 22 2"></polygon>
                    </svg>
                  </button>
                </div>
              </div>
            </div>
          </div>

          <!-- Search Tab (Original Content) -->
          <div id="scri-agent-search-tab" class="scri-agent-tab-panel">
            <div id="scri-agent-original-content"></div>
          </div>
        </div>
      </div>
    </div>
  `;

  // Move original content to search tab (preserving event listeners)
  const originalContentContainer = document.getElementById('scri-agent-original-content');
  if (originalContentContainer && originalSearchContent) {
    // Move all child nodes from the saved content to the container
    while (originalSearchContent.firstChild) {
      originalContentContainer.appendChild(originalSearchContent.firstChild);
    }
  }

  // Attach event listeners
  attachEventListeners();
  
  // Check for API key and show setup prompt if needed
  checkApiKeyStatus();
}

/**
 * Check if API key is configured and update UI accordingly
 */
async function checkApiKeyStatus(): Promise<void> {
  try {
    const response = await chrome.runtime.sendMessage({
      type: 'GET_API_KEY',
      payload: {},
    });
    
    if (!response?.hasKey) {
      showApiKeySetupPrompt();
    }
  } catch (error) {
    console.error('Failed to check API key status:', error);
    showApiKeySetupPrompt();
  }
}

/**
 * Show a prompt to set up the API key
 */
function showApiKeySetupPrompt(): void {
  const welcome = document.getElementById('scri-agent-welcome');
  if (!welcome) return;
  
  // Replace welcome content with setup prompt
  welcome.innerHTML = `
    <div class="scri-agent-welcome-icon">🔑</div>
    <h1 class="scri-agent-welcome-title">One-Time Setup</h1>
    <p class="scri-agent-welcome-subtitle">Enter your OpenAI API key to enable the AI Trial Navigator</p>
    
    <div class="scri-agent-api-key-form">
      <div class="scri-agent-api-key-input-wrapper">
        <input 
          type="password" 
          id="scri-agent-api-key-input" 
          class="scri-agent-api-key-input"
          placeholder="sk-proj-..."
          autocomplete="off"
        />
        <button id="scri-agent-toggle-key" class="scri-agent-toggle-key" type="button" aria-label="Show/hide key">
          👁️
        </button>
      </div>
      <button id="scri-agent-save-key" class="scri-agent-save-key-btn">
        Save & Start Chatting
      </button>
      <p id="scri-agent-key-error" class="scri-agent-key-error" style="display: none;"></p>
    </div>
    
    <p class="scri-agent-key-help">
      Don't have an API key? <a href="https://platform.openai.com/api-keys" target="_blank">Get one here</a> (requires OpenAI account)
    </p>
    <p class="scri-agent-key-privacy">
      🔒 Your key is stored locally in your browser and never sent anywhere except OpenAI.
    </p>
  `;
  
  // Add event listeners
  const input = document.getElementById('scri-agent-api-key-input') as HTMLInputElement;
  const saveBtn = document.getElementById('scri-agent-save-key');
  const toggleBtn = document.getElementById('scri-agent-toggle-key');
  const errorEl = document.getElementById('scri-agent-key-error');
  
  // Toggle password visibility
  toggleBtn?.addEventListener('click', () => {
    if (input.type === 'password') {
      input.type = 'text';
      toggleBtn.textContent = '🙈';
    } else {
      input.type = 'password';
      toggleBtn.textContent = '👁️';
    }
  });
  
  // Save key
  const saveKey = async () => {
    const key = input.value.trim();
    
    if (!key) {
      if (errorEl) {
        errorEl.textContent = 'Please enter your API key';
        errorEl.style.display = 'block';
      }
      return;
    }
    
    if (!key.startsWith('sk-')) {
      if (errorEl) {
        errorEl.textContent = 'Invalid API key format. Keys should start with "sk-"';
        errorEl.style.display = 'block';
      }
      return;
    }
    
    // Disable button while saving
    if (saveBtn) {
      saveBtn.textContent = 'Saving...';
      (saveBtn as HTMLButtonElement).disabled = true;
    }
    
    try {
      await chrome.runtime.sendMessage({
        type: 'SET_API_KEY',
        payload: { key },
      });
      
      // Reload to show the normal welcome screen
      window.location.reload();
    } catch (error) {
      if (errorEl) {
        errorEl.textContent = 'Failed to save key. Please try again.';
        errorEl.style.display = 'block';
      }
      if (saveBtn) {
        saveBtn.textContent = 'Save & Start Chatting';
        (saveBtn as HTMLButtonElement).disabled = false;
      }
    }
  };
  
  saveBtn?.addEventListener('click', saveKey);
  input?.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      saveKey();
    }
  });
  
  // Focus input
  input?.focus();
}

/**
 * Attach event listeners
 */
function attachEventListeners(): void {
  // Tab switching
  document.querySelectorAll('.scri-agent-tab-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const tabId = btn.getAttribute('data-tab');
      if (tabId) switchTab(tabId);
    });
  });

  // Welcome state input
  const sendBtn = document.getElementById('scri-agent-send');
  const input = document.getElementById('scri-agent-input') as HTMLTextAreaElement;

  sendBtn?.addEventListener('click', () => sendMessage());
  input?.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  });

  // Active chat input
  const sendBtnActive = document.getElementById('scri-agent-send-active');
  const inputActive = document.getElementById('scri-agent-input-active') as HTMLTextAreaElement;

  sendBtnActive?.addEventListener('click', () => sendMessageActive());
  inputActive?.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendMessageActive();
    }
  });

  // Suggestion buttons
  document.querySelectorAll('.scri-agent-suggestion').forEach(btn => {
    btn.addEventListener('click', () => {
      const query = btn.getAttribute('data-query');
      if (query) {
        const input = document.getElementById('scri-agent-input') as HTMLTextAreaElement;
        if (input) {
          input.value = query;
          sendMessage();
        }
      }
    });
  });

  // Auto-resize textareas
  [input, inputActive].forEach(textarea => {
    textarea?.addEventListener('input', () => {
      textarea.style.height = 'auto';
      textarea.style.height = Math.min(textarea.scrollHeight, 150) + 'px';
    });
  });
}

/**
 * Switch between tabs
 */
function switchTab(tabId: string): void {
  // Update tab buttons
  document.querySelectorAll('.scri-agent-tab-btn').forEach(btn => {
    btn.classList.toggle('active', btn.getAttribute('data-tab') === tabId);
  });

  // Update tab panels
  document.querySelectorAll('.scri-agent-tab-panel').forEach(panel => {
    panel.classList.toggle('active', panel.id === `scri-agent-${tabId}-tab`);
  });

  // Focus input if switching to chat
  if (tabId === 'chat') {
    const welcomeState = document.getElementById('scri-agent-welcome');
    const activeState = document.getElementById('scri-agent-chat-active');
    
    if (activeState?.style.display !== 'none') {
      const input = document.getElementById('scri-agent-input-active') as HTMLTextAreaElement;
      input?.focus();
    } else {
      const input = document.getElementById('scri-agent-input') as HTMLTextAreaElement;
      input?.focus();
    }
  }
}

/**
 * Transition from welcome state to active chat state
 */
function transitionToActiveChat(): void {
  const welcomeState = document.getElementById('scri-agent-welcome');
  const activeState = document.getElementById('scri-agent-chat-active');
  
  if (welcomeState && activeState) {
    welcomeState.style.display = 'none';
    activeState.style.display = 'flex';
    
    // Focus the active input
    const input = document.getElementById('scri-agent-input-active') as HTMLTextAreaElement;
    input?.focus();
  }
}

/**
 * Send a message from welcome state
 */
async function sendMessage(): Promise<void> {
  const input = document.getElementById('scri-agent-input') as HTMLTextAreaElement;
  const text = input.value.trim();
  
  if (!text || isLoading) return;

  // Clear input and transition to active state
  input.value = '';
  transitionToActiveChat();

  // Now send the message
  await sendChatMessage(text);
}

/**
 * Send a message from active chat state
 */
async function sendMessageActive(): Promise<void> {
  const input = document.getElementById('scri-agent-input-active') as HTMLTextAreaElement;
  const text = input.value.trim();
  
  if (!text || isLoading) return;

  // Clear input
  input.value = '';
  input.style.height = 'auto';

  await sendChatMessage(text);
}

/**
 * Common chat message sending logic
 */
async function sendChatMessage(text: string): Promise<void> {
  // Add user message
  const userMessage: ChatMessage = {
    id: generateId(),
    role: 'user',
    content: text,
    timestamp: new Date(),
  };
  addMessage(userMessage);

  // Add loading indicator
  const loadingMessage: ChatMessage = {
    id: generateId(),
    role: 'assistant',
    content: '',
    timestamp: new Date(),
    isLoading: true,
  };
  addMessage(loadingMessage);
  isLoading = true;
  updateStatus('Searching trials...');

  try {
    // Send to background worker
    const response = await chrome.runtime.sendMessage({
      type: 'CHAT',
      payload: { message: text },
    } as ExtensionMessage);

    // Remove loading message
    removeMessage(loadingMessage.id);
    isLoading = false;
    updateStatus('');

    if (response?.error) {
      addMessage({
        id: generateId(),
        role: 'assistant',
        content: `❌ ${response.error}`,
        timestamp: new Date(),
      });
      return;
    }

    // Add agent response
    const agentMessage: ChatMessage = {
      id: generateId(),
      role: 'assistant',
      content: response?.text || 'Sorry, I encountered an error. Please try again.',
      timestamp: new Date(),
      trials: response?.trials,
    };
    addMessage(agentMessage);

  } catch (error) {
    removeMessage(loadingMessage.id);
    isLoading = false;
    updateStatus('');
    addMessage({
      id: generateId(),
      role: 'assistant',
      content: `❌ Error: ${error instanceof Error ? error.message : 'Failed to connect. Please check your API key in the extension settings.'}`,
      timestamp: new Date(),
    });
  }
}

/**
 * Update status text
 */
function updateStatus(text: string): void {
  const status = document.getElementById('scri-agent-status');
  if (status) {
    status.textContent = text;
  }
}

/**
 * Add a message to the chat
 */
function addMessage(message: ChatMessage): void {
  chatMessages.push(message);
  renderMessages();
  
  // Smart scroll: user messages and loading scroll to bottom,
  // assistant responses scroll to start of message so user can read from top
  if (message.role === 'user' || message.isLoading) {
    scrollToBottom();
  } else {
    scrollToMessageStart(message.id);
  }
}

/**
 * Remove a message by ID
 */
function removeMessage(id: string): void {
  chatMessages = chatMessages.filter((m) => m.id !== id);
  renderMessages();
}

/**
 * Render all messages
 */
function renderMessages(): void {
  const container = document.getElementById('scri-agent-messages');
  if (!container) return;

  container.innerHTML = chatMessages
    .map((msg) => {
      if (msg.isLoading) {
        return `
          <div class="scri-agent-message scri-agent-message-assistant" data-message-id="${msg.id}">
            <div class="scri-agent-message-content">
              <div class="scri-agent-loading">
                <span></span><span></span><span></span>
              </div>
            </div>
          </div>
        `;
      }

      const roleClass = msg.role === 'user' ? 'scri-agent-message-user' : 'scri-agent-message-assistant';
      
      let trialsHtml = '';
      if (msg.trials && msg.trials.length > 0) {
        trialsHtml = `
          <div class="scri-agent-trials">
            ${msg.trials.slice(0, 5).map((trial) => {
              // Build SCRI URL from ID if not provided
              const scriUrl = trial.scriUrl || (trial.id ? `https://trials.scri.com/trialdetail/${trial.id}` : '#');
              // Build location display - handles both TrialSummary and TrialSearchResult formats
              let locationHtml = '';
              if (trial.closestLocation) {
                // Full TrialSummary format
                locationHtml = `
                  <div class="scri-agent-trial-location">
                    📍 ${escapeHtml(trial.closestLocation.city)}, ${escapeHtml(trial.closestLocation.state)}
                    ${trial.closestLocation.distance ? ` (~${trial.closestLocation.distance} mi)` : ''}
                    ${trial.locationCount > 1 ? ` • +${trial.locationCount - 1} more locations` : ''}
                  </div>
                `;
              } else if ((trial as any).closestCity) {
                // Slim TrialSearchResult format
                const slim = trial as any;
                locationHtml = `
                  <div class="scri-agent-trial-location">
                    📍 ${escapeHtml(slim.closestCity || '')}, ${escapeHtml(slim.closestState || '')}
                    ${slim.distance ? ` (~${slim.distance} mi)` : ''}
                  </div>
                `;
              }
              
              return `
              <div class="scri-agent-trial-card" data-scri-url="${scriUrl}">
                <div class="scri-agent-trial-header">
                  <strong>${escapeHtml(trial.name)}</strong>
                  <span class="scri-agent-trial-phase">${trial.phases?.join(', ') || ''}</span>
                </div>
                <div class="scri-agent-trial-nct">${escapeHtml(trial.nctId)}</div>
                ${trial.title ? `<div class="scri-agent-trial-title">${escapeHtml(trial.title)}</div>` : ''}
                ${locationHtml}
                <div class="scri-agent-trial-links">
                  <a href="${scriUrl}" target="_blank" class="scri-agent-trial-link scri-agent-trial-link-primary" onclick="event.stopPropagation()">
                    🏥 View on SCRI
                  </a>
                  ${trial.nctId ? `
                    <a href="https://clinicaltrials.gov/study/${trial.nctId}" target="_blank" class="scri-agent-trial-link scri-agent-trial-link-secondary" onclick="event.stopPropagation()">
                      📋 View on CT.gov
                    </a>
                  ` : ''}
                </div>
              </div>
            `}).join('')}
          </div>
        `;
      }

      return `
        <div class="scri-agent-message ${roleClass}" data-message-id="${msg.id}">
          <div class="scri-agent-message-content">
            ${formatMessageContent(msg.content)}
          </div>
          ${trialsHtml}
        </div>
      `;
    })
    .join('');

  // Attach trial card click handlers - clicking the card itself opens SCRI
  container.querySelectorAll('.scri-agent-trial-card').forEach((card) => {
    card.addEventListener('click', (e) => {
      // Don't trigger if clicking a link
      if ((e.target as HTMLElement).tagName === 'A') return;
      
      const scriUrl = card.getAttribute('data-scri-url');
      if (scriUrl) {
        window.open(scriUrl, '_blank');
      }
    });
  });
}

/**
 * Format message content with markdown support
 */
function formatMessageContent(content: string): string {
  return escapeHtml(content)
    // Headers
    .replace(/^### (.+)$/gm, '<h4>$1</h4>')
    .replace(/^## (.+)$/gm, '<h3>$1</h3>')
    // Bold
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    // Italic
    .replace(/\*(.+?)\*/g, '<em>$1</em>')
    // Links - NCT IDs
    .replace(/\[(NCT\d+)\]\([^)]+\)/g, '<a href="https://clinicaltrials.gov/study/$1" target="_blank">$1</a>')
    // Other links
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" target="_blank">$1</a>')
    // Line breaks
    .replace(/\n/g, '<br>')
    // Bullets
    .replace(/^• /gm, '<span class="bullet">•</span> ')
    .replace(/^- /gm, '<span class="bullet">•</span> ');
}

/**
 * Escape HTML to prevent XSS
 */
function escapeHtml(text: string): string {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

/**
 * Scroll chat to bottom (for user messages and loading)
 */
function scrollToBottom(): void {
  const container = document.getElementById('scri-agent-messages');
  if (container) {
    container.scrollTop = container.scrollHeight;
  }
}

/**
 * Scroll to the start of a specific message (for assistant responses)
 * This lets users read long responses from the top
 * Adds a small buffer so the message bubble is clearly visible
 */
function scrollToMessageStart(messageId: string): void {
  const container = document.getElementById('scri-agent-messages');
  const messageEl = container?.querySelector(`[data-message-id="${messageId}"]`) as HTMLElement;
  if (container && messageEl) {
    // Calculate position with 5px buffer above the message
    const messageTop = messageEl.offsetTop - 5;
    container.scrollTo({ top: messageTop, behavior: 'smooth' });
  }
}

/**
 * Generate a unique ID
 */
function generateId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}
/**
 * Listen for log messages from background script
 */
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === 'LOG_MESSAGE') {
    const { level, message: logMessage } = message.payload;
    const prefix = '[SCRI Agent]';
    if (level === 'error') {
      console.error(prefix, logMessage);
    } else if (level === 'warn') {
      console.warn(prefix, logMessage);
    } else {
      console.log(prefix, logMessage);
    }
  }
  return false; // No async response needed
});
// Initialize when DOM is ready
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}
