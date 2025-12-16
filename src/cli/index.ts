#!/usr/bin/env node
/**
 * CLI version of the SCRI Trial Agent
 * Run with: npm run cli
 */

import * as readline from 'readline';
import * as fs from 'fs';
import * as path from 'path';
import OpenAI from 'openai';
import { SCRIApiClient } from '../services/scri-api';
import type { PatientProfile, TrialSummary } from '../types';

// ANSI color codes for terminal output
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
 * Tool definitions for the clinical trial agent
 * Same as in agent.ts but defined here to avoid browser-specific imports
 */
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

/**
 * CLI version of the Trial Agent
 */
class CLITrialAgent {
  private openai: OpenAI;
  private scriApi: SCRIApiClient;
  private patientProfile?: PatientProfile;
  private previousResponseId?: string;

  constructor(apiKey: string, patientProfile?: PatientProfile) {
    this.openai = new OpenAI({ apiKey });
    this.scriApi = new SCRIApiClient();
    this.patientProfile = patientProfile;
  }

  setPatientProfile(profile: PatientProfile): void {
    this.patientProfile = profile;
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

  async executeTool(
    toolName: string,
    args: Record<string, unknown>
  ): Promise<unknown> {
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

  async chat(userMessage: string): Promise<{
    text: string;
    trials?: TrialSummary[];
  }> {
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

      if (functionCalls.length === 0) {
        break;
      }

      const toolResults: OpenAI.Responses.ResponseInputItem[] = [];
      
      for (const call of functionCalls) {
        try {
          console.log(`${colors.dim}  → Calling ${call.name}...${colors.reset}`);
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

  resetConversation(): void {
    this.previousResponseId = undefined;
  }
}

/**
 * Load API key from file
 */
function loadApiKey(): string {
  const keyPath = path.join(process.cwd(), 'openai.key');
  
  if (!fs.existsSync(keyPath)) {
    console.error(`${colors.red}Error: openai.key file not found.${colors.reset}`);
    console.error(`Please create an openai.key file with your API key.`);
    process.exit(1);
  }
  
  return fs.readFileSync(keyPath, 'utf-8').trim();
}

/**
 * Print welcome message
 */
function printWelcome(): void {
  console.log(`
${colors.cyan}╔══════════════════════════════════════════════════════════════╗
║                                                                ║
║   ${colors.bright}SCRI Clinical Trial Agent${colors.reset}${colors.cyan}                                 ║
║   Sarah Cannon Research Institute                              ║
║                                                                ║
╚══════════════════════════════════════════════════════════════╝${colors.reset}

${colors.dim}Type your questions about clinical trials. Commands:${colors.reset}
  ${colors.yellow}/reset${colors.reset}    - Start a new conversation
  ${colors.yellow}/profile${colors.reset}  - Set patient profile
  ${colors.yellow}/help${colors.reset}     - Show this help
  ${colors.yellow}/quit${colors.reset}     - Exit

${colors.green}Examples:${colors.reset}
  "What breast cancer trials are available?"
  "Tell me about trial BRE 451"
  "What cancer types can I search for?"
`);
}

/**
 * Main CLI loop
 */
async function main(): Promise<void> {
  const apiKey = loadApiKey();
  const agent = new CLITrialAgent(apiKey);
  
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
          console.log(`\n${colors.cyan}Goodbye!${colors.reset}\n`);
          rl.close();
          process.exit(0);
        }
        
        if (cmd === '/reset' || cmd === '/clear') {
          agent.resetConversation();
          console.log(`${colors.yellow}Conversation reset.${colors.reset}\n`);
          prompt();
          return;
        }
        
        if (cmd === '/help' || cmd === '/?') {
          printWelcome();
          prompt();
          return;
        }
        
        if (cmd.startsWith('/profile')) {
          console.log(`${colors.yellow}Profile setting not implemented in CLI yet.${colors.reset}\n`);
          prompt();
          return;
        }
        
        console.log(`${colors.red}Unknown command: ${cmd}${colors.reset}\n`);
        prompt();
        return;
      }

      // Process message
      try {
        console.log(`${colors.dim}Thinking...${colors.reset}`);
        const response = await agent.chat(trimmed);
        console.log(`\n${colors.cyan}Agent:${colors.reset} ${response.text}\n`);
      } catch (error) {
        console.error(`\n${colors.red}Error: ${error}${colors.reset}\n`);
      }

      prompt();
    });
  };

  prompt();
}

// Run the CLI
main().catch(console.error);
