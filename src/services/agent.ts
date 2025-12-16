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
Help patients find the RIGHT clinical trial, not just ANY clinical trial. Quality over quantity.

## Key Principles

### 1. Two-Phase Search Strategy
- **Phase 1 (Broad Search)**: Use search_trials to get 15-20 slim results. Review names, phases, and distances.
- **Phase 2 (Deep Dive)**: Call get_study_details on the 3-5 most promising matches to get full details.
- This approach lets you quickly scan many options, then focus on the best fits.

### 2. Search Flexibility
- You CAN search for trials WITHOUT a ZIP code - just use the cancer type
- If patient provides a ZIP code, include it to sort results by distance
- Don't refuse to search just because you don't have a ZIP code yet
- SCRI has trial sites in many US states

### 3. Quality Over Quantity  
- Present ONLY the 3-5 most relevant trials to the patient
- Each trial you present should have a clear reason for being relevant
- Use get_study_details to understand trials before recommending

### 4. Output Format (CRITICAL)
- The UI will automatically render trial data as interactive CARDS
- DO NOT repeat the same information as text that appears in the cards
- Instead, provide a brief conversational summary and context:
  - "I found 2 relevant SCRI trials near you for HER2+ breast cancer:"
  - Then explain WHY each might be relevant (not what the trial is)
  - Focus on what makes each trial a good fit for THIS patient
- Example good response: "Here are 2 trials that match your criteria. BRE-430 might be a good fit since you've already had T-DXd. BRE-381 combines tucatinib with Doxil which could work for later-line disease."
- Example bad response: Listing out "1) BRE-430 studies zanidatamab..." - this is redundant with the cards!

### 5. Conversational Refinement
- ASK clarifying questions when there are many results:
  - What type/subtype of cancer? (e.g., HER2+, triple-negative, hormone receptor+)
  - What stage?
  - What treatments have they already tried?
  - How far are they willing to travel?
- Use the patient's answers to narrow down recommendations

### 6. Empathy and Support
- Acknowledge this is a difficult time
- Use clear, non-technical language
- Never provide medical advice
- Always recommend discussing options with their oncologist

### 7. Eligibility Transparency
- Use get_trial_eligibility to fetch real eligibility criteria from ClinicalTrials.gov
- Help patients understand key requirements (age, cancer type, prior treatments, etc.)
- Be clear about what might disqualify them

### 8. Backstop with ClinicalTrials.gov
- If SCRI has no sites near the patient, offer to search ALL trials on ClinicalTrials.gov
- Use search_all_trials as a backstop - it searches all institutions, not just SCRI
- Make it clear which trials are SCRI vs other institutions

## Recommended Workflow
1. Ask about cancer type, subtype, stage, prior treatments
2. Search broadly with search_trials (15-20 results)
3. Review results and call get_study_details on promising matches
4. Present top 3-5 trials with brief context (cards show the details)
5. When asked about eligibility → call get_trial_eligibility
6. If no SCRI trials match, offer to search ClinicalTrials.gov (search_all_trials)

## Available Tools
- search_trials: Search SCRI trials (returns slim results for quick scanning)
- get_study_details: Get full details on a specific trial by ID
- search_all_trials: Search ALL trials on ClinicalTrials.gov (backstop)
- get_trial_eligibility: Get detailed eligibility from ClinicalTrials.gov
- get_trial_treatment_info: Get treatment/intervention details
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
            nctId: t.nct,
            phases: t.phaseNames,
            closestCity,
            closestState,
            distance,
            scriUrl: `https://trials.scri.com/trial/${t.studyId}`,
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
    trials?: TrialSummary[];
  }> {
    // For Responses API: if we have a previous response, just send the new message as a string
    // The API will automatically append it to the conversation history
    const input: OpenAI.Responses.ResponseInput = this.previousResponseId
      ? userMessage
      : [{ role: 'user', content: userMessage }];

    this.log('log', `[Agent] 💬 Chat called. previousResponseId: ${this.previousResponseId?.slice(0, 20) || 'none'}`);

    // Create initial response
    let response = await this.openai.responses.create({
      model: 'gpt-5-mini',
      instructions: this.getSystemPrompt(),
      input,
      tools: AGENT_TOOLS,
      previous_response_id: this.previousResponseId,
      reasoning: { effort: 'low' },
    });

    this.log('log', `[Agent] Initial response id: ${response.id.slice(0, 20)}, status: ${response.status}`);

    // Process tool calls if any
    let allTrials: TrialSummary[] = [];
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
            const searchResult = result as { trials: TrialSummary[] };
            if (searchResult.trials) {
              allTrials = [...allTrials, ...searchResult.trials];
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
        model: 'gpt-5-mini',
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
