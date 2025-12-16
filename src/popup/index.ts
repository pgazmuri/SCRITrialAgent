/**
 * Popup Script
 * 
 * Handles:
 * - Chat interface for AI trial navigator
 * - Tab navigation between Chat and Settings
 * - API key configuration
 * - Patient profile management
 */

import type { ExtensionMessage, PatientProfile } from '@/types';

// Tab Elements
const tabButtons = document.querySelectorAll('.tab-btn') as NodeListOf<HTMLButtonElement>;
const tabContents = document.querySelectorAll('.tab-content') as NodeListOf<HTMLDivElement>;

// Chat Elements
const chatMessages = document.getElementById('chat-messages') as HTMLDivElement;
const chatInput = document.getElementById('chat-input') as HTMLTextAreaElement;
const sendBtn = document.getElementById('send-btn') as HTMLButtonElement;
const chatStatusText = document.getElementById('chat-status-text') as HTMLSpanElement;

// Settings Elements
const apiKeyInput = document.getElementById('api-key-input') as HTMLInputElement;
const saveApiKeyBtn = document.getElementById('save-api-key') as HTMLButtonElement;
const apiKeyStatus = document.getElementById('api-key-status') as HTMLDivElement;

const cancerTypeSelect = document.getElementById('cancer-type') as HTMLSelectElement;
const zipCodeInput = document.getElementById('zip-code') as HTMLInputElement;
const travelRadiusInput = document.getElementById('travel-radius') as HTMLInputElement;
const ageInput = document.getElementById('age') as HTMLInputElement;
const stageSelect = document.getElementById('stage') as HTMLSelectElement;
const previousTreatmentsInput = document.getElementById('previous-treatments') as HTMLInputElement;
const saveProfileBtn = document.getElementById('save-profile') as HTMLButtonElement;

const openScriBtn = document.getElementById('open-scri') as HTMLButtonElement;
const clearDataBtn = document.getElementById('clear-data') as HTMLButtonElement;

// Chat state
let isProcessing = false;

/**
 * Initialize the popup
 */
async function init(): Promise<void> {
  await loadApiKeyStatus();
  await loadCancerTypes();
  await loadProfile();
  attachEventListeners();
  checkApiKeyForChat();
}

/**
 * Check if API key is configured and update chat UI
 */
async function checkApiKeyForChat(): Promise<void> {
  try {
    const response = await chrome.runtime.sendMessage({
      type: 'GET_API_KEY',
      payload: {},
    } as ExtensionMessage);

    if (!response?.hasKey) {
      chatStatusText.textContent = '⚠️ Configure your OpenAI API key in Settings to start chatting';
      chatInput.disabled = true;
      sendBtn.disabled = true;
    } else {
      chatStatusText.textContent = '';
      chatInput.disabled = false;
      sendBtn.disabled = false;
    }
  } catch (error) {
    console.error('Failed to check API key:', error);
  }
}

/**
 * Switch to a tab
 */
function switchTab(tabId: string): void {
  tabButtons.forEach(btn => {
    btn.classList.toggle('active', btn.dataset.tab === tabId);
  });
  tabContents.forEach(content => {
    content.classList.toggle('active', content.id === `${tabId}-tab`);
  });
}

/**
 * Add a message to the chat
 */
function addMessage(content: string, type: 'user' | 'assistant' | 'thinking' | 'error'): HTMLDivElement {
  // Remove welcome message if present
  const welcome = chatMessages.querySelector('.chat-welcome');
  if (welcome && type !== 'error') {
    welcome.remove();
  }

  const messageDiv = document.createElement('div');
  messageDiv.className = `chat-message ${type}`;
  
  if (type === 'thinking') {
    messageDiv.innerHTML = `
      <div class="typing-indicator">
        <span></span><span></span><span></span>
      </div>
    `;
  } else if (type === 'assistant') {
    // Parse markdown-like content for assistant messages
    messageDiv.innerHTML = parseMarkdown(content);
  } else {
    messageDiv.textContent = content;
  }
  
  chatMessages.appendChild(messageDiv);
  chatMessages.scrollTop = chatMessages.scrollHeight;
  
  return messageDiv;
}

/**
 * Simple markdown parser for chat messages
 */
function parseMarkdown(text: string): string {
  return text
    // Headers
    .replace(/^### (.+)$/gm, '<h4>$1</h4>')
    .replace(/^## (.+)$/gm, '<h3>$1</h3>')
    // Bold
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    // Italic
    .replace(/\*(.+?)\*/g, '<em>$1</em>')
    // Links
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" target="_blank">$1</a>')
    // Line breaks
    .replace(/\n/g, '<br>')
    // Lists (basic)
    .replace(/^- (.+)$/gm, '• $1');
}

/**
 * Send a chat message
 */
async function sendMessage(): Promise<void> {
  const message = chatInput.value.trim();
  if (!message || isProcessing) return;

  isProcessing = true;
  sendBtn.disabled = true;
  chatInput.value = '';

  // Add user message
  addMessage(message, 'user');

  // Add thinking indicator
  const thinkingMsg = addMessage('', 'thinking');

  try {
    chatStatusText.textContent = 'Searching trials...';

    const response = await chrome.runtime.sendMessage({
      type: 'CHAT',
      payload: { message },
    } as ExtensionMessage);

    // Remove thinking indicator
    thinkingMsg.remove();

    if (response?.error) {
      addMessage(response.error, 'error');
      chatStatusText.textContent = '';
    } else if (response?.text) {
      addMessage(response.text, 'assistant');
      chatStatusText.textContent = '';
    } else {
      addMessage('Sorry, I couldn\'t process your request. Please try again.', 'error');
      chatStatusText.textContent = '';
    }
  } catch (error) {
    thinkingMsg.remove();
    addMessage('Failed to connect to the agent. Please check your API key in Settings.', 'error');
    chatStatusText.textContent = '';
    console.error('Chat error:', error);
  } finally {
    isProcessing = false;
    sendBtn.disabled = false;
    chatInput.focus();
  }
}

/**
 * Load API key status
 */
async function loadApiKeyStatus(): Promise<void> {
  try {
    const response = await chrome.runtime.sendMessage({
      type: 'GET_API_KEY',
      payload: {},
    } as ExtensionMessage);

    const indicator = apiKeyStatus.querySelector('.status-indicator') as HTMLElement;
    const text = apiKeyStatus.querySelector('.status-text') as HTMLElement;

    if (response?.hasKey) {
      indicator.className = 'status-indicator status-configured';
      text.textContent = `Configured: ${response.maskedKey}`;
      apiKeyInput.placeholder = 'Enter new key to update...';
    } else {
      indicator.className = 'status-indicator status-unconfigured';
      text.textContent = 'Not configured';
    }
  } catch (error) {
    console.error('Failed to load API key status:', error);
  }
}

/**
 * Load available cancer types
 */
async function loadCancerTypes(): Promise<void> {
  const cancerTypes = [
    'Acute Lymphoblastic Leukemia',
    'Acute Myeloid Leukemia',
    'Amyloidosis',
    'Breast',
    'Central Nervous System',
    'Chronic Lymphocytic Leukemia',
    'Chronic Myeloid Leukemia',
    'Gastrointestinal',
    'Genitourinary',
    'Graft vs Host',
    'Gynecologic',
    'Head and Neck',
    'Hematologic Refractory',
    'Hematopoietic Cell Transplantation',
    'Lung',
    'Lymphoma',
    'Molecular Profiling',
    'Multiple Disease Cohorts',
    'Multiple Myeloma',
    'Myelodysplastic Syndrome',
    'Myeloproliferative Neoplasms',
    'Other Cancers',
    'Pediatrics',
    'Refractory Malignancies',
    'Sarcoma',
    'Skin Cancers',
    'Thyroid Cancer',
    'Tissue',
  ];

  cancerTypeSelect.innerHTML = '<option value="">Select...</option>';
  cancerTypes.forEach((type) => {
    const option = document.createElement('option');
    option.value = type;
    option.textContent = type;
    cancerTypeSelect.appendChild(option);
  });
}

/**
 * Load saved patient profile
 */
async function loadProfile(): Promise<void> {
  try {
    const response = await chrome.runtime.sendMessage({
      type: 'GET_PROFILE',
      payload: {},
    } as ExtensionMessage);

    const profile = response?.profile as PatientProfile | null;
    if (profile) {
      if (profile.cancerType) cancerTypeSelect.value = profile.cancerType;
      if (profile.zipCode) zipCodeInput.value = profile.zipCode;
      if (profile.travelRadius) travelRadiusInput.value = String(profile.travelRadius);
      if (profile.age) ageInput.value = String(profile.age);
      if (profile.stage) stageSelect.value = profile.stage;
      if (profile.previousTreatments) {
        previousTreatmentsInput.value = profile.previousTreatments.join(', ');
      }
    }
  } catch (error) {
    console.error('Failed to load profile:', error);
  }
}

/**
 * Attach event listeners
 */
function attachEventListeners(): void {
  // Tab switching
  tabButtons.forEach(btn => {
    btn.addEventListener('click', () => {
      const tabId = btn.dataset.tab;
      if (tabId) switchTab(tabId);
    });
  });

  // Chat send
  sendBtn.addEventListener('click', sendMessage);
  
  chatInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  });

  // Auto-resize textarea
  chatInput.addEventListener('input', () => {
    chatInput.style.height = 'auto';
    chatInput.style.height = Math.min(chatInput.scrollHeight, 100) + 'px';
  });

  // Save API key
  saveApiKeyBtn.addEventListener('click', async () => {
    const key = apiKeyInput.value.trim();
    if (!key) {
      showToast('Please enter an API key', 'error');
      return;
    }

    if (!key.startsWith('sk-')) {
      showToast('Invalid API key format', 'error');
      return;
    }

    try {
      saveApiKeyBtn.disabled = true;
      saveApiKeyBtn.textContent = 'Saving...';

      await chrome.runtime.sendMessage({
        type: 'SET_API_KEY',
        payload: { key },
      } as ExtensionMessage);

      apiKeyInput.value = '';
      await loadApiKeyStatus();
      await checkApiKeyForChat();
      showToast('API key saved!', 'success');
    } catch (error) {
      showToast('Failed to save API key', 'error');
    } finally {
      saveApiKeyBtn.disabled = false;
      saveApiKeyBtn.textContent = 'Save';
    }
  });

  // Save profile
  saveProfileBtn.addEventListener('click', async () => {
    const profile: PatientProfile = {};

    if (cancerTypeSelect.value) profile.cancerType = cancerTypeSelect.value;
    if (zipCodeInput.value) profile.zipCode = zipCodeInput.value;
    if (travelRadiusInput.value) profile.travelRadius = parseInt(travelRadiusInput.value);
    if (ageInput.value) profile.age = parseInt(ageInput.value);
    if (stageSelect.value) profile.stage = stageSelect.value;
    if (previousTreatmentsInput.value) {
      profile.previousTreatments = previousTreatmentsInput.value
        .split(',')
        .map((t) => t.trim())
        .filter(Boolean);
    }

    try {
      saveProfileBtn.disabled = true;
      saveProfileBtn.textContent = 'Saving...';

      await chrome.runtime.sendMessage({
        type: 'UPDATE_PROFILE',
        payload: profile,
      } as ExtensionMessage);

      showToast('Profile saved!', 'success');
    } catch (error) {
      showToast('Failed to save profile', 'error');
    } finally {
      saveProfileBtn.disabled = false;
      saveProfileBtn.textContent = 'Save Profile';
    }
  });

  // Open SCRI
  openScriBtn.addEventListener('click', () => {
    chrome.tabs.create({ url: 'https://trials.scri.com/' });
  });

  // Clear data
  clearDataBtn.addEventListener('click', async () => {
    if (!confirm('Are you sure you want to clear all data? This cannot be undone.')) {
      return;
    }

    try {
      await chrome.storage.local.clear();
      
      // Reset form
      apiKeyInput.value = '';
      cancerTypeSelect.value = '';
      zipCodeInput.value = '';
      travelRadiusInput.value = '';
      ageInput.value = '';
      stageSelect.value = '';
      previousTreatmentsInput.value = '';
      
      // Reset chat
      chatMessages.innerHTML = `
        <div class="chat-welcome">
          <div class="welcome-icon">🩺</div>
          <h3>Welcome to SCRI Trial Navigator</h3>
          <p>I can help you find clinical trials that match your needs. Tell me about:</p>
          <ul>
            <li>Your cancer type and diagnosis</li>
            <li>Where you're located (ZIP code)</li>
            <li>Any previous treatments</li>
          </ul>
          <p class="welcome-hint">I'll be honest about travel distances and help you find the best options.</p>
        </div>
      `;
      
      await loadApiKeyStatus();
      await checkApiKeyForChat();
      showToast('All data cleared', 'success');
    } catch (error) {
      showToast('Failed to clear data', 'error');
    }
  });
}

/**
 * Show a toast notification
 */
function showToast(message: string, type: 'success' | 'error'): void {
  document.querySelectorAll('.toast').forEach((t) => t.remove());

  const toast = document.createElement('div');
  toast.className = `toast toast-${type}`;
  toast.textContent = message;
  document.body.appendChild(toast);

  requestAnimationFrame(() => {
    toast.classList.add('toast-visible');
  });

  setTimeout(() => {
    toast.classList.remove('toast-visible');
    setTimeout(() => toast.remove(), 300);
  }, 3000);
}

// Initialize when DOM is ready
document.addEventListener('DOMContentLoaded', init);
