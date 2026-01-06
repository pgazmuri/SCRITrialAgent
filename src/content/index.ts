/**
 * Content Script
 * 
 * Injected into SCRI trial pages to:
 * - Add tabbed interface with AI Chat and original Search
 * - Replace the main search area with enhanced experience
 * - Bridge communication with background worker
 */

import type { ExtensionMessage, ChatMessage, TrialListItem, TrialSearchResult, TrialSummary, EligibilityStatus } from '@/types';

// State
let chatMessages: ChatMessage[] = [];
let isLoading = false;
let originalSearchContent: HTMLElement | null = null;

// Trial list state ("shopping cart")
let trialList: TrialListItem[] = [];

// Cache for trial data (to avoid escaping issues with JSON in HTML attributes)
const trialDataCache = new Map<string, TrialSearchResult | TrialSummary>();

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
  // Reset conversation on each page load for fresh start
  chrome.runtime.sendMessage({ type: 'RESET_CONVERSATION' }).catch(() => {
    // Ignore errors - background might not be ready yet
  });
  
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

        <!-- Tab Content - Now Two Column Layout -->
        <div class="scri-agent-tab-content">
          <!-- Chat Tab -->
          <div id="scri-agent-chat-tab" class="scri-agent-tab-panel active">
            <div class="scri-agent-two-column">
              <!-- Left Column: Chat Interface -->
              <div class="scri-agent-chat-column">
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
              
              <!-- Right Column: My Trials Panel -->
              <div class="scri-agent-trials-column" id="scri-agent-trials-panel">
                <div class="scri-agent-trials-header">
                  <h2 class="scri-agent-trials-title">
                    <span>📋</span> My Trials
                    <span class="scri-agent-trials-count" id="scri-agent-trials-count">0</span>
                  </h2>
                  <button class="scri-agent-trials-clear" id="scri-agent-clear-list" title="Clear all trials">
                    🗑️
                  </button>
                </div>
                
                <div class="scri-agent-trials-list" id="scri-agent-trials-list">
                  <!-- Empty state -->
                  <div class="scri-agent-trials-empty" id="scri-agent-trials-empty">
                    <div class="scri-agent-trials-empty-icon">📝</div>
                    <p>No trials added yet</p>
                    <p class="scri-agent-trials-empty-hint">Search for trials and click "Add to My List" to start building your list</p>
                  </div>
                </div>
                
                <div class="scri-agent-trials-actions" id="scri-agent-trials-actions" style="display: none;">
                  <div class="scri-agent-eligibility-summary" id="scri-agent-eligibility-summary">
                    <!-- Eligibility summary will be rendered here -->
                  </div>
                  <button class="scri-agent-request-matching-btn" id="scri-agent-request-matching">
                    ✉️ Request Matching for Selected Trials
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
  
  // Trial list panel - Clear button
  const clearBtn = document.getElementById('scri-agent-clear-list');
  clearBtn?.addEventListener('click', () => {
    if (trialList.length === 0) return;
    if (confirm('Are you sure you want to clear all trials from your list?')) {
      clearTrialList();
    }
  });
  
  // Trial list panel - Request Matching button
  const requestMatchingBtn = document.getElementById('scri-agent-request-matching');
  requestMatchingBtn?.addEventListener('click', () => {
    showMatchingRequestModal();
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
    // Send to background worker with current trial list
    const currentTrialListData = trialList.map(item => ({
      id: item.trial.id,
      name: item.trial.name,
      title: item.trial.title,
      nctId: item.trial.nctId,
      status: item.status,
      statusReason: item.statusReason,
    }));
    
    const response = await chrome.runtime.sendMessage({
      type: 'CHAT',
      payload: { 
        message: text,
        currentTrialList: currentTrialListData,
      },
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
    
    // Process any eligibility updates from the agent
    if (response?.eligibilityUpdates && response.eligibilityUpdates.length > 0) {
      for (const update of response.eligibilityUpdates) {
        updateTrialStatus(update.trialId, update.status as EligibilityStatus, update.reason);
      }
    }
    
    // Process any trials the agent wants to add to the list
    if (response?.trialsToAdd && response.trialsToAdd.length > 0) {
      console.log('[SCRI Agent] Agent adding trials to list:', response.trialsToAdd.length);
      for (const addition of response.trialsToAdd) {
        // Build a trial object from what the agent returned
        const trialData = addition.trialData as TrialSearchResult | TrialSummary;
        if (trialData && trialData.id) {
          addTrialToList(trialData);
          // If agent provided a reason, update the status
          if (addition.reason) {
            updateTrialStatus(trialData.id, 'unknown', addition.reason);
          }
        }
      }
    }
    
    // Process any trials the agent wants to remove from the list
    if (response?.trialsToRemove && response.trialsToRemove.length > 0) {
      console.log('[SCRI Agent] Agent removing trials from list:', response.trialsToRemove.length);
      for (const removal of response.trialsToRemove) {
        removeTrialFromList(removal.trialId);
      }
    }

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
        // Cache trial data for later retrieval
        msg.trials.slice(0, 5).forEach(trial => {
          if (trial.id) {
            trialDataCache.set(trial.id, trial);
          }
        });
        
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
              <div class="scri-agent-trial-card" data-scri-url="${scriUrl}" data-trial-id="${trial.id}">
                <div class="scri-agent-trial-header">
                  <strong>${escapeHtml(trial.name)}</strong>
                  <span class="scri-agent-trial-phase">${trial.phases?.join(', ') || ''}</span>
                </div>
                <div class="scri-agent-trial-nct">${escapeHtml(trial.nctId)}</div>
                ${trial.title ? `<div class="scri-agent-trial-title">${escapeHtml(trial.title)}</div>` : ''}
                ${locationHtml}
                <div class="scri-agent-trial-links">
                  <button class="scri-agent-add-to-list-btn" data-trial-id="${trial.id}">
                    ➕ Add to My List
                  </button>
                  <a href="${scriUrl}" target="_blank" class="scri-agent-trial-link scri-agent-trial-link-primary">
                    🏥 SCRI
                  </a>
                  ${trial.nctId ? `
                    <a href="https://clinicaltrials.gov/study/${trial.nctId}" target="_blank" class="scri-agent-trial-link scri-agent-trial-link-secondary">
                      📋 CT.gov
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
      // Don't trigger if clicking a link or button
      const target = e.target as HTMLElement;
      if (target.tagName === 'A' || target.tagName === 'BUTTON') return;
      
      const scriUrl = card.getAttribute('data-scri-url');
      if (scriUrl) {
        window.open(scriUrl, '_blank');
      }
    });
  });
  
  // Attach "Add to My List" button handlers
  container.querySelectorAll('.scri-agent-add-to-list-btn').forEach((btn) => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      e.preventDefault();
      const trialId = (btn as HTMLElement).getAttribute('data-trial-id');
      console.log('[SCRI Agent] Add to list button clicked, trialId:', trialId);
      console.log('[SCRI Agent] Cache size:', trialDataCache.size, 'Cache keys:', Array.from(trialDataCache.keys()));
      if (trialId) {
        const trial = trialDataCache.get(trialId);
        console.log('[SCRI Agent] Trial from cache:', trial);
        if (trial) {
          addTrialToList(trial);
          // Update button to show "Added"
          (btn as HTMLElement).textContent = '✓ Added';
          (btn as HTMLElement).classList.add('scri-agent-add-to-list-btn-added');
          (btn as HTMLButtonElement).disabled = true;
        } else {
          console.error('[SCRI Agent] Trial not found in cache:', trialId);
        }
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
function escapeHtml(text: string | undefined | null): string {
  if (!text) return '';
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

// ============================================
// TRIAL LIST MANAGEMENT ("Shopping Cart")
// ============================================

/**
 * Add a trial to the user's consideration list
 */
function addTrialToList(trial: TrialSearchResult | TrialSummary): void {
  // Check if already in list
  if (trialList.some(item => item.trial.id === trial.id)) {
    console.log('[SCRI Agent] Trial already in list:', trial.name);
    return;
  }
  
  const item: TrialListItem = {
    trial,
    addedAt: new Date(),
    status: 'unknown',
  };
  
  trialList.push(item);
  renderTrialList();
  
  console.log('[SCRI Agent] Added trial to list:', trial.name, 'Total:', trialList.length);
}

/**
 * Remove a trial from the list
 */
function removeTrialFromList(trialId: string): void {
  trialList = trialList.filter(item => item.trial.id !== trialId);
  renderTrialList();
}

/**
 * Update a trial's eligibility status
 */
function updateTrialStatus(trialId: string, status: EligibilityStatus, reason?: string): void {
  const item = trialList.find(i => i.trial.id === trialId);
  if (item) {
    item.status = status;
    item.statusReason = reason;
    renderTrialList();
  }
}

/**
 * Clear all trials from the list
 */
function clearTrialList(): void {
  trialList = [];
  renderTrialList();
}

/**
 * Get status indicator HTML
 */
function getStatusIndicator(status: EligibilityStatus): string {
  switch (status) {
    case 'likely_eligible':
      return '<span class="scri-agent-status-badge scri-agent-status-eligible" title="Likely Eligible">✅</span>';
    case 'likely_ineligible':
      return '<span class="scri-agent-status-badge scri-agent-status-ineligible" title="Likely Ineligible">❌</span>';
    case 'needs_review':
      return '<span class="scri-agent-status-badge scri-agent-status-review" title="Needs Physician Review">⚠️</span>';
    default:
      return '<span class="scri-agent-status-badge scri-agent-status-unknown" title="Eligibility Unknown">❓</span>';
  }
}

/**
 * Render the trial list panel
 */
function renderTrialList(): void {
  const listContainer = document.getElementById('scri-agent-trials-list');
  const countEl = document.getElementById('scri-agent-trials-count');
  const actionsEl = document.getElementById('scri-agent-trials-actions');
  const summaryEl = document.getElementById('scri-agent-eligibility-summary');
  
  if (!listContainer) return;
  
  // Update count
  if (countEl) {
    countEl.textContent = String(trialList.length);
  }
  
  // Show/hide empty state and actions
  if (trialList.length === 0) {
    if (actionsEl) actionsEl.style.display = 'none';
    // Render empty state
    listContainer.innerHTML = `
      <div class="scri-agent-trials-empty">
        <div class="scri-agent-trials-empty-icon">📝</div>
        <p>No trials added yet</p>
        <p class="scri-agent-trials-empty-hint">Search for trials and click "Add to My List" to start building your list</p>
      </div>
    `;
    return;
  }
  
  if (actionsEl) actionsEl.style.display = 'block';
  
  // Count by status
  const statusCounts = {
    likely_eligible: trialList.filter(t => t.status === 'likely_eligible').length,
    likely_ineligible: trialList.filter(t => t.status === 'likely_ineligible').length,
    needs_review: trialList.filter(t => t.status === 'needs_review').length,
    unknown: trialList.filter(t => t.status === 'unknown').length,
  };
  
  // Render eligibility summary
  if (summaryEl) {
    summaryEl.innerHTML = `
      <div class="scri-agent-eligibility-counts">
        ${statusCounts.likely_eligible > 0 ? `<span class="scri-agent-status-count eligible">✅ ${statusCounts.likely_eligible} Likely Eligible</span>` : ''}
        ${statusCounts.needs_review > 0 ? `<span class="scri-agent-status-count review">⚠️ ${statusCounts.needs_review} Needs Review</span>` : ''}
        ${statusCounts.unknown > 0 ? `<span class="scri-agent-status-count unknown">❓ ${statusCounts.unknown} Unknown</span>` : ''}
        ${statusCounts.likely_ineligible > 0 ? `<span class="scri-agent-status-count ineligible">❌ ${statusCounts.likely_ineligible} Likely Ineligible</span>` : ''}
      </div>
    `;
  }
  
  // Render trial cards
  listContainer.innerHTML = trialList.map(item => {
    const trial = item.trial;
    const scriUrl = trial.scriUrl || `https://trials.scri.com/trialdetail/${trial.id}`;
    
    // Get location info - handle both formats
    let locationHtml = '';
    if ('closestLocation' in trial && trial.closestLocation) {
      locationHtml = `📍 ${escapeHtml(trial.closestLocation.city)}, ${escapeHtml(trial.closestLocation.state)}`;
    } else if ('closestCity' in trial && trial.closestCity) {
      locationHtml = `📍 ${escapeHtml(trial.closestCity)}, ${escapeHtml((trial as TrialSearchResult).closestState || '')}`;
    }
    
    const ineligibleClass = item.status === 'likely_ineligible' ? 'scri-agent-trial-item-ineligible' : '';
    
    return `
      <div class="scri-agent-trial-item ${ineligibleClass}" data-trial-id="${trial.id}">
        <div class="scri-agent-trial-item-header">
          ${getStatusIndicator(item.status)}
          <strong class="scri-agent-trial-item-name">${escapeHtml(trial.name)}</strong>
          <button class="scri-agent-trial-item-remove" data-remove-id="${trial.id}" title="Remove from list">×</button>
        </div>
        <div class="scri-agent-trial-item-title">${escapeHtml(trial.title)}</div>
        ${locationHtml ? `<div class="scri-agent-trial-item-location">${locationHtml}</div>` : ''}
        ${item.statusReason ? `<div class="scri-agent-trial-item-reason">${escapeHtml(item.statusReason)}</div>` : ''}
        <div class="scri-agent-trial-item-links">
          <a href="${scriUrl}" target="_blank" class="scri-agent-mini-link">View on SCRI</a>
          ${trial.nctId ? `<a href="https://clinicaltrials.gov/study/${trial.nctId}" target="_blank" class="scri-agent-mini-link">CT.gov</a>` : ''}
        </div>
      </div>
    `;
  }).join('');
  
  // Attach remove button handlers
  listContainer.querySelectorAll('.scri-agent-trial-item-remove').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const trialId = (btn as HTMLElement).getAttribute('data-remove-id');
      if (trialId) {
        removeTrialFromList(trialId);
      }
    });
  });
}

/**
 * Show matching request modal
 */
function showMatchingRequestModal(): void {
  const eligibleTrials = trialList.filter(t => t.status !== 'likely_ineligible');
  
  if (eligibleTrials.length === 0) {
    alert('No eligible trials to request matching for. All trials in your list appear to be ineligible based on your profile.');
    return;
  }
  
  const trialNames = eligibleTrials.map(t => `• ${t.trial.name}: ${t.trial.title}`).join('\n');
  
  const confirmed = confirm(
    `📬 Request Matching\n\n` +
    `You are about to request matching for ${eligibleTrials.length} trial(s):\n\n` +
    `${trialNames}\n\n` +
    `A clinical trial coordinator will review your request and contact you to discuss next steps.\n\n` +
    `Click OK to submit your request.`
  );
  
  if (confirmed) {
    // In a real implementation, this would submit to a backend
    alert(
      `✅ Request Submitted!\n\n` +
      `Your matching request for ${eligibleTrials.length} trial(s) has been submitted.\n\n` +
      `A coordinator from Sarah Cannon Research Institute will contact you within 2-3 business days.\n\n` +
      `Reference ID: ${generateId()}`
    );
    
    console.log('[SCRI Agent] Matching request submitted for:', eligibleTrials.map(t => t.trial.name));
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
