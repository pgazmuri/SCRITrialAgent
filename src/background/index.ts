/**
 * Background Service Worker
 * 
 * Handles:
 * - Message routing between content scripts and popup
 * - OpenAI API calls (to avoid CORS in content scripts)
 * - Storage management for API keys and patient profiles
 * - Conversation state persistence (survives service worker restarts)
 */

import { TrialAgent } from '@/services/agent';
import type { ExtensionMessage, PatientProfile, STORAGE_KEYS } from '@/types';

// Embedded API key from build (from openai.key file)
declare const __EMBEDDED_API_KEY__: string;
const EMBEDDED_KEY = typeof __EMBEDDED_API_KEY__ !== 'undefined' ? __EMBEDDED_API_KEY__ : '';

// Agent instance (created when API key is available)
let agent: TrialAgent | null = null;

// Track the tab that sent the last message for log forwarding
let activeTabId: number | null = null;

/**
 * Forward log messages to the content script for visibility in page console
 */
function forwardLog(level: 'log' | 'warn' | 'error', ...args: unknown[]): void {
  const message = args.map(a => typeof a === 'object' ? JSON.stringify(a) : String(a)).join(' ');
  console[level](...args); // Still log to service worker console
  
  // Forward to active tab if available
  if (activeTabId) {
    chrome.tabs.sendMessage(activeTabId, {
      type: 'LOG_MESSAGE',
      payload: { level, message }
    }).catch(() => {}); // Ignore errors if tab is closed
  }
}

/**
 * Save conversation state to session storage
 * This persists across service worker restarts
 */
async function saveConversationState(): Promise<void> {
  if (agent) {
    const state = agent.getConversationState();
    await chrome.storage.session.set({ 
      previousResponseId: state.previousResponseId || null 
    });
    console.log('[Background] Saved conversation state:', state.previousResponseId?.slice(0, 20));
  }
}

/**
 * Restore conversation state from session storage
 */
async function restoreConversationState(agentInstance: TrialAgent): Promise<void> {
  try {
    const result = await chrome.storage.session.get('previousResponseId');
    if (result.previousResponseId) {
      agentInstance.restoreConversationState(result.previousResponseId);
      console.log('[Background] Restored conversation state:', result.previousResponseId.slice(0, 20));
    }
  } catch (error) {
    console.warn('[Background] Could not restore conversation state:', error);
  }
}

/**
 * Initialize or get the agent instance
 */
async function getAgent(): Promise<TrialAgent> {
  if (agent) {
    return agent;
  }

  // Get API key from storage, fall back to embedded key
  const result = await chrome.storage.local.get(['openai_api_key', 'patient_profile']);
  const apiKey = result.openai_api_key || EMBEDDED_KEY;

  if (!apiKey) {
    throw new Error('OpenAI API key not configured. Please set it in the extension popup.');
  }

  // Create agent with log forwarding callback
  agent = new TrialAgent(apiKey, result.patient_profile, (level, ...args) => {
    forwardLog(level, ...args);
  });
  
  // Restore conversation state from session storage
  await restoreConversationState(agent);
  
  return agent;
}

/**
 * Handle messages from content scripts and popup
 */
chrome.runtime.onMessage.addListener((message: ExtensionMessage, sender, sendResponse) => {
  // Track the sender tab for log forwarding
  if (sender.tab?.id) {
    activeTabId = sender.tab.id;
  }
  
  // Handle async responses
  handleMessage(message)
    .then(sendResponse)
    .catch((error) => {
      console.error('Error handling message:', error);
      sendResponse({ type: 'ERROR', payload: { message: error.message } });
    });

  // Return true to indicate async response
  return true;
});

/**
 * Process incoming messages
 */
async function handleMessage(message: ExtensionMessage): Promise<unknown> {
  switch (message.type) {
    case 'CHAT':
    case 'CHAT_MESSAGE': {
      forwardLog('log', '[Background] 💬 Chat message received:', message.payload.message || message.payload.text);
      const agentInstance = await getAgent();
      const response = await agentInstance.chat(message.payload.message || message.payload.text);
      // Save conversation state after each chat for persistence
      await saveConversationState();
      forwardLog('log', '[Background] ✅ Chat response ready, trials:', response.trials?.length || 0);
      return { text: response.text, trials: response.trials };
    }

    case 'RESET_CONVERSATION': {
      const agentInstance = await getAgent();
      agentInstance.resetConversation();
      await chrome.storage.session.remove('previousResponseId');
      console.log('[Background] Conversation reset');
      return { success: true };
    }

    case 'SET_API_KEY': {
      await chrome.storage.local.set({ openai_api_key: message.payload.key });
      // Reset agent so it picks up new key
      agent = null;
      return { success: true };
    }

    case 'GET_API_KEY': {
      const result = await chrome.storage.local.get('openai_api_key');
      // Check for embedded key as well
      const key = result.openai_api_key || EMBEDDED_KEY;
      return {
        hasKey: !!key,
        maskedKey: key ? `${key.slice(0, 7)}...${key.slice(-4)}` : null,
      };
    }

    case 'UPDATE_PROFILE': {
      await chrome.storage.local.set({ patient_profile: message.payload });
      // Update agent's profile if it exists
      if (agent) {
        agent.setPatientProfile(message.payload);
      }
      return { success: true };
    }

    case 'GET_PROFILE': {
      const result = await chrome.storage.local.get('patient_profile');
      return { profile: result.patient_profile || null };
    }

    case 'SEARCH_TRIALS': {
      const agentInstance = await getAgent();
      const result = await agentInstance.executeTool('search_trials_nearby', {
        cancerType: message.payload.cancerType,
        zipCode: message.payload.zipCode || '37203',
      });
      return result;
    }

    case 'GET_TRIAL': {
      const agentInstance = await getAgent();
      const result = await agentInstance.executeTool('get_trial_eligibility', {
        nctId: message.payload.nctId || message.payload.trialId,
      });
      return result;
    }

    case 'GET_FILTERS': {
      const agentInstance = await getAgent();
      const result = await agentInstance.executeTool('get_available_cancer_types', {});
      return result;
    }

    default:
      throw new Error(`Unknown message type: ${(message as { type: string }).type}`);
  }
}

/**
 * Handle extension installation
 */
chrome.runtime.onInstalled.addListener((details) => {
  if (details.reason === 'install') {
    console.log('SCRI Trial Agent installed');
    // Open options page or show welcome message
  }
});

/**
 * Handle extension icon click when popup is not configured
 */
chrome.action.onClicked.addListener((tab) => {
  // If we had a popup, this wouldn't fire
  // But we do have a popup, so this is just a fallback
  console.log('Extension icon clicked');
});
