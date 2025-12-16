#!/usr/bin/env node
/**
 * Quality-focused CLI Trial Agent
 * Emphasizes conversation quality over quantity of results
 */

import * as fs from 'fs';
import * as path from 'path';
import * as readline from 'readline';
import OpenAI from 'openai';
import { SCRIApiClient } from '../services/scri-api';
import { 
  fetchCTGovStudy, 
  formatEligibilityForDisplay, 
  formatTreatmentInfo,
  type CTGovStudy,
} from '../services/clinicaltrials-gov';
import { 
  getCoverageMessage, 
  getZipCoordinates, 
  hasStateCoverage,
  SCRI_COVERAGE_STATES,
} from '../services/geo';
import type { PatientProfile, TrialSummary } from '../types';

const colors = {
  reset: '\x1b[0m',
  bright: '\x1b[1m',
  dim: '\x1b[2m',
  cyan: '\x1b[36m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  red: '\x1b[31m',
  blue: '\x1b[34m',
  magenta: '\x1b[35m',
};

/**
 * Quality-focused tool definitions
 * Fewer, more focused tools with richer outputs
 */
const QUALITY_TOOLS: OpenAI.Responses.Tool[] = [
  {
    type: 'function',
    name: 'check_location_coverage',
    description: 
      'ALWAYS call this first when a patient mentions their location. ' +
      'Checks if SCRI has trial sites near the patient and provides honest feedback about geographic coverage.',
    parameters: {
      type: 'object',
      properties: {
        zipCode: {
          type: 'string',
          description: 'Patient ZIP code',
        },
      },
      required: ['zipCode'],
    },
  },
  {
    type: 'function',
    name: 'search_trials_nearby',
    description:
      'Search for trials sorted by distance from patient. Returns TOP 5 closest matches. ' +
      'Only use after checking location coverage.',
    parameters: {
      type: 'object',
      properties: {
        cancerType: {
          type: 'string',
          description: "Cancer type (e.g., 'Breast', 'Lung'). Use exact names.",
        },
        zipCode: {
          type: 'string',
          description: 'Patient ZIP code for distance calculation',
        },
        maxDistanceMiles: {
          type: 'number',
          description: 'Maximum distance in miles (default 500)',
        },
      },
      required: ['cancerType'],
    },
  },
  {
    type: 'function',
    name: 'get_trial_eligibility',
    description:
      'Get detailed eligibility criteria for a specific trial from ClinicalTrials.gov. ' +
      'Use this when patient asks about qualifications or requirements for a trial.',
    parameters: {
      type: 'object',
      properties: {
        nctId: {
          type: 'string',
          description: 'NCT identifier (e.g., NCT03448926)',
        },
      },
      required: ['nctId'],
    },
  },
  {
    type: 'function',
    name: 'get_trial_treatment_info',
    description:
      'Get information about what treatments/drugs are being tested in a trial. ' +
      'Use when patient asks what a trial involves or what drug is being tested.',
    parameters: {
      type: 'object',
      properties: {
        nctId: {
          type: 'string',
          description: 'NCT identifier',
        },
      },
      required: ['nctId'],
    },
  },
  {
    type: 'function',
    name: 'get_available_cancer_types',
    description: 'Get the list of cancer types that can be searched.',
    parameters: {
      type: 'object',
      properties: {},
    },
  },
];

/**
 * Quality-focused system prompt
 */
function getQualitySystemPrompt(profile?: PatientProfile): string {
  let prompt = `You are a compassionate and thoughtful clinical trial navigator for Sarah Cannon Research Institute (SCRI).

## Your Approach
You prioritize QUALITY over QUANTITY. Instead of overwhelming patients with lists of trials:
1. Ask clarifying questions to understand their situation
2. Be upfront about geographic limitations  
3. Show only the 3-5 most relevant trials
4. Explain WHY each trial might be a good match
5. Help patients understand eligibility requirements

## Conversation Flow
1. First message: Welcome them warmly, acknowledge their situation
2. Ask about their location EARLY - SCRI doesn't have sites everywhere
3. Learn about their cancer type, stage, and prior treatments
4. Search for trials only when you have enough context
5. Present results thoughtfully with context

## Geographic Reality
SCRI has trial sites in these states ONLY: ${SCRI_COVERAGE_STATES.join(', ')}
- If patient is NOT in these states, be HONEST and upfront
- Explain nearest options and ask about willingness to travel
- Don't waste their time showing trials they can't access

## Quality Standards
- NEVER dump a long list of trials without context
- ALWAYS explain why a trial might fit (or not fit) their situation
- When showing trials, include:
  - Distance from patient
  - Phase and what that means
  - Brief explanation of what's being studied
- Encourage them to discuss options with their oncologist

## Tools Available
- check_location_coverage: ALWAYS use first when patient shares location
- search_trials_nearby: Returns top 5 closest trials (use only after coverage check)
- get_trial_eligibility: Get detailed eligibility from ClinicalTrials.gov
- get_trial_treatment_info: Learn what treatments are being studied
- get_available_cancer_types: List searchable cancer types`;

  if (profile) {
    prompt += `\n\n## Current Patient Profile`;
    if (profile.cancerType) prompt += `\n- Cancer Type: ${profile.cancerType}`;
    if (profile.zipCode) {
      const location = getZipCoordinates(profile.zipCode);
      if (location) {
        prompt += `\n- Location: ${location.city}, ${location.state} (${profile.zipCode})`;
        prompt += `\n- Has SCRI coverage: ${hasStateCoverage(location.state) ? 'YES' : 'NO'}`;
      } else {
        prompt += `\n- ZIP Code: ${profile.zipCode}`;
      }
    }
    if (profile.stage) prompt += `\n- Stage: ${profile.stage}`;
    if (profile.previousTreatments?.length) {
      prompt += `\n- Previous treatments: ${profile.previousTreatments.join(', ')}`;
    }
  }

  return prompt;
}

/**
 * Quality-focused Trial Agent
 */
class QualityTrialAgent {
  private openai: OpenAI;
  private scriApi: SCRIApiClient;
  private patientProfile?: PatientProfile;
  private previousResponseId?: string;
  private ctgovCache: Map<string, CTGovStudy> = new Map();

  constructor(apiKey: string, patientProfile?: PatientProfile) {
    this.openai = new OpenAI({ apiKey });
    this.scriApi = new SCRIApiClient();
    this.patientProfile = patientProfile;
  }

  setPatientProfile(profile: PatientProfile): void {
    this.patientProfile = profile;
  }

  async executeTool(toolName: string, args: Record<string, unknown>): Promise<unknown> {
    switch (toolName) {
      case 'check_location_coverage': {
        const zipCode = args.zipCode as string;
        const location = getZipCoordinates(zipCode);
        const message = getCoverageMessage(zipCode);
        
        return {
          zipCode,
          location: location ? {
            city: location.city,
            state: location.state,
          } : null,
          hasCoverage: location ? hasStateCoverage(location.state) : false,
          message,
          coverageStates: SCRI_COVERAGE_STATES,
        };
      }

      case 'search_trials_nearby': {
        const cancerType = args.cancerType as string;
        const zipCode = args.zipCode as string || this.patientProfile?.zipCode;
        const maxDistance = (args.maxDistanceMiles as number) || 500;

        const searchData = await this.scriApi.searchTrials(cancerType, 1);
        
        // Get all trials and convert with distance calculation
        let allTrials = searchData.searchResultsData.map(t =>
          SCRIApiClient.toTrialSummary(t, zipCode)
        );

        // Filter by distance if we have distances calculated
        if (zipCode) {
          allTrials = allTrials.filter(t => {
            const distance = t.closestLocation?.distance;
            return distance !== undefined && distance <= maxDistance;
          });
        }

        // Sort by distance
        allTrials.sort((a, b) => {
          const distA = a.closestLocation?.distance ?? Infinity;
          const distB = b.closestLocation?.distance ?? Infinity;
          return distA - distB;
        });

        // Return only top 5
        const topTrials = allTrials.slice(0, 5);

        return {
          totalAvailable: searchData.totalItemCount,
          trialsWithinRange: allTrials.length,
          showingTop: topTrials.length,
          maxDistanceSearched: maxDistance,
          trials: topTrials.map(t => ({
            name: t.name,
            nctId: t.nctId,
            title: t.title,
            phase: t.phases.length > 0 ? t.phases.join(', ') : 'Not specified',
            closestLocation: t.closestLocation ? {
              name: t.closestLocation.name,
              city: t.closestLocation.city,
              state: t.closestLocation.state,
              distance: t.closestLocation.distance,
              phone: t.closestLocation.phone,
            } : null,
            totalLocations: t.locationCount,
          })),
          note: allTrials.length === 0 
            ? `No trials found within ${maxDistance} miles. Consider increasing travel distance.`
            : undefined,
        };
      }

      case 'get_trial_eligibility': {
        const nctId = args.nctId as string;
        
        // Check cache first
        let study = this.ctgovCache.get(nctId);
        if (!study) {
          study = await fetchCTGovStudy(nctId) || undefined;
          if (study) {
            this.ctgovCache.set(nctId, study);
          }
        }

        if (!study) {
          return {
            nctId,
            error: 'Could not fetch eligibility information from ClinicalTrials.gov',
            suggestion: 'Please contact the trial site directly for eligibility details.',
          };
        }

        return {
          nctId,
          title: study.briefTitle,
          eligibility: formatEligibilityForDisplay(study),
          ageRange: study.eligibility?.minimumAge && study.eligibility?.maximumAge
            ? `${study.eligibility.minimumAge} to ${study.eligibility.maximumAge}`
            : study.eligibility?.minimumAge || 'Not specified',
          sex: study.eligibility?.sex || 'All',
          phase: study.phase || 'Not specified',
        };
      }

      case 'get_trial_treatment_info': {
        const nctId = args.nctId as string;
        
        let study = this.ctgovCache.get(nctId);
        if (!study) {
          study = await fetchCTGovStudy(nctId) || undefined;
          if (study) {
            this.ctgovCache.set(nctId, study);
          }
        }

        if (!study) {
          return {
            nctId,
            error: 'Could not fetch treatment information from ClinicalTrials.gov',
          };
        }

        return {
          nctId,
          title: study.briefTitle,
          studyType: study.studyType,
          phase: study.phase,
          briefSummary: study.briefSummary?.substring(0, 500) + (study.briefSummary && study.briefSummary.length > 500 ? '...' : ''),
          treatments: formatTreatmentInfo(study),
          conditions: study.conditions,
        };
      }

      case 'get_available_cancer_types': {
        const types = await this.scriApi.getCancerTypeList();
        return {
          cancerTypes: types,
          note: 'Use these exact names when searching for trials.',
        };
      }

      default:
        throw new Error(`Unknown tool: ${toolName}`);
    }
  }

  async chat(userMessage: string): Promise<{ text: string; trials?: TrialSummary[] }> {
    const input: OpenAI.Responses.ResponseInput = this.previousResponseId
      ? userMessage
      : [{ role: 'user', content: userMessage }];

    let response = await this.openai.responses.create({
      model: 'gpt-5-mini',
      instructions: getQualitySystemPrompt(this.patientProfile),
      input,
      tools: QUALITY_TOOLS,
      previous_response_id: this.previousResponseId,
    });

    this.previousResponseId = response.id;
    let allTrials: TrialSummary[] = [];

    while (response.status === 'completed' && response.output) {
      const functionCalls = response.output.filter(
        (item): item is OpenAI.Responses.ResponseFunctionToolCall =>
          item.type === 'function_call'
      );

      if (functionCalls.length === 0) break;

      const toolResults: OpenAI.Responses.ResponseInputItem[] = [];

      for (const call of functionCalls) {
        try {
          console.log(`${colors.dim}  → ${call.name}${colors.reset}`);
          const args = JSON.parse(call.arguments);
          const result = await this.executeTool(call.name, args);

          toolResults.push({
            type: 'function_call_output',
            call_id: call.call_id,
            output: JSON.stringify(result),
          });
        } catch (error) {
          console.log(`${colors.red}  → Error: ${error}${colors.reset}`);
          toolResults.push({
            type: 'function_call_output',
            call_id: call.call_id,
            output: JSON.stringify({ error: String(error) }),
          });
        }
      }

      response = await this.openai.responses.create({
        model: 'gpt-5-mini',
        instructions: getQualitySystemPrompt(this.patientProfile),
        input: toolResults,
        tools: QUALITY_TOOLS,
        previous_response_id: response.id,
      });

      this.previousResponseId = response.id;
    }

    const textOutput = response.output?.find(
      (item): item is OpenAI.Responses.ResponseOutputMessage => item.type === 'message'
    );

    const text =
      textOutput?.content
        ?.filter((c): c is OpenAI.Responses.ResponseOutputText => c.type === 'output_text')
        .map((c) => c.text)
        .join('\n') || 'I apologize, but I was unable to generate a response.';

    return { text, trials: allTrials.length > 0 ? allTrials : undefined };
  }

  resetConversation(): void {
    this.previousResponseId = undefined;
  }
}

/**
 * Print welcome message
 */
function printWelcome(): void {
  console.log(`
${colors.cyan}╔══════════════════════════════════════════════════════════════╗
║                                                                ║
║   ${colors.bright}SCRI Clinical Trial Navigator${colors.reset}${colors.cyan}                            ║
║   ${colors.dim}Quality-Focused Edition${colors.reset}${colors.cyan}                                    ║
║                                                                ║
╚══════════════════════════════════════════════════════════════╝${colors.reset}

${colors.dim}Commands: /reset /quit /help${colors.reset}
`);
}

/**
 * Main CLI loop
 */
async function main(): Promise<void> {
  const apiKey = fs.readFileSync(path.join(process.cwd(), 'openai.key'), 'utf-8').trim();
  const agent = new QualityTrialAgent(apiKey);

  printWelcome();

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  const prompt = (): void => {
    rl.question(`${colors.green}You: ${colors.reset}`, async (input) => {
      const trimmed = input.trim();

      if (!trimmed) {
        prompt();
        return;
      }

      // Handle commands
      if (trimmed.startsWith('/')) {
        const cmd = trimmed.toLowerCase();

        if (cmd === '/quit' || cmd === '/exit' || cmd === '/q') {
          console.log(`\n${colors.cyan}Take care, and best wishes on your journey.${colors.reset}\n`);
          rl.close();
          process.exit(0);
        }

        if (cmd === '/reset') {
          agent.resetConversation();
          console.log(`${colors.yellow}Conversation reset.${colors.reset}\n`);
          prompt();
          return;
        }

        if (cmd === '/help') {
          printWelcome();
          prompt();
          return;
        }

        console.log(`${colors.red}Unknown command: ${cmd}${colors.reset}\n`);
        prompt();
        return;
      }

      try {
        const response = await agent.chat(trimmed);
        console.log(`\n${colors.cyan}Navigator:${colors.reset} ${response.text}\n`);
      } catch (error) {
        console.error(`\n${colors.red}Error: ${error}${colors.reset}\n`);
      }

      prompt();
    });
  };

  prompt();
}

main().catch(console.error);
