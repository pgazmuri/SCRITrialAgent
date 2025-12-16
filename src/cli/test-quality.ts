#!/usr/bin/env node
/**
 * Quality Agent Test Session
 * Simulates a breast cancer patient from Boston having a quality conversation
 */

import * as fs from 'fs';
import * as path from 'path';
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
};

// Same tools and prompt from quality-agent.ts
const QUALITY_TOOLS: OpenAI.Responses.Tool[] = [
  {
    type: 'function',
    name: 'check_location_coverage',
    description: 
      'ALWAYS call this first when a patient mentions their location. ' +
      'Checks if SCRI has trial sites near the patient.',
    parameters: {
      type: 'object',
      properties: {
        zipCode: { type: 'string', description: 'Patient ZIP code' },
      },
      required: ['zipCode'],
    },
  },
  {
    type: 'function',
    name: 'search_trials_nearby',
    description: 'Search for trials sorted by distance. Returns TOP 5 closest.',
    parameters: {
      type: 'object',
      properties: {
        cancerType: { type: 'string', description: "Cancer type" },
        zipCode: { type: 'string', description: 'Patient ZIP code' },
        maxDistanceMiles: { type: 'number', description: 'Max distance (default 500)' },
      },
      required: ['cancerType'],
    },
  },
  {
    type: 'function',
    name: 'get_trial_eligibility',
    description: 'Get detailed eligibility criteria for a trial from ClinicalTrials.gov.',
    parameters: {
      type: 'object',
      properties: {
        nctId: { type: 'string', description: 'NCT identifier' },
      },
      required: ['nctId'],
    },
  },
  {
    type: 'function',
    name: 'get_trial_treatment_info',
    description: 'Get information about treatments being tested.',
    parameters: {
      type: 'object',
      properties: {
        nctId: { type: 'string', description: 'NCT identifier' },
      },
      required: ['nctId'],
    },
  },
  {
    type: 'function',
    name: 'get_available_cancer_types',
    description: 'Get the list of searchable cancer types.',
    parameters: { type: 'object', properties: {} },
  },
];

function getQualitySystemPrompt(profile?: PatientProfile): string {
  let prompt = `You are a compassionate clinical trial navigator for Sarah Cannon Research Institute (SCRI).

## Your Approach
Prioritize QUALITY over QUANTITY:
1. Ask clarifying questions to understand their situation
2. Be upfront about geographic limitations  
3. Show only 3-5 most relevant trials
4. Explain WHY each trial might fit
5. Help patients understand eligibility

## Geographic Reality
SCRI has trial sites in: ${SCRI_COVERAGE_STATES.join(', ')}
If patient is NOT in these states, be HONEST. Don't waste time on inaccessible trials.

## Quality Standards
- NEVER dump long lists without context
- ALWAYS explain why a trial fits (or doesn't)
- Include distance, phase, and what's being studied
- Encourage discussing with their oncologist`;

  if (profile?.zipCode) {
    const location = getZipCoordinates(profile.zipCode);
    if (location) {
      prompt += `\n\n## Patient Location: ${location.city}, ${location.state}`;
      prompt += `\n## Has SCRI coverage: ${hasStateCoverage(location.state) ? 'YES' : 'NO - IMPORTANT!'}`;
    }
  }

  return prompt;
}

class QualityTestAgent {
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

  async executeTool(toolName: string, args: Record<string, unknown>): Promise<unknown> {
    switch (toolName) {
      case 'check_location_coverage': {
        const zipCode = args.zipCode as string;
        const location = getZipCoordinates(zipCode);
        return {
          zipCode,
          location: location ? { city: location.city, state: location.state } : null,
          hasCoverage: location ? hasStateCoverage(location.state) : false,
          message: getCoverageMessage(zipCode),
        };
      }

      case 'search_trials_nearby': {
        const cancerType = args.cancerType as string;
        const zipCode = args.zipCode as string || this.patientProfile?.zipCode;
        const maxDistance = (args.maxDistanceMiles as number) || 500;

        const searchData = await this.scriApi.searchTrials(cancerType, 1);
        let allTrials = searchData.searchResultsData.map(t =>
          SCRIApiClient.toTrialSummary(t, zipCode)
        );

        if (zipCode) {
          allTrials = allTrials.filter(t => {
            const d = t.closestLocation?.distance;
            return d !== undefined && d <= maxDistance;
          });
        }

        allTrials.sort((a, b) => 
          (a.closestLocation?.distance ?? Infinity) - (b.closestLocation?.distance ?? Infinity)
        );

        return {
          totalAvailable: searchData.totalItemCount,
          trialsWithinRange: allTrials.length,
          trials: allTrials.slice(0, 5).map(t => ({
            name: t.name,
            nctId: t.nctId,
            title: t.title,
            phase: t.phases.length > 0 ? t.phases.join(', ') : 'Not specified',
            closestLocation: t.closestLocation,
          })),
        };
      }

      case 'get_trial_eligibility': {
        const nctId = args.nctId as string;
        let study = this.ctgovCache.get(nctId);
        if (!study) {
          study = await fetchCTGovStudy(nctId) || undefined;
          if (study) this.ctgovCache.set(nctId, study);
        }
        if (!study) return { error: 'Could not fetch eligibility' };
        return {
          title: study.briefTitle,
          eligibility: formatEligibilityForDisplay(study),
        };
      }

      case 'get_trial_treatment_info': {
        const nctId = args.nctId as string;
        let study = this.ctgovCache.get(nctId);
        if (!study) {
          study = await fetchCTGovStudy(nctId) || undefined;
          if (study) this.ctgovCache.set(nctId, study);
        }
        if (!study) return { error: 'Could not fetch treatment info' };
        return {
          title: study.briefTitle,
          treatments: formatTreatmentInfo(study),
          summary: study.briefSummary?.substring(0, 400),
        };
      }

      case 'get_available_cancer_types':
        return { cancerTypes: await this.scriApi.getCancerTypeList() };

      default:
        throw new Error(`Unknown tool: ${toolName}`);
    }
  }

  async chat(userMessage: string): Promise<string> {
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

    while (response.status === 'completed' && response.output) {
      const calls = response.output.filter(
        (i): i is OpenAI.Responses.ResponseFunctionToolCall => i.type === 'function_call'
      );
      if (calls.length === 0) break;

      const results: OpenAI.Responses.ResponseInputItem[] = [];
      for (const call of calls) {
        console.log(`${colors.dim}  → ${call.name}${colors.reset}`);
        try {
          const result = await this.executeTool(call.name, JSON.parse(call.arguments));
          results.push({ type: 'function_call_output', call_id: call.call_id, output: JSON.stringify(result) });
        } catch (e) {
          results.push({ type: 'function_call_output', call_id: call.call_id, output: JSON.stringify({ error: String(e) }) });
        }
      }

      response = await this.openai.responses.create({
        model: 'gpt-5-mini',
        instructions: getQualitySystemPrompt(this.patientProfile),
        input: results,
        tools: QUALITY_TOOLS,
        previous_response_id: response.id,
      });
      this.previousResponseId = response.id;
    }

    const textOutput = response.output?.find(
      (i): i is OpenAI.Responses.ResponseOutputMessage => i.type === 'message'
    );
    return textOutput?.content
      ?.filter((c): c is OpenAI.Responses.ResponseOutputText => c.type === 'output_text')
      .map(c => c.text)
      .join('\n') || 'Unable to respond.';
  }
}

async function main() {
  const apiKey = fs.readFileSync(path.join(process.cwd(), 'openai.key'), 'utf-8').trim();
  
  // Boston patient
  const profile: PatientProfile = { zipCode: '02101' };
  const agent = new QualityTestAgent(apiKey, profile);

  console.log(`\n${colors.cyan}═══════════════════════════════════════════════════════════════${colors.reset}`);
  console.log(`${colors.bright}Quality Agent Test: Boston Breast Cancer Patient${colors.reset}`);
  console.log(`${colors.cyan}═══════════════════════════════════════════════════════════════${colors.reset}\n`);

  const conversation = [
    "Hi, I was just diagnosed with breast cancer and I'm looking for clinical trial options. I live in Boston (02101).",
    "I appreciate the honesty. Would Maryland be my closest option? And what kind of breast cancer trials do you have?",
    "Can you tell me more about the eligibility for the first trial you mentioned? What would I need to qualify?",
  ];

  for (const message of conversation) {
    console.log(`${colors.green}Patient:${colors.reset} ${message}\n`);
    
    try {
      const response = await agent.chat(message);
      console.log(`${colors.cyan}Navigator:${colors.reset} ${response}\n`);
      console.log(`${colors.yellow}${'─'.repeat(65)}${colors.reset}\n`);
    } catch (error) {
      console.error(`${colors.red}Error: ${error}${colors.reset}\n`);
    }
  }
}

main().catch(console.error);
