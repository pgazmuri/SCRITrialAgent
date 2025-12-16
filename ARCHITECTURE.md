# SCRI Clinical Trial Agent - Architecture

## Overview

This browser extension acts as an AI-powered assistant that helps patients find relevant clinical trials on the Sarah Cannon Research Institute (SCRI) clinical trials portal (https://trials.scri.com/).

## Problem Statement

Finding the right clinical trial is challenging for patients and caregivers because:
1. **Medical complexity**: Trial eligibility criteria use clinical terminology
2. **Volume of trials**: 700+ active trials across 27 cancer types
3. **Personalization**: Matching requires understanding individual patient history
4. **Location logistics**: Trials are available at specific locations

## Design Philosophy

### Why a Browser Extension?

After inspecting the SCRI API, we found:
- **No CORS headers**: The API only allows same-origin requests
- **Blazor WebAssembly app**: Tightly coupled frontend
- **Content-Security-Policy**: Restricts external connections

A browser extension is the only viable approach because:
1. Content scripts run in the page context (bypassing CORS)
2. Background service workers can make cross-origin requests
3. We can augment the existing UI without breaking it

### Agent Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                        Browser Extension                         │
├─────────────────────────────────────────────────────────────────┤
│                                                                   │
│  ┌─────────────┐    ┌─────────────────┐    ┌─────────────────┐  │
│  │   Popup     │    │ Content Script  │    │   Background    │  │
│  │             │    │                 │    │   Service       │  │
│  │ - Settings  │◄──►│ - Chat UI       │◄──►│   Worker        │  │
│  │ - Profile   │    │ - Page Analysis │    │                 │  │
│  │ - API Key   │    │ - Result        │    │ - OpenAI API    │  │
│  │             │    │   Enhancement   │    │ - State Mgmt    │  │
│  └─────────────┘    └────────┬────────┘    │ - Message Hub   │  │
│                              │              └────────┬────────┘  │
│                              │                       │           │
│                              ▼                       ▼           │
│                    ┌─────────────────────────────────────┐       │
│                    │         SCRI Page Context           │       │
│                    │   (trials.scri.com DOM access)      │       │
│                    └─────────────────────────────────────┘       │
│                                                                   │
└───────────────────────────────────────────────────────────────────┘
                               │
                               ▼
┌───────────────────────────────────────────────────────────────────┐
│                        External Services                          │
├─────────────────────────────────────────────────────────────────┤
│                                                                   │
│  ┌─────────────────────┐         ┌────────────────────────────┐  │
│  │   OpenAI API        │         │    SCRI Trial API          │  │
│  │   (Responses API)   │         │    (via page context)      │  │
│  │                     │         │                            │  │
│  │ - gpt-4o-mini       │         │ - /api/v1/uifilters        │  │
│  │ - Function calling  │         │ - /api/v1/trials/search    │  │
│  │ - Conversation      │         │ - /api/v1/trials/{id}      │  │
│  │   state management  │         │                            │  │
│  └─────────────────────┘         └────────────────────────────┘  │
│                                                                   │
└───────────────────────────────────────────────────────────────────┘
```

## Core Components

### 1. Patient Profile (User Data Model)

```typescript
interface PatientProfile {
  // Demographics
  age?: number;
  zipCode?: string;
  travelRadius?: number; // miles willing to travel
  
  // Cancer Information
  cancerType?: string;
  cancerSubtype?: string;
  stage?: string;
  diagnosisDate?: string;
  
  // Treatment History
  previousTreatments?: string[];
  currentMedications?: string[];
  
  // Health Status
  performanceStatus?: string; // ECOG scale
  organFunction?: string;
  comorbidities?: string[];
  
  // Preferences
  preferredLocations?: string[];
  trialPhasePreferences?: string[];
}
```

### 2. Agent Tools (Function Calling)

The AI agent has access to these tools via OpenAI's function calling:

```typescript
const tools = [
  {
    type: "function",
    function: {
      name: "search_trials",
      description: "Search for clinical trials by cancer type and optionally by location",
      parameters: {
        type: "object",
        properties: {
          cancerType: { 
            type: "string",
            description: "The type of cancer (e.g., 'Breast', 'Lung', 'Lymphoma')"
          },
          zipCode: {
            type: "string",
            description: "Patient's ZIP code for location-based filtering"
          },
          page: {
            type: "number",
            description: "Page number for paginated results (default: 1)"
          }
        },
        required: ["cancerType"]
      }
    }
  },
  {
    type: "function",
    function: {
      name: "get_trial_details",
      description: "Get detailed information about a specific clinical trial",
      parameters: {
        type: "object",
        properties: {
          trialId: {
            type: "string",
            description: "The study ID or NCT number of the trial"
          }
        },
        required: ["trialId"]
      }
    }
  },
  {
    type: "function",
    function: {
      name: "get_available_cancer_types",
      description: "Get the list of available cancer types for trial search",
      parameters: {
        type: "object",
        properties: {}
      }
    }
  },
  {
    type: "function",
    function: {
      name: "lookup_nct_trial",
      description: "Search for a trial by its NCT identifier",
      parameters: {
        type: "object",
        properties: {
          nctId: {
            type: "string",
            description: "The NCT identifier (e.g., NCT03448926)"
          }
        },
        required: ["nctId"]
      }
    }
  },
  {
    type: "function",
    function: {
      name: "filter_trials_by_location",
      description: "Filter trial results to show only locations within a specified distance",
      parameters: {
        type: "object",
        properties: {
          trials: {
            type: "array",
            description: "Array of trial data to filter"
          },
          zipCode: {
            type: "string",
            description: "Center point ZIP code"
          },
          radiusMiles: {
            type: "number",
            description: "Maximum distance in miles"
          }
        },
        required: ["trials", "zipCode", "radiusMiles"]
      }
    }
  }
];
```

### 3. Conversation Flow

```
User: "I have stage 3 breast cancer and live in Nashville. What trials are available?"
      ↓
Agent: [Calls search_trials(cancerType: "Breast", zipCode: "37203")]
      ↓
API:   Returns 45 trials with locations
      ↓
Agent: [Analyzes results, ranks by relevance and distance]
      ↓
Agent: "I found 45 breast cancer trials. Based on your Nashville location, 
        here are the 5 closest options:
        
        1. **BRE 381** - HER2+ Metastatic Breast Cancer trial at SCRI Oncology 
           Partners (Nashville, 1.2 miles away)
           Phase 2 | NCT05748834
        
        2. **BRE 423** - Triple Negative Breast Cancer trial at multiple 
           Tennessee locations
           Phase 3 | NCT05633654
        
        Would you like more details about any of these trials, or should I 
        filter by specific criteria like trial phase or treatment type?"
```

### 4. UI/UX Design

#### Floating Chat Widget
- Positioned in bottom-right corner
- Collapsible to minimize screen obstruction
- Drag-to-reposition capability
- Badge shows unread messages

#### Enhanced Search Results
- Injects AI summaries below each trial card
- Highlights eligibility matches
- Shows distance calculations
- Quick actions: "Ask about this trial"

#### Popup Panel
- Patient profile management
- API key configuration
- Conversation history
- Settings (theme, notifications)

## Data Flow

### Message Passing Architecture

```
Content Script ←→ Background Worker ←→ External APIs
      ↓                   ↓
   Storage ←──────────────┘
```

### Message Types

```typescript
type Message = 
  | { type: 'CHAT_MESSAGE'; payload: { text: string } }
  | { type: 'SEARCH_TRIALS'; payload: { cancerType: string; zipCode?: string } }
  | { type: 'GET_TRIAL'; payload: { trialId: string } }
  | { type: 'UPDATE_PROFILE'; payload: PatientProfile }
  | { type: 'SET_API_KEY'; payload: { key: string } }
  | { type: 'AGENT_RESPONSE'; payload: { text: string; trials?: Trial[] } };
```

## SCRI API Reference

### Discovered Endpoints

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/v1/uifilters/default` | GET | Returns list of cancer types for filtering |
| `/api/v1/trials/search/{filterId}/{cancerType}/{page}` | GET | Search trials by cancer type |
| `/api/v1/trials/{studyId}` | GET | Get trial details |
| `/api/v1/trials/nct/{nctId}` | GET | Search by NCT number (presumed) |

### Data Models (Reverse-Engineered)

```typescript
interface SCRISearchResponse {
  data: {
    currentPage: number;
    itemsPerPage: number;
    totalItemCount: number;
    totalPageCount: number;
    searchResultsData: SCRITrial[];
  };
  message: string;
  success: boolean;
  exceptionDetail: string;
}

interface SCRITrial {
  searchScore: number;
  provider: string;
  studyId: string;
  studyName: string;
  protocolName: string;
  protocolTitle: string;
  nct: string;
  siteList: SCRISite[];
  officeList: SCRIOffice[];
  programTypeNames: string[];
  phaseNames: string[];
}

interface SCRISite {
  siteId: string;
  siteName1: string;
  displayName: string;
  phoneNumber1: string;
  address1: string;
  city: string;
  state: string;
  zipCode: string;
  latitude: string;
  longitude: string;
  distanceFromTargetZipCode: number;
}

interface SCRIFilterResponse {
  data: {
    filterHeading: string;
    filterItemList: FilterItem[];
  };
}

interface FilterItem {
  filterItemId: number;
  filterItemText: string;
  isEnabled: boolean;
  sortOrder: number;
}
```

## Security Considerations

### API Key Storage
- Stored in `chrome.storage.local` (extension-only access)
- Never exposed to page context
- User must manually enter key (no auto-import)

### Data Privacy
- Patient profile stored locally only
- No data sent to external servers except OpenAI
- Conversations not persisted by default
- Clear data option in settings

### Content Security
- Content script isolated from page scripts
- Message passing uses structured types
- Input sanitization for all user data

## Testing Strategy

### Unit Tests (Vitest)
- SCRI API client mock responses
- OpenAI service with function call handling
- Message parsing and validation
- Patient profile serialization

### Integration Tests
- Extension messaging between components
- Storage operations
- API error handling

### E2E Tests (Future)
- Full conversation flows
- UI interactions
- Real API integration (staging)

## Development Workflow

```bash
# Install dependencies
npm install

# Run tests (TDD)
npm test

# Build extension
npm run build

# Load in Chrome
# 1. Open chrome://extensions
# 2. Enable Developer Mode
# 3. Load unpacked → select dist/ folder
```

## Future Enhancements

1. **ClinicalTrials.gov Integration**: Cross-reference with federal registry
2. **Eligibility Pre-screening**: Parse inclusion/exclusion criteria
3. **Appointment Scheduling**: Deep link to contact forms
4. **Multi-language Support**: Spanish, Chinese translations
5. **Voice Interface**: Speech-to-text for accessibility
6. **Care Team Sharing**: Export trial lists to email/print

## Revision History

| Version | Date | Changes |
|---------|------|---------|
| 1.0.0 | 2024-12-15 | Initial architecture document |
