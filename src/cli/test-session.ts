#!/usr/bin/env node
/**
 * Test session - simulates a breast cancer patient from Boston
 */

import * as fs from 'fs';
import * as path from 'path';
import OpenAI from 'openai';
import { SCRIApiClient } from '../services/scri-api';
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

const AGENT_TOOLS: OpenAI.Responses.Tool[] = [
  {
    type: 'function',
    name: 'search_trials',
    description:
      'Search for clinical trials by cancer type and optionally by location. Returns a list of matching trials.',
    parameters: {
      type: 'object',
      properties: {
        cancerType: {
          type: 'string',
          description:
            "The type of cancer to search for. Examples: 'Breast', 'Lung', 'Lymphoma', 'Multiple Myeloma'",
        },
        zipCode: {
          type: 'string',
          description:
            "Optional: Patient's ZIP code for location-based filtering and distance calculations",
        },
        page: {
          type: 'string',
          description: 'Optional: Page number for paginated results (default: 1)',
        },
      },
      required: ['cancerType'],
    },
  },
  {
    type: 'function',
    name: 'get_trial_details',
    description:
      'Get detailed information about a specific clinical trial including all locations, contact information, and eligibility details.',
    parameters: {
      type: 'object',
      properties: {
        trialId: {
          type: 'string',
          description:
            'The study ID of the trial (e.g., "24226" or a GUID like "3074E307-113A-432B-9A16-C1076967005E")',
        },
      },
      required: ['trialId'],
    },
  },
  {
    type: 'function',
    name: 'get_available_cancer_types',
    description:
      'Get the list of all available cancer types that can be used for trial searches. Call this when you need to know what cancer types are available.',
    parameters: {
      type: 'object',
      properties: {},
    },
  },
  {
    type: 'function',
    name: 'lookup_nct_trial',
    description:
      'Look up a trial by its NCT identifier from ClinicalTrials.gov',
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
];

class TestAgent {
  private openai: OpenAI;
  private scriApi: SCRIApiClient;
  private patientProfile?: PatientProfile;
  private previousResponseId?: string;

  constructor(apiKey: string, patientProfile?: PatientProfile) {
    this.openai = new OpenAI({ apiKey });
    this.scriApi = new SCRIApiClient();
    this.patientProfile = patientProfile;
  }

  getSystemPrompt(): string {
    let prompt = `You are a helpful clinical trial assistant for the Sarah Cannon Research Institute (SCRI). 
Your role is to help patients and caregivers find relevant clinical trials based on their cancer type, location, and other factors.

Key Guidelines:
1. Be empathetic and supportive - patients may be going through difficult times
2. Use clear, non-technical language when possible
3. Always encourage patients to discuss trial options with their healthcare provider
4. Never provide medical advice or make treatment recommendations
5. Focus on providing accurate information about available trials

When presenting trial results:
- Highlight the trial name (e.g., "BRE 451") and NCT number
- Mention the trial phase if available
- Note the number of locations and closest location if known
- Provide a brief description of what the trial is studying

Available tools:
- search_trials: Search for trials by cancer type
- get_trial_details: Get detailed info about a specific trial
- get_available_cancer_types: List searchable cancer types
- lookup_nct_trial: Look up a trial by NCT number

IMPORTANT: When searching for trials, always use the exact cancer type names from get_available_cancer_types.`;

    if (this.patientProfile) {
      prompt += `\n\nPatient Profile:`;
      if (this.patientProfile.cancerType) {
        prompt += `\n- Cancer Type: ${this.patientProfile.cancerType}`;
      }
      if (this.patientProfile.zipCode) {
        prompt += `\n- Location (ZIP): ${this.patientProfile.zipCode}`;
      }
    }

    return prompt;
  }

  async executeTool(toolName: string, args: Record<string, unknown>): Promise<unknown> {
    switch (toolName) {
      case 'search_trials': {
        const cancerType = args.cancerType as string;
        const page = parseInt(args.page as string) || 1;
        const searchData = await this.scriApi.searchTrials(cancerType, page);
        const trials = searchData.searchResultsData.map((t) =>
          SCRIApiClient.toTrialSummary(t, this.patientProfile?.zipCode)
        );
        return {
          totalCount: searchData.totalItemCount,
          currentPage: searchData.currentPage,
          totalPages: searchData.totalPageCount,
          trials,
        };
      }
      case 'get_trial_details': {
        const trialId = args.trialId as string;
        const trial = await this.scriApi.getTrialDetails(trialId);
        return SCRIApiClient.toTrialSummary(trial, this.patientProfile?.zipCode);
      }
      case 'get_available_cancer_types': {
        return this.scriApi.getCancerTypeList();
      }
      case 'lookup_nct_trial': {
        const nctId = args.nctId as string;
        const cancerTypes = await this.scriApi.getCancerTypeList();
        for (const cancerType of cancerTypes) {
          const searchData = await this.scriApi.searchTrials(cancerType, 1);
          const found = searchData.searchResultsData.find(
            (t) => t.nct.toLowerCase() === nctId.toLowerCase()
          );
          if (found) {
            return SCRIApiClient.toTrialSummary(found, this.patientProfile?.zipCode);
          }
        }
        return { error: `No trial found with NCT ID: ${nctId}` };
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
      instructions: this.getSystemPrompt(),
      input,
      tools: AGENT_TOOLS,
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
          console.log(`${colors.dim}  → Calling ${call.name}(${call.arguments})${colors.reset}`);
          const args = JSON.parse(call.arguments);
          const result = await this.executeTool(call.name, args);

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
        instructions: this.getSystemPrompt(),
        input: toolResults,
        tools: AGENT_TOOLS,
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
}

async function main() {
  const apiKey = fs.readFileSync(path.join(process.cwd(), 'openai.key'), 'utf-8').trim();
  
  // Patient profile: Breast cancer patient from Boston
  const profile: PatientProfile = {
    cancerType: 'Breast',
    zipCode: '02101', // Boston ZIP
  };
  
  const agent = new TestAgent(apiKey, profile);

  console.log(`\n${colors.cyan}═══════════════════════════════════════════════════════════════${colors.reset}`);
  console.log(`${colors.bright}Test Session: Breast Cancer Patient from Boston (ZIP: 02101)${colors.reset}`);
  console.log(`${colors.cyan}═══════════════════════════════════════════════════════════════${colors.reset}\n`);

  const questions = [
    "Hi, I was recently diagnosed with breast cancer. What clinical trials are available for me?",
    "Are any of these trials available near Boston?",
    "Can you tell me more about the first trial you mentioned? What would I need to qualify?",
  ];

  for (const question of questions) {
    console.log(`${colors.green}Patient: ${colors.reset}${question}\n`);
    console.log(`${colors.dim}Processing...${colors.reset}`);
    
    try {
      const response = await agent.chat(question);
      console.log(`\n${colors.cyan}Agent: ${colors.reset}${response.text}\n`);
      console.log(`${colors.yellow}─────────────────────────────────────────────────────────────────${colors.reset}\n`);
    } catch (error) {
      console.error(`${colors.red}Error: ${error}${colors.reset}\n`);
    }
  }
}

main().catch(console.error);
