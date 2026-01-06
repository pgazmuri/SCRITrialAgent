import OpenAI from 'openai';
import type {
  PatientProfile,
  TrialSummary,
  TrialSearchResult,
  SCRITrial,
} from '@/types';
import { SCRIApiClient } from './scri-api';
import { getZipCoordinates, calculateDistance } from './geo';
import { fetchCTGovStudy, formatEligibilityForDisplay, formatTreatmentInfo, searchCTGov } from './clinicaltrials-gov';

/**
 * Tool definitions for the clinical trial agent
 * These follow the OpenAI Responses API function tool schema
 * Quality-focused: fewer tools, better conversations
 */
export const AGENT_TOOLS: OpenAI.Responses.Tool[] = [
  {
    type: 'function',
    name: 'search_trials',
    description:
      'Search for SCRI clinical trials by cancer type. Returns slim results (id, name, phase, location, distance). Call get_study_details for full info on promising matches. If ZIP code is provided, results are sorted by distance.',
    parameters: {
      type: 'object',
      properties: {
        cancerType: {
          type: 'string',
          description: "The type of cancer to search for. Examples: 'Breast', 'Lung', 'Lymphoma'",
        },
        zipCode: {
          type: 'string',
          description: 'Optional: Patient\'s 5-digit ZIP code for distance calculations and sorting by proximity',
        },
      },
      required: ['cancerType'],
    },
  },
  {
    type: 'function',
    name: 'get_study_details',
    description:
      'Get full details for a specific trial by study ID. Use after search_trials to dig deeper on promising matches. Returns title, description, all locations, cancer types, and links.',
    parameters: {
      type: 'object',
      properties: {
        studyId: {
          type: 'string',
          description: 'The SCRI study ID (e.g., "BRE-430" or the full GUID)',
        },
      },
      required: ['studyId'],
    },
  },
  {
    type: 'function',
    name: 'get_trial_eligibility',
    description:
      'Get detailed eligibility criteria for a specific trial from ClinicalTrials.gov. Use this when a patient asks about eligibility requirements or wants to know if they might qualify.',
    parameters: {
      type: 'object',
      properties: {
        nctId: {
          type: 'string',
          description: 'The NCT identifier (e.g., "NCT03448926")',
        },
      },
      required: ['nctId'],
    },
  },
  {
    type: 'function',
    name: 'get_trial_treatment_info',
    description:
      'Get information about the treatments and interventions in a specific trial. Use when patient wants to understand what drugs or treatments are being studied.',
    parameters: {
      type: 'object',
      properties: {
        nctId: {
          type: 'string',
          description: 'The NCT identifier (e.g., "NCT03448926")',
        },
      },
      required: ['nctId'],
    },
  },
  {
    type: 'function',
    name: 'get_available_cancer_types',
    description:
      'Get the list of all available cancer types that SCRI has trials for. Use this to help patients understand what\'s available.',
    parameters: {
      type: 'object',
      properties: {},
    },
  },
  {
    type: 'function',
    name: 'search_all_trials',
    description:
      'Search ClinicalTrials.gov for ALL recruiting trials (not just SCRI). Use as a BACKSTOP when SCRI has no coverage in patient\'s area, or when SCRI search returns no relevant results. Returns trials from any institution.',
    parameters: {
      type: 'object',
      properties: {
        condition: {
          type: 'string',
          description: "Cancer type or condition to search for. Example: 'HER2 positive breast cancer'",
        },
        location: {
          type: 'string',
          description: 'City and state, or ZIP code. Example: "Nashville, TN" or "37203"',
        },
        distance: {
          type: 'number',
          description: 'Maximum distance in miles from location (default: 100)',
        },
      },
      required: ['condition'],
    },
  },
  {
    type: 'function',
    name: 'check_patient_eligibility',
    description:
      'Check if the patient might be eligible for a specific trial based on their profile and the trial\'s eligibility criteria from ClinicalTrials.gov. Returns an assessment of likely_eligible, likely_ineligible, needs_review, or unknown.',
    parameters: {
      type: 'object',
      properties: {
        trialId: {
          type: 'string',
          description: 'The SCRI study ID of the trial to check',
        },
        nctId: {
          type: 'string',
          description: 'The NCT identifier (if known) - required for eligibility lookup',
        },
        trialName: {
          type: 'string',
          description: 'The trial name (e.g., "BRE-430") for display purposes',
        },
      },
      required: ['trialId', 'trialName'],
    },
  },
  {
    type: 'function',
    name: 'add_to_trial_list',
    description:
      'Add a trial to the patient\'s "My Trials" consideration list. Use this when the patient expresses interest in a trial or when you recommend a trial as a good match. The trial will appear in their list on the right panel.',
    parameters: {
      type: 'object',
      properties: {
        trialId: {
          type: 'string',
          description: 'The SCRI study ID of the trial to add',
        },
        trialName: {
          type: 'string',
          description: 'The trial name (e.g., "BRE-430")',
        },
        reason: {
          type: 'string',
          description: 'Brief reason for adding (e.g., "Good match for HER2+ breast cancer")',
        },
      },
      required: ['trialId', 'trialName'],
    },
  },
  {
    type: 'function',
    name: 'update_trial_eligibility_status',
    description:
      'Update the eligibility status of a trial in the patient\'s "My Trials" list. Use this after assessing eligibility based on conversation or criteria. The UI will reflect the updated status.',
    parameters: {
      type: 'object',
      properties: {
        trialId: {
          type: 'string',
          description: 'The SCRI study ID of the trial to update',
        },
        status: {
          type: 'string',
          enum: ['likely_eligible', 'likely_ineligible', 'needs_review', 'unknown'],
          description: 'The new eligibility status',
        },
        reason: {
          type: 'string',
          description: 'Brief explanation for the status (e.g., "Prior T-DXd therapy may exclude", "Meets age and cancer type criteria")',
        },
      },
      required: ['trialId', 'status', 'reason'],
    },
  },
  {
    type: 'function',
    name: 'get_trial_list',
    description:
      'Get the current list of trials in the patient\'s "My Trials" consideration list, along with their eligibility status. Use this to check what trials the patient has added before making recommendations or checking eligibility.',
    parameters: {
      type: 'object',
      properties: {},
    },
  },
  {
    type: 'function',
    name: 'remove_from_trial_list',
    description:
      'Remove a trial from the patient\'s "My Trials" consideration list. Use this when the patient wants to remove a trial or when you determine a trial is definitely not suitable.',
    parameters: {
      type: 'object',
      properties: {
        trialId: {
          type: 'string',
          description: 'The SCRI study ID of the trial to remove',
        },
        reason: {
          type: 'string',
          description: 'Brief reason for removal (e.g., "Patient is ineligible due to prior treatment")',
        },
      },
      required: ['trialId'],
    },
  },
];

/**
 * AI Agent for helping patients find clinical trials
 * Uses OpenAI Responses API with function calling
 */
export class TrialAgent {
  private openai: OpenAI;
  private scriApi: SCRIApiClient;
  private patientProfile?: PatientProfile;
  private conversationId?: string;
  private previousResponseId?: string;
  private onLog?: (level: 'log' | 'warn' | 'error', ...args: unknown[]) => void;
  
  // Memoization cache: store full trial data by study ID and name for later retrieval
  private trialCache: Map<string, { trial: SCRITrial; userZipCode?: string }> = new Map();
  
  // Current trial list from UI (synced on each message)
  private currentTrialList: { id: string; name: string; title: string; nctId?: string; status: string; statusReason?: string }[] = [];

  constructor(apiKey: string, patientProfile?: PatientProfile, onLog?: (level: 'log' | 'warn' | 'error', ...args: unknown[]) => void) {
    this.openai = new OpenAI({ 
      apiKey,
      dangerouslyAllowBrowser: true, // Required for browser extension context
    });
    this.scriApi = new SCRIApiClient();
    this.patientProfile = patientProfile;
    this.onLog = onLog;
  }
  
  /**
   * Set the current trial list from the UI
   */
  setCurrentTrialList(trialList: { id: string; name: string; title: string; nctId?: string; status: string; statusReason?: string }[]): void {
    this.currentTrialList = trialList;
    this.log('log', `[Agent] 📋 Updated current trial list: ${trialList.length} trials`);
  }

  /**
   * Internal logging that can be forwarded to UI
   */
  private log(level: 'log' | 'warn' | 'error', ...args: unknown[]): void {
    console[level](...args);
    this.onLog?.(level, ...args);
  }

  /**
   * Cache a trial for later detailed retrieval
   */
  private cacheTrials(trials: SCRITrial[], userZipCode?: string): void {
    for (const trial of trials) {
      // Cache by both studyId and studyName for flexible lookup
      this.trialCache.set(trial.studyId, { trial, userZipCode });
      if (trial.studyName) {
        this.trialCache.set(trial.studyName.toUpperCase(), { trial, userZipCode });
      }
    }
    this.log('log', `[Agent] 📦 Cached ${trials.length} trials (total cache: ${this.trialCache.size} entries)`);
  }

  /**
   * Get a trial from cache by ID or name
   */
  private getCachedTrial(studyId: string): { trial: SCRITrial; userZipCode?: string } | undefined {
    // Try exact match first
    let cached = this.trialCache.get(studyId);
    if (cached) return cached;
    
    // Try uppercase name match
    cached = this.trialCache.get(studyId.toUpperCase());
    if (cached) return cached;
    
    // Try partial match on name (e.g., "BRE-430" matching "BRE-430-001")
    for (const [key, value] of this.trialCache) {
      if (key.includes(studyId.toUpperCase()) || studyId.toUpperCase().includes(key)) {
        return value;
      }
    }
    
    return undefined;
  }

  /**
   * Update the patient profile
   */
  setPatientProfile(profile: PatientProfile): void {
    this.patientProfile = profile;
  }

  /**
   * Get current conversation state (for debugging/testing)
   */
  getConversationState(): { previousResponseId?: string; hasActiveConversation: boolean } {
    return {
      previousResponseId: this.previousResponseId,
      hasActiveConversation: !!this.previousResponseId,
    };
  }

  /**
   * Restore conversation state from persisted storage
   * Used when service worker restarts
   */
  restoreConversationState(previousResponseId: string): void {
    this.previousResponseId = previousResponseId;
    this.log('log', `[Agent] Restored previousResponseId: ${previousResponseId.slice(0, 20)}...`);
  }

  /**
   * Generate the system prompt for the agent
   * Quality-focused: emphasizes conversation, relevance, and honesty
   */
  getSystemPrompt(): string {
    let prompt = `You are a compassionate and knowledgeable clinical trial navigator for the Sarah Cannon Research Institute (SCRI).

## Your Core Mission
Help patients find the RIGHT clinical trials through a guided funnel process. The UI has a "My Trials" panel on the right where patients build their consideration list.

## The Trial Funnel Process

### Phase 1: Discovery
- Search for trials matching patient's cancer type and location
- Present 3-5 promising matches with the trial CARDS (UI renders these automatically)
- Each card has an "Add to My List" button - encourage patients to add interesting trials

### Phase 2: Refinement (CRITICAL)
As the patient shares more about their situation, PROACTIVELY check eligibility:
- When patient mentions age, prior treatments, stage, performance status, etc.
- Call check_patient_eligibility for trials in their list that have NCT IDs
- Then call update_trial_eligibility_status to mark trials as likely_eligible, likely_ineligible, or needs_review
- Explain your reasoning briefly - the status will show in their trial list

### Phase 3: Action
- When patient is ready, they can "Request Matching" from the UI
- This submits their eligible trials to SCRI for follow-up
- Help them understand next steps

## Key Principles

### 1. Two-Phase Search Strategy
- **Phase 1 (Broad Search)**: Use search_trials to get 15-20 slim results
- **Phase 2 (Deep Dive)**: Call get_study_details on the 3-5 most promising matches
- Cards have "Add to My List" button - encourage this!

### 2. Proactive Eligibility Checking
- When patient reveals relevant info (age, prior treatments, etc.), CHECK ELIGIBILITY
- For each trial they've added, call check_patient_eligibility (if NCT ID exists)
- Then call update_trial_eligibility_status to update their list
- This winnows down their list automatically

### 3. Output Format (CRITICAL - READ CAREFULLY)
The UI automatically renders trial data as interactive CARDS below your message. These cards show:
- Trial name (e.g., BRE-430)
- NCT ID
- Phase
- Location and distance
- "Add to My List" button

**YOU MUST NOT:**
- List trial names, IDs, phases, or locations in your text
- Create numbered lists of trials
- Repeat ANY information that appears on the cards

**YOU SHOULD:**
- Provide a brief intro: "I found X trials that might be good matches."
- Add context the cards don't show: why certain trials might be especially relevant
- Highlight 1-2 key insights: "BRE-430 is testing a newer HER2 therapy that's shown promise"
- Encourage action: "Take a look at the cards below and add any that interest you to your list"
- Ask follow-up questions to refine the search

**GOOD example:** "I found 4 breast cancer trials near Nashville. The first two are studying newer targeted therapies. Add any that look promising to your list, and I can check eligibility once I know more about your treatment history."

**BAD example:** "Here are the trials I found: 1. BRE-430 (NCT12345) - Phase 2, Nashville, TN 2. BRE-445 (NCT67890)..." ← NEVER DO THIS

### 4. Conversational Refinement
- ASK clarifying questions to help with eligibility:
  - What type/subtype of cancer? (HER2+, triple-negative, etc.)
  - What stage? 
  - What treatments have they already tried?
  - Any significant health conditions?
  - How far are they willing to travel?
- EACH ANSWER should trigger eligibility reassessment

### 5. Empathy and Support
- Acknowledge this is a difficult time
- Use clear, non-technical language
- Never provide medical advice
- Always recommend discussing options with their oncologist

### 6. Eligibility Transparency
- Use check_patient_eligibility to assess trials against patient profile
- Be honest about what might disqualify them
- "needs_review" means the oncologist should weigh in

## Available Tools
- search_trials: Search SCRI trials (returns cards with "Add to My List")
- get_study_details: Get full details on a specific trial
- add_to_trial_list: Add a trial to the patient's "My Trials" list
- get_trial_list: Get the current list of trials in patient's list
- remove_from_trial_list: Remove a trial from patient's list
- check_patient_eligibility: Fetch CT.gov criteria and compare to patient
- update_trial_eligibility_status: Update a trial's status in their list (likely_eligible/likely_ineligible/needs_review/unknown)
- get_trial_eligibility: Get raw eligibility text
- get_trial_treatment_info: Get treatment details
- search_all_trials: Backstop search on ClinicalTrials.gov
- get_available_cancer_types: List available cancer types`;

    if (this.patientProfile) {
      prompt += `\n\n## Current Patient Profile`;
      if (this.patientProfile.cancerType) {
        prompt += `\n- Cancer Type: ${this.patientProfile.cancerType}`;
      }
      if (this.patientProfile.zipCode) {
        prompt += `\n- Location (ZIP): ${this.patientProfile.zipCode}`;
      }
      if (this.patientProfile.age) {
        prompt += `\n- Age: ${this.patientProfile.age}`;
      }
      if (this.patientProfile.stage) {
        prompt += `\n- Stage: ${this.patientProfile.stage}`;
      }
      if (this.patientProfile.travelRadius) {
        prompt += `\n- Willing to travel: ${this.patientProfile.travelRadius} miles`;
      }
      if (this.patientProfile.previousTreatments?.length) {
        prompt += `\n- Previous treatments: ${this.patientProfile.previousTreatments.join(', ')}`;
      }
    }

    return prompt;
  }

  /**
   * Execute a tool call from the agent
   * Quality-focused tools for better patient experience
   */
  async executeTool(
    toolName: string,
    args: Record<string, unknown>
  ): Promise<unknown> {
    switch (toolName) {
      case 'search_trials': {
        const cancerType = args.cancerType as string;
        const zipCode = args.zipCode as string | undefined;
        
        const searchData = await this.scriApi.searchTrials(cancerType, 1);
        
        // Cache full trial data for later retrieval via get_study_details
        this.cacheTrials(searchData.searchResultsData, zipCode);
        
        // Convert to SLIM results for quick scanning
        const userCoords = zipCode ? getZipCoordinates(zipCode) : null;
        
        const slimResults: TrialSearchResult[] = searchData.searchResultsData.map((t) => {
          // Find closest location if we have user coordinates
          let closestCity: string | undefined;
          let closestState: string | undefined;
          let distance: number | undefined;
          
          const locations = t.officeList.length > 0 ? t.officeList : t.siteList;
          
          if (userCoords && locations.length > 0) {
            let minDist = Infinity;
            for (const loc of locations) {
              if (loc.latitude && loc.longitude) {
                const locLat = parseFloat(String(loc.latitude));
                const locLon = parseFloat(String(loc.longitude));
                if (!isNaN(locLat) && !isNaN(locLon)) {
                  const d = calculateDistance(userCoords.lat, userCoords.lon, locLat, locLon);
                  if (d < minDist) {
                    minDist = d;
                    closestCity = (loc.city || '').trim();
                    closestState = loc.state;
                    distance = d;
                  }
                }
              }
            }
          } else if (locations.length > 0) {
            closestCity = (locations[0].city || '').trim();
            closestState = locations[0].state;
          }
          
          return {
            id: t.studyId,
            name: t.studyName,
            title: t.protocolTitle,
            nctId: t.nct,
            phases: t.phaseNames,
            closestCity,
            closestState,
            distance,
            scriUrl: `https://trials.scri.com/trialdetail/${t.studyId}`,
          };
        });
        
        // Sort by distance if available, take top 20
        let sortedResults: TrialSearchResult[];
        if (zipCode) {
          sortedResults = slimResults
            .filter(t => t.distance !== undefined)
            .sort((a, b) => (a.distance || 999) - (b.distance || 999))
            .slice(0, 20);
          
          // If not enough trials with distance, add some without
          if (sortedResults.length < 20) {
            const remaining = slimResults
              .filter(t => t.distance === undefined)
              .slice(0, 20 - sortedResults.length);
            sortedResults = [...sortedResults, ...remaining];
          }
        } else {
          sortedResults = slimResults.slice(0, 20);
        }
        
        return {
          searchQuery: { cancerType, zipCode: zipCode || 'not provided' },
          totalFound: searchData.totalItemCount,
          showing: sortedResults.length,
          message: zipCode 
            ? `Found ${searchData.totalItemCount} ${cancerType} trials. Showing top ${sortedResults.length} sorted by distance. Use get_study_details to dig deeper.`
            : `Found ${searchData.totalItemCount} ${cancerType} trials. Showing ${sortedResults.length}. Provide ZIP to sort by distance. Use get_study_details to dig deeper.`,
          trials: sortedResults,
        };
      }

      case 'get_study_details': {
        const studyId = args.studyId as string;
        
        // Try to get from cache first
        const cached = this.getCachedTrial(studyId);
        
        if (cached) {
          this.log('log', `[Agent] 📋 Found ${studyId} in cache`);
          const summary = SCRIApiClient.toTrialSummary(cached.trial, cached.userZipCode);
          return {
            found: true,
            source: 'cache',
            trial: summary,
          };
        }
        
        // If not in cache, try to fetch from API
        this.log('log', `[Agent] 🔍 Fetching ${studyId} from SCRI API`);
        try {
          const trial = await this.scriApi.getTrialDetails(studyId);
          const summary = SCRIApiClient.toTrialSummary(trial);
          return {
            found: true,
            source: 'api',
            trial: summary,
          };
        } catch {
          return {
            found: false,
            error: `Could not find trial with ID "${studyId}". Make sure to use the study ID from search results.`,
          };
        }
      }

      case 'get_trial_eligibility': {
        const nctId = args.nctId as string;
        const study = await fetchCTGovStudy(nctId);
        
        if (!study) {
          return { error: `Could not fetch study ${nctId} from ClinicalTrials.gov` };
        }
        
        return {
          nctId,
          title: study.protocolSection?.identificationModule?.briefTitle,
          eligibility: formatEligibilityForDisplay(study),
        };
      }

      case 'get_trial_treatment_info': {
        const nctId = args.nctId as string;
        const study = await fetchCTGovStudy(nctId);
        
        if (!study) {
          return { error: `Could not fetch study ${nctId} from ClinicalTrials.gov` };
        }
        
        return {
          nctId,
          title: study.protocolSection?.identificationModule?.briefTitle,
          treatmentInfo: formatTreatmentInfo(study),
        };
      }

      case 'get_available_cancer_types': {
        return this.scriApi.getCancerTypeList();
      }

      case 'search_all_trials': {
        const condition = args.condition as string;
        const location = args.location as string | undefined;
        const distance = (args.distance as number) || 100;
        
        this.log('log', `[Agent] 🌐 Backstop search on ClinicalTrials.gov: "${condition}" near "${location || 'any'}" within ${distance}mi`);
        
        const results = await searchCTGov(condition, location, distance, 10);
        
        return {
          source: 'ClinicalTrials.gov',
          note: 'These are trials from ALL institutions, not just SCRI',
          searchQuery: { condition, location, distance },
          totalFound: results.length,
          trials: results.map(r => ({
            nctId: r.nctId,
            title: r.briefTitle,
            phase: r.phase,
            status: r.status,
            conditions: r.conditions,
            treatments: r.interventions,
            sampleLocations: r.locations,
          })),
        };
      }

      case 'add_to_trial_list': {
        const trialId = args.trialId as string;
        const trialName = args.trialName as string;
        const reason = args.reason as string | undefined;
        
        this.log('log', `[Agent] ➕ Adding trial to list: ${trialName} (${trialId})`);
        
        // Try to get full trial data from cache
        const cached = this.getCachedTrial(trialId) || this.getCachedTrial(trialName);
        
        if (cached) {
          const summary = SCRIApiClient.toTrialSummary(cached.trial, cached.userZipCode);
          return {
            success: true,
            trialId,
            trialName,
            reason,
            message: `Added ${trialName} to your trial list`,
            trialData: summary,
            uiAction: 'ADD_TRIAL_TO_LIST',
          };
        }
        
        // If not in cache, return minimal data
        return {
          success: true,
          trialId,
          trialName,
          reason,
          message: `Added ${trialName} to your trial list`,
          trialData: {
            id: trialId,
            name: trialName,
            title: '',
            nctId: '',
            phases: [],
            scriUrl: `https://trials.scri.com/trialdetail/${trialId}`,
          },
          uiAction: 'ADD_TRIAL_TO_LIST',
        };
      }

      case 'check_patient_eligibility': {
        const trialId = args.trialId as string;
        const nctId = args.nctId as string | undefined;
        const trialName = args.trialName as string;
        
        this.log('log', `[Agent] 🔍 Checking eligibility for ${trialName} (${nctId || 'no NCT'})`);
        
        if (!nctId) {
          return {
            trialId,
            trialName,
            status: 'unknown',
            reason: 'No NCT ID available - cannot fetch eligibility criteria from ClinicalTrials.gov',
            recommendation: 'Contact the trial site directly to discuss eligibility.',
          };
        }
        
        const study = await fetchCTGovStudy(nctId);
        if (!study) {
          return {
            trialId,
            trialName,
            status: 'unknown',
            reason: `Could not fetch eligibility criteria for ${nctId}`,
            recommendation: 'Try again later or contact the trial site directly.',
          };
        }
        
        const eligibility = formatEligibilityForDisplay(study);
        
        // Return eligibility info for the AI to interpret based on patient profile
        return {
          trialId,
          trialName,
          nctId,
          eligibilityCriteria: eligibility,
          patientProfile: this.patientProfile || {},
          instruction: 'Compare the eligibility criteria against the patient profile. Determine if the patient appears likely_eligible, likely_ineligible, or needs_review. Call update_trial_eligibility_status with your assessment.',
        };
      }

      case 'update_trial_eligibility_status': {
        const trialId = args.trialId as string;
        const status = args.status as string;
        const reason = args.reason as string;
        
        this.log('log', `[Agent] 📋 Updating eligibility status for ${trialId}: ${status} - ${reason}`);
        
        // This will be picked up by the UI through the tool result
        return {
          success: true,
          trialId,
          status,
          reason,
          message: `Updated ${trialId} eligibility status to ${status}`,
          // Signal to UI to update the trial list
          uiAction: 'UPDATE_TRIAL_STATUS',
        };
      }

      case 'get_trial_list': {
        this.log('log', `[Agent] 📋 Getting current trial list: ${this.currentTrialList.length} trials`);
        
        if (this.currentTrialList.length === 0) {
          return {
            success: true,
            count: 0,
            trials: [],
            message: 'The patient has not added any trials to their list yet.',
          };
        }
        
        return {
          success: true,
          count: this.currentTrialList.length,
          trials: this.currentTrialList.map(t => ({
            id: t.id,
            name: t.name,
            title: t.title,
            nctId: t.nctId,
            eligibilityStatus: t.status,
            statusReason: t.statusReason,
          })),
          summary: {
            total: this.currentTrialList.length,
            likely_eligible: this.currentTrialList.filter(t => t.status === 'likely_eligible').length,
            likely_ineligible: this.currentTrialList.filter(t => t.status === 'likely_ineligible').length,
            needs_review: this.currentTrialList.filter(t => t.status === 'needs_review').length,
            unknown: this.currentTrialList.filter(t => t.status === 'unknown').length,
          },
          message: `The patient has ${this.currentTrialList.length} trial(s) in their consideration list.`,
        };
      }

      case 'remove_from_trial_list': {
        const trialId = args.trialId as string;
        const reason = args.reason as string | undefined;
        
        this.log('log', `[Agent] ➖ Removing trial from list: ${trialId}`);
        
        return {
          success: true,
          trialId,
          reason,
          message: `Removed ${trialId} from your trial list`,
          uiAction: 'REMOVE_TRIAL_FROM_LIST',
        };
      }

      default:
        throw new Error(`Unknown tool: ${toolName}`);
    }
  }

  /**
   * Format trial summaries for display to the user
   */
  formatTrialsForDisplay(trials: TrialSummary[]): string {
    if (trials.length === 0) {
      return 'No trials found matching your criteria.';
    }

    return trials
      .map((trial, index) => {
        let result = `${index + 1}. **${trial.name}** (${trial.nctId})`;
        if (trial.phases.length > 0) {
          result += ` - ${trial.phases.join(', ')}`;
        }
        result += `\n   ${trial.title}`;
        if (trial.closestLocation) {
          result += `\n   📍 ${trial.closestLocation.name} - ${trial.closestLocation.city}, ${trial.closestLocation.state}`;
          if (trial.closestLocation.distance) {
            result += ` (${trial.closestLocation.distance} miles)`;
          }
          if (trial.closestLocation.phone) {
            result += `\n   📞 ${trial.closestLocation.phone}`;
          }
        }
        result += `\n   🏥 ${trial.locationCount} location(s) available`;
        return result;
      })
      .join('\n\n');
  }

  /**
   * Process a user message and generate a response
   * Uses OpenAI Responses API with function calling
   */
  async chat(userMessage: string): Promise<{
    text: string;
    trials?: (TrialSummary | TrialSearchResult)[];
    eligibilityUpdates?: { trialId: string; status: string; reason: string }[];
    trialsToAdd?: { trialId: string; trialName: string; reason?: string; trialData: TrialSummary | Partial<TrialSummary> }[];
    trialsToRemove?: { trialId: string; reason?: string }[];
  }> {
    // For Responses API: if we have a previous response, just send the new message as a string
    // The API will automatically append it to the conversation history
    const input: OpenAI.Responses.ResponseInput = this.previousResponseId
      ? userMessage
      : [{ role: 'user', content: userMessage }];

    this.log('log', `[Agent] 💬 Chat called. previousResponseId: ${this.previousResponseId?.slice(0, 20) || 'none'}`);

    // Create initial response
    let response = await this.openai.responses.create({
      model: 'gpt-5-nano',
      instructions: this.getSystemPrompt(),
      input,
      tools: AGENT_TOOLS,
      previous_response_id: this.previousResponseId,
      reasoning: { effort: 'low' },
    });

    this.log('log', `[Agent] Initial response id: ${response.id.slice(0, 20)}, status: ${response.status}`);

    // Process tool calls if any
    // Note: allTrials can contain either TrialSummary (from get_study_details) or TrialSearchResult (from search_trials)
    let allTrials: (TrialSummary | TrialSearchResult)[] = [];
    let eligibilityUpdates: { trialId: string; status: string; reason: string }[] = [];
    let trialsToAdd: { trialId: string; trialName: string; reason?: string; trialData: TrialSummary | Partial<TrialSummary> }[] = [];
    let trialsToRemove: { trialId: string; reason?: string }[] = [];
    let loopCount = 0;
    const maxLoops = 10; // Safety limit
    
    while (response.status === 'completed' && response.output && loopCount < maxLoops) {
      loopCount++;
      
      // Check if there are any function calls to process
      const functionCalls = response.output.filter(
        (item): item is OpenAI.Responses.ResponseFunctionToolCall =>
          item.type === 'function_call'
      );

      if (functionCalls.length === 0) {
        // No more tool calls - we have the final response
        break;
      }

      this.log('log', `[Agent] ⚙️ Processing ${functionCalls.length} tool call(s):`);
      functionCalls.forEach(f => this.log('log', `[Agent]   → ${f.name}(${f.arguments})`));

      // Execute all function calls
      const toolResults: OpenAI.Responses.ResponseInputItem[] = [];
      
      for (const call of functionCalls) {
        try {
          const args = JSON.parse(call.arguments);
          this.log('log', `[Agent] 🔧 Executing: ${call.name}`);
          const startTime = Date.now();
          const result = await this.executeTool(call.name, args);
          const elapsed = Date.now() - startTime;
          this.log('log', `[Agent] ✅ ${call.name} completed in ${elapsed}ms`);
          this.log('log', `[Agent]   Result preview: ${JSON.stringify(result).slice(0, 200)}...`);
          
          // Collect trials from search results
          if (call.name === 'search_trials' && typeof result === 'object' && result !== null) {
            const searchResult = result as { trials: TrialSearchResult[] };
            if (searchResult.trials) {
              allTrials = [...allTrials, ...searchResult.trials];
            }
          }
          // Also collect trials from get_study_details
          if (call.name === 'get_study_details' && typeof result === 'object' && result !== null) {
            const detailResult = result as { found: boolean; trial?: TrialSummary };
            if (detailResult.found && detailResult.trial) {
              allTrials = [...allTrials, detailResult.trial];
            }
          }
          // Collect eligibility status updates
          if (call.name === 'update_trial_eligibility_status' && typeof result === 'object' && result !== null) {
            const updateResult = result as { trialId: string; status: string; reason: string };
            eligibilityUpdates.push({
              trialId: updateResult.trialId,
              status: updateResult.status,
              reason: updateResult.reason,
            });
          }
          // Collect trial additions
          if (call.name === 'add_to_trial_list' && typeof result === 'object' && result !== null) {
            const addResult = result as { success: boolean; trialId: string; trialName: string; reason?: string; trialData?: TrialSummary | Partial<TrialSummary> };
            if (addResult.success && addResult.trialData) {
              trialsToAdd.push({
                trialId: addResult.trialId,
                trialName: addResult.trialName,
                reason: addResult.reason,
                trialData: addResult.trialData,
              });
            }
          }
          // Collect trial removals
          if (call.name === 'remove_from_trial_list' && typeof result === 'object' && result !== null) {
            const removeResult = result as { success: boolean; trialId: string; reason?: string };
            if (removeResult.success) {
              trialsToRemove.push({
                trialId: removeResult.trialId,
                reason: removeResult.reason,
              });
            }
          }
          
          toolResults.push({
            type: 'function_call_output',
            call_id: call.call_id,
            output: JSON.stringify(result),
          });
        } catch (error) {
          this.log('error', `[Agent] ❌ Tool error (${call.name}): ${error}`);
          toolResults.push({
            type: 'function_call_output',
            call_id: call.call_id,
            output: JSON.stringify({ error: String(error) }),
          });
        }
      }

      // Continue conversation with tool results, chaining from current response
      response = await this.openai.responses.create({
        model: 'gpt-5-nano',
        instructions: this.getSystemPrompt(),
        input: toolResults,
        tools: AGENT_TOOLS,
        previous_response_id: response.id,
        reasoning: { effort: 'low' },
      });

      this.log('log', `[Agent] After tool processing, response id: ${response.id.slice(0, 20)}, status: ${response.status}`);
    }

    // IMPORTANT: Store the FINAL response ID for conversation continuity
    // This ensures the next user message chains from the complete exchange
    this.previousResponseId = response.id;
    this.log('log', `[Agent] Final previousResponseId set to: ${this.previousResponseId.slice(0, 20)}`);

    // Extract text response
    const textOutput = response.output?.find(
      (item): item is OpenAI.Responses.ResponseOutputMessage =>
        item.type === 'message'
    );

    const text = textOutput?.content
      ?.filter((c): c is OpenAI.Responses.ResponseOutputText => c.type === 'output_text')
      .map((c) => c.text)
      .join('\n') || 'I apologize, but I was unable to generate a response.';

    return {
      text,
      trials: allTrials.length > 0 ? allTrials : undefined,
      eligibilityUpdates: eligibilityUpdates.length > 0 ? eligibilityUpdates : undefined,
      trialsToAdd: trialsToAdd.length > 0 ? trialsToAdd : undefined,
      trialsToRemove: trialsToRemove.length > 0 ? trialsToRemove : undefined,
    };
  }

  /**
   * Reset the conversation
   */
  resetConversation(): void {
    this.previousResponseId = undefined;
    this.conversationId = undefined;
  }
}
