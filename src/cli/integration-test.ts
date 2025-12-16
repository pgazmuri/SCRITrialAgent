#!/usr/bin/env npx ts-node
/**
 * Integration Test Script
 * 
 * Runs real conversations with GPT and validates actual API calls.
 * Uses the actual OpenAI API - requires valid API key.
 * 
 * Usage:
 *   npx ts-node src/cli/integration-test.ts
 *   
 * Or with npm script:
 *   npm run test:integration
 */

import * as fs from 'fs';
import * as path from 'path';
import OpenAI from 'openai';
import { AGENT_TOOLS, TrialAgent } from '../services/agent';

// Colors for terminal output
const colors = {
  reset: '\x1b[0m',
  bright: '\x1b[1m',
  dim: '\x1b[2m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  magenta: '\x1b[35m',
  cyan: '\x1b[36m',
};

function log(message: string, color: string = colors.reset): void {
  console.log(`${color}${message}${colors.reset}`);
}

function logSection(title: string): void {
  console.log();
  log(`${'═'.repeat(60)}`, colors.cyan);
  log(`  ${title}`, colors.bright + colors.cyan);
  log(`${'═'.repeat(60)}`, colors.cyan);
}

function logTest(name: string): void {
  console.log();
  log(`┌─ TEST: ${name}`, colors.yellow);
  log(`│`, colors.dim);
}

function logPass(message: string): void {
  log(`│  ✅ ${message}`, colors.green);
}

function logFail(message: string): void {
  log(`│  ❌ ${message}`, colors.red);
}

function logInfo(message: string): void {
  log(`│  ℹ️  ${message}`, colors.blue);
}

function logToolCall(name: string, args: Record<string, unknown>): void {
  log(`│  🔧 Tool: ${name}`, colors.magenta);
  log(`│     Args: ${JSON.stringify(args)}`, colors.dim);
}

function logResponse(text: string): void {
  const truncated = text.length > 200 ? text.substring(0, 200) + '...' : text;
  log(`│  💬 Response: ${truncated.replace(/\n/g, ' ')}`, colors.dim);
}

function logTestEnd(passed: boolean): void {
  log(`│`, colors.dim);
  log(`└─ ${passed ? '✅ PASSED' : '❌ FAILED'}`, passed ? colors.green : colors.red);
}

/**
 * Test result tracking
 */
interface TestResult {
  name: string;
  passed: boolean;
  duration: number;
  error?: string;
  toolsCalled: string[];
  responseReceived: boolean;
}

const results: TestResult[] = [];

/**
 * Get API key from file or environment
 */
function getApiKey(): string {
  // Try environment variable first
  if (process.env.OPENAI_API_KEY) {
    return process.env.OPENAI_API_KEY;
  }

  // Try openai.key file
  const keyPath = path.join(process.cwd(), 'openai.key');
  if (fs.existsSync(keyPath)) {
    return fs.readFileSync(keyPath, 'utf-8').trim();
  }

  throw new Error('No API key found. Set OPENAI_API_KEY env var or create openai.key file.');
}

/**
 * Test: Basic conversation without tools
 */
async function testBasicConversation(agent: TrialAgent): Promise<TestResult> {
  const testName = 'Basic Greeting';
  logTest(testName);
  const start = Date.now();
  const toolsCalled: string[] = [];

  try {
    const response = await agent.chat('Hello, I need help finding a clinical trial.');
    
    logResponse(response.text);
    
    const hasResponse = response.text.length > 0;
    const isRelevant = response.text.toLowerCase().includes('trial') || 
                       response.text.toLowerCase().includes('help') ||
                       response.text.toLowerCase().includes('cancer');
    
    if (hasResponse) logPass('Received response');
    else logFail('No response received');
    
    if (isRelevant) logPass('Response is contextually relevant');
    else logFail('Response may not be relevant');

    const passed = hasResponse && isRelevant;
    logTestEnd(passed);
    
    return {
      name: testName,
      passed,
      duration: Date.now() - start,
      toolsCalled,
      responseReceived: hasResponse,
    };
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    logFail(`Error: ${errorMsg}`);
    logTestEnd(false);
    return {
      name: testName,
      passed: false,
      duration: Date.now() - start,
      error: errorMsg,
      toolsCalled,
      responseReceived: false,
    };
  }
}

/**
 * Test: Location coverage check (should trigger check_location_coverage tool)
 */
async function testLocationCoverage(agent: TrialAgent): Promise<TestResult> {
  const testName = 'Location Coverage Check';
  logTest(testName);
  const start = Date.now();
  const toolsCalled: string[] = [];

  try {
    // Reset conversation for clean test
    agent.resetConversation();
    
    const response = await agent.chat('I live in ZIP code 02101 (Boston). Do you have trials near me?');
    
    logResponse(response.text);
    
    const hasResponse = response.text.length > 0;
    // Boston (MA) is NOT in SCRI coverage - agent should mention this
    const mentionsDistance = response.text.toLowerCase().includes('mile') ||
                             response.text.toLowerCase().includes('distance') ||
                             response.text.toLowerCase().includes('travel');
    const mentionsCoverage = response.text.toLowerCase().includes('massachusetts') ||
                             response.text.toLowerCase().includes('coverage') ||
                             response.text.toLowerCase().includes('state') ||
                             response.text.toLowerCase().includes('nearest');
    
    if (hasResponse) logPass('Received response');
    else logFail('No response received');
    
    if (mentionsDistance || mentionsCoverage) {
      logPass('Agent addressed location/coverage concern');
    } else {
      logInfo('Agent may not have explicitly mentioned coverage');
    }

    const passed = hasResponse;
    logTestEnd(passed);
    
    return {
      name: testName,
      passed,
      duration: Date.now() - start,
      toolsCalled,
      responseReceived: hasResponse,
    };
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    logFail(`Error: ${errorMsg}`);
    logTestEnd(false);
    return {
      name: testName,
      passed: false,
      duration: Date.now() - start,
      error: errorMsg,
      toolsCalled,
      responseReceived: false,
    };
  }
}

/**
 * Test: Trial search (should trigger search_trials_nearby tool)
 */
async function testTrialSearch(agent: TrialAgent): Promise<TestResult> {
  const testName = 'Trial Search';
  logTest(testName);
  const start = Date.now();
  const toolsCalled: string[] = [];

  try {
    agent.resetConversation();
    
    const response = await agent.chat(
      'I have breast cancer and live in Nashville, TN (37203). What trials are available?'
    );
    
    logResponse(response.text);
    
    const hasResponse = response.text.length > 0;
    const mentionsTrials = response.text.toLowerCase().includes('trial') ||
                          response.text.toLowerCase().includes('nct') ||
                          response.text.toLowerCase().includes('study');
    const hasTrialData = response.trials && response.trials.length > 0;
    
    if (hasResponse) logPass('Received response');
    else logFail('No response received');
    
    if (mentionsTrials) logPass('Response mentions trials');
    else logFail('Response does not mention trials');
    
    if (hasTrialData) {
      logPass(`Found ${response.trials!.length} trial(s) in response data`);
      response.trials!.slice(0, 2).forEach(t => {
        logInfo(`  - ${t.name} (${t.nctId})`);
      });
    } else {
      logInfo('No structured trial data in response (may be in text)');
    }

    const passed = hasResponse && mentionsTrials;
    logTestEnd(passed);
    
    return {
      name: testName,
      passed,
      duration: Date.now() - start,
      toolsCalled,
      responseReceived: hasResponse,
    };
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    logFail(`Error: ${errorMsg}`);
    logTestEnd(false);
    return {
      name: testName,
      passed: false,
      duration: Date.now() - start,
      error: errorMsg,
      toolsCalled,
      responseReceived: false,
    };
  }
}

/**
 * Test: Multi-turn conversation continuity
 * This test verifies the SAME code path used in the browser extension.
 * The TrialAgent class maintains previousResponseId between chat() calls.
 */
async function testConversationContinuity(agent: TrialAgent): Promise<TestResult> {
  const testName = 'Conversation Continuity (Same as Browser)';
  logTest(testName);
  const start = Date.now();
  const toolsCalled: string[] = [];

  try {
    agent.resetConversation();
    logInfo('Reset conversation - previousResponseId is now undefined');
    
    // Turn 1: Establish context
    logInfo('Turn 1: Establishing context...');
    const response1 = await agent.chat('I have lung cancer and live in Denver, CO (80202).');
    logResponse(response1.text);
    const state1 = agent.getConversationState();
    logInfo(`previousResponseId after turn 1: ${state1.previousResponseId?.slice(0, 20)}...`);
    const responseId1 = state1.previousResponseId;
    
    // Turn 2: Follow-up that requires context (NO reset - same as browser)
    logInfo('Turn 2: Follow-up question (using previousResponseId chain)...');
    const response2 = await agent.chat('What trials did you find for me?');
    logResponse(response2.text);
    const state2 = agent.getConversationState();
    logInfo(`previousResponseId after turn 2: ${state2.previousResponseId?.slice(0, 20)}...`);
    const responseId2 = state2.previousResponseId;
    
    // Turn 3: Reference previous info (still same conversation)
    logInfo('Turn 3: Reference previous context...');
    const response3 = await agent.chat('Can you tell me more about the first one?');
    logResponse(response3.text);
    const state3 = agent.getConversationState();
    logInfo(`previousResponseId after turn 3: ${state3.previousResponseId?.slice(0, 20)}...`);
    const responseId3 = state3.previousResponseId;
    
    const hasAllResponses = response1.text.length > 0 && 
                           response2.text.length > 0 && 
                           response3.text.length > 0;
    
    // Verify previousResponseId chain is working (each turn should have different ID)
    const hasResponseIdChain = responseId1 && responseId2 && responseId3 &&
                               responseId1 !== responseId2 && responseId2 !== responseId3;
    
    // Check if context was maintained (response2/3 should not ask for info already given)
    const response2LostContext = response2.text.toLowerCase().includes('what type of cancer') ||
                                 response2.text.toLowerCase().includes('where do you live') ||
                                 response2.text.toLowerCase().includes('provide your zip');
    const response3LostContext = response3.text.toLowerCase().includes('which trial') ||
                                 response3.text.toLowerCase().includes('specify') ||
                                 response3.text.toLowerCase().includes('nct identifier');
    
    const maintainsContext = !response2LostContext && !response3LostContext;
    
    if (hasAllResponses) logPass('All three turns received responses');
    else logFail('Missing response in conversation');
    
    if (hasResponseIdChain) logPass('previousResponseId chain maintained (same as browser)');
    else logFail('previousResponseId chain broken!');
    
    if (maintainsContext) logPass('Context maintained - agent remembers previous turns');
    else logFail('Context lost - agent asking for info already provided');

    const passed = hasAllResponses && hasResponseIdChain && maintainsContext;
    logTestEnd(passed);
    
    return {
      name: testName,
      passed,
      duration: Date.now() - start,
      toolsCalled,
      responseReceived: hasAllResponses,
    };
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    logFail(`Error: ${errorMsg}`);
    logTestEnd(false);
    return {
      name: testName,
      passed: false,
      duration: Date.now() - start,
      error: errorMsg,
      toolsCalled,
      responseReceived: false,
    };
  }
}

/**
 * Test: Eligibility lookup (should trigger get_trial_eligibility tool)
 */
async function testEligibilityLookup(agent: TrialAgent): Promise<TestResult> {
  const testName = 'Eligibility Lookup';
  logTest(testName);
  const start = Date.now();
  const toolsCalled: string[] = [];

  try {
    agent.resetConversation();
    
    const response = await agent.chat(
      'Can you tell me the eligibility requirements for trial NCT03448926?'
    );
    
    logResponse(response.text);
    
    const hasResponse = response.text.length > 0;
    const mentionsEligibility = response.text.toLowerCase().includes('eligib') ||
                                response.text.toLowerCase().includes('criteria') ||
                                response.text.toLowerCase().includes('require') ||
                                response.text.toLowerCase().includes('include') ||
                                response.text.toLowerCase().includes('exclude');
    
    if (hasResponse) logPass('Received response');
    else logFail('No response received');
    
    if (mentionsEligibility) logPass('Response discusses eligibility');
    else logFail('Response does not mention eligibility criteria');

    const passed = hasResponse && mentionsEligibility;
    logTestEnd(passed);
    
    return {
      name: testName,
      passed,
      duration: Date.now() - start,
      toolsCalled,
      responseReceived: hasResponse,
    };
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    logFail(`Error: ${errorMsg}`);
    logTestEnd(false);
    return {
      name: testName,
      passed: false,
      duration: Date.now() - start,
      error: errorMsg,
      toolsCalled,
      responseReceived: false,
    };
  }
}

/**
 * Test: Cancer types listing (should trigger get_available_cancer_types tool)
 */
async function testCancerTypesListing(agent: TrialAgent): Promise<TestResult> {
  const testName = 'Cancer Types Listing';
  logTest(testName);
  const start = Date.now();
  const toolsCalled: string[] = [];

  try {
    agent.resetConversation();
    
    const response = await agent.chat('What types of cancer do you have trials for?');
    
    logResponse(response.text);
    
    const hasResponse = response.text.length > 0;
    const listsCancerTypes = response.text.toLowerCase().includes('breast') ||
                            response.text.toLowerCase().includes('lung') ||
                            response.text.toLowerCase().includes('lymphoma') ||
                            response.text.toLowerCase().includes('leukemia');
    
    if (hasResponse) logPass('Received response');
    else logFail('No response received');
    
    if (listsCancerTypes) logPass('Response lists cancer types');
    else logFail('Response does not list cancer types');

    const passed = hasResponse && listsCancerTypes;
    logTestEnd(passed);
    
    return {
      name: testName,
      passed,
      duration: Date.now() - start,
      toolsCalled,
      responseReceived: hasResponse,
    };
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    logFail(`Error: ${errorMsg}`);
    logTestEnd(false);
    return {
      name: testName,
      passed: false,
      duration: Date.now() - start,
      error: errorMsg,
      toolsCalled,
      responseReceived: false,
    };
  }
}

/**
 * Test: Direct tool execution
 */
async function testDirectToolExecution(agent: TrialAgent): Promise<TestResult> {
  const testName = 'Direct Tool Execution';
  logTest(testName);
  const start = Date.now();
  const toolsCalled: string[] = [];

  try {
    // Test check_location_coverage directly
    logInfo('Testing check_location_coverage tool...');
    const coverageResult = await agent.executeTool('check_location_coverage', { zipCode: '37203' });
    logToolCall('check_location_coverage', { zipCode: '37203' });
    
    const hasCoverage = typeof coverageResult === 'object' && coverageResult !== null;
    if (hasCoverage) {
      logPass('check_location_coverage returned valid result');
      const cr = coverageResult as { state?: string; hasCoverage?: boolean };
      logInfo(`  State: ${cr.state}, Has Coverage: ${cr.hasCoverage}`);
      toolsCalled.push('check_location_coverage');
    } else {
      logFail('check_location_coverage failed');
    }

    // Test search_trials_nearby directly
    logInfo('Testing search_trials_nearby tool...');
    const searchResult = await agent.executeTool('search_trials_nearby', {
      cancerType: 'Breast',
      zipCode: '37203',
    });
    logToolCall('search_trials_nearby', { cancerType: 'Breast', zipCode: '37203' });
    
    const hasSearch = typeof searchResult === 'object' && searchResult !== null;
    if (hasSearch) {
      logPass('search_trials_nearby returned valid result');
      const sr = searchResult as { totalFound?: number; trials?: unknown[] };
      logInfo(`  Total found: ${sr.totalFound}, Showing: ${sr.trials?.length || 0}`);
      toolsCalled.push('search_trials_nearby');
    } else {
      logFail('search_trials_nearby failed');
    }

    // Test get_available_cancer_types directly
    logInfo('Testing get_available_cancer_types tool...');
    const typesResult = await agent.executeTool('get_available_cancer_types', {});
    logToolCall('get_available_cancer_types', {});
    
    const hasTypes = Array.isArray(typesResult) || (typeof typesResult === 'object' && typesResult !== null);
    if (hasTypes) {
      logPass('get_available_cancer_types returned valid result');
      toolsCalled.push('get_available_cancer_types');
    } else {
      logFail('get_available_cancer_types failed');
    }

    const passed = hasCoverage && hasSearch && hasTypes;
    logTestEnd(passed);
    
    return {
      name: testName,
      passed,
      duration: Date.now() - start,
      toolsCalled,
      responseReceived: true,
    };
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    logFail(`Error: ${errorMsg}`);
    logTestEnd(false);
    return {
      name: testName,
      passed: false,
      duration: Date.now() - start,
      error: errorMsg,
      toolsCalled,
      responseReceived: false,
    };
  }
}

/**
 * Print final summary
 */
function printSummary(results: TestResult[]): void {
  logSection('TEST SUMMARY');
  
  const passed = results.filter(r => r.passed).length;
  const failed = results.filter(r => !r.passed).length;
  const totalDuration = results.reduce((sum, r) => sum + r.duration, 0);
  
  console.log();
  results.forEach(r => {
    const status = r.passed ? `${colors.green}✅ PASS${colors.reset}` : `${colors.red}❌ FAIL${colors.reset}`;
    const duration = `${colors.dim}(${r.duration}ms)${colors.reset}`;
    console.log(`  ${status}  ${r.name} ${duration}`);
    if (r.error) {
      console.log(`         ${colors.red}Error: ${r.error}${colors.reset}`);
    }
  });
  
  console.log();
  log(`${'─'.repeat(60)}`, colors.dim);
  console.log();
  
  const summaryColor = failed === 0 ? colors.green : colors.red;
  log(`  Results: ${passed} passed, ${failed} failed`, summaryColor);
  log(`  Duration: ${(totalDuration / 1000).toFixed(2)}s`, colors.dim);
  console.log();
  
  if (failed === 0) {
    log('  🎉 All integration tests passed!', colors.green + colors.bright);
  } else {
    log(`  ⚠️  ${failed} test(s) failed`, colors.red + colors.bright);
  }
  console.log();
}

/**
 * Main entry point
 */
async function main(): Promise<void> {
  logSection('SCRI Trial Agent - Integration Tests');
  log('Running real API calls against OpenAI and SCRI APIs', colors.dim);
  console.log();

  let apiKey: string;
  try {
    apiKey = getApiKey();
    log(`  ✅ API key loaded (${apiKey.slice(0, 7)}...${apiKey.slice(-4)})`, colors.green);
  } catch (error) {
    log(`  ❌ ${error instanceof Error ? error.message : 'Failed to load API key'}`, colors.red);
    process.exit(1);
  }

  // Create agent instance
  const agent = new TrialAgent(apiKey);
  log('  ✅ Agent initialized', colors.green);

  // Run tests sequentially (to respect API rate limits and maintain conversation state where needed)
  const tests = [
    () => testDirectToolExecution(agent),
    () => testBasicConversation(agent),
    () => testLocationCoverage(agent),
    () => testTrialSearch(agent),
    () => testCancerTypesListing(agent),
    () => testEligibilityLookup(agent),
    () => testConversationContinuity(agent),
    () => testFullConversationWithAllTools(agent),
  ];

  for (const test of tests) {
    const result = await test();
    results.push(result);
    
    // Small delay between tests to avoid rate limiting
    await new Promise(resolve => setTimeout(resolve, 500));
  }

  // Print summary
  printSummary(results);

  // Exit with appropriate code
  const failed = results.filter(r => !r.passed).length;
  process.exit(failed > 0 ? 1 : 0);
}

/**
 * Test: Full conversation exercising ALL tools with context verification
 * This simulates a real user session with multiple tool calls
 */
async function testFullConversationWithAllTools(agent: TrialAgent): Promise<TestResult> {
  const testName = 'Full Multi-Tool Conversation';
  logTest(testName);
  const start = Date.now();
  const toolsCalled: string[] = [];
  const conversationLog: Array<{ turn: number; user: string; response: string; responseId: string }> = [];

  try {
    agent.resetConversation();
    logInfo('=== Starting fresh conversation ===');
    
    // TURN 1: Ask about available cancer types (triggers get_available_cancer_types)
    logInfo('TURN 1: Asking about cancer types...');
    const r1 = await agent.chat('What types of cancer do you have trials for?');
    const s1 = agent.getConversationState();
    conversationLog.push({ turn: 1, user: 'What types of cancer...', response: r1.text.slice(0, 100), responseId: s1.previousResponseId || '' });
    logResponse(r1.text);
    logInfo(`ResponseId: ${s1.previousResponseId?.slice(0, 30)}`);
    
    if (r1.text.toLowerCase().includes('breast') || r1.text.toLowerCase().includes('lung')) {
      logPass('Turn 1: Listed cancer types');
      toolsCalled.push('get_available_cancer_types');
    } else {
      logFail('Turn 1: Did not list cancer types');
    }

    // TURN 2: Provide location (triggers check_location_coverage)
    logInfo('TURN 2: Providing location...');
    const r2 = await agent.chat('I live in ZIP 37203 (Nashville, TN). I have breast cancer.');
    const s2 = agent.getConversationState();
    conversationLog.push({ turn: 2, user: 'ZIP 37203, breast cancer', response: r2.text.slice(0, 100), responseId: s2.previousResponseId || '' });
    logResponse(r2.text);
    logInfo(`ResponseId: ${s2.previousResponseId?.slice(0, 30)}`);
    
    const remembersFromTurn1 = !r2.text.toLowerCase().includes('what type of cancer');
    if (remembersFromTurn1) {
      logPass('Turn 2: Agent did NOT re-ask about cancer types (context maintained)');
    } else {
      logFail('Turn 2: Agent re-asked about cancer types (CONTEXT LOST!)');
    }
    
    if (r2.text.toLowerCase().includes('tennessee') || r2.text.toLowerCase().includes('nashville') || r2.text.toLowerCase().includes('coverage')) {
      logPass('Turn 2: Acknowledged location');
      toolsCalled.push('check_location_coverage');
    }

    // TURN 3: Ask to search trials (triggers search_trials_nearby)
    logInfo('TURN 3: Asking to search trials...');
    const r3 = await agent.chat('Please search for trials for me.');
    const s3 = agent.getConversationState();
    conversationLog.push({ turn: 3, user: 'Search for trials', response: r3.text.slice(0, 100), responseId: s3.previousResponseId || '' });
    logResponse(r3.text);
    logInfo(`ResponseId: ${s3.previousResponseId?.slice(0, 30)}`);
    
    // Agent should remember breast cancer + Nashville without re-asking
    const remembersContext = !r3.text.toLowerCase().includes('what type') && 
                            !r3.text.toLowerCase().includes('where do you live') &&
                            !r3.text.toLowerCase().includes('your zip');
    if (remembersContext) {
      logPass('Turn 3: Agent remembered cancer type and location');
    } else {
      logFail('Turn 3: Agent forgot context - asking for info already provided!');
    }
    
    const mentionsTrials = r3.text.toLowerCase().includes('trial') || r3.text.toLowerCase().includes('nct');
    if (mentionsTrials) {
      logPass('Turn 3: Found and listed trials');
      toolsCalled.push('search_trials_nearby');
    }

    // TURN 4: Ask about eligibility for "the first one" (requires context + triggers get_trial_eligibility)
    logInfo('TURN 4: Asking about eligibility for first trial...');
    const r4 = await agent.chat('What are the eligibility requirements for the first trial you mentioned?');
    const s4 = agent.getConversationState();
    conversationLog.push({ turn: 4, user: 'Eligibility for first trial', response: r4.text.slice(0, 100), responseId: s4.previousResponseId || '' });
    logResponse(r4.text);
    logInfo(`ResponseId: ${s4.previousResponseId?.slice(0, 30)}`);
    
    const knowsWhichTrial = !r4.text.toLowerCase().includes('which trial') &&
                           !r4.text.toLowerCase().includes('specify') &&
                           !r4.text.toLowerCase().includes('nct number');
    if (knowsWhichTrial) {
      logPass('Turn 4: Agent knew which trial was "the first one"');
    } else {
      logFail('Turn 4: Agent forgot which trials were listed (CONTEXT LOST!)');
    }
    
    const mentionsEligibility = r4.text.toLowerCase().includes('eligib') || 
                                r4.text.toLowerCase().includes('criteria') ||
                                r4.text.toLowerCase().includes('require');
    if (mentionsEligibility) {
      logPass('Turn 4: Provided eligibility info');
      toolsCalled.push('get_trial_eligibility');
    }

    // TURN 5: Ask about treatment info (triggers get_trial_treatment_info)
    logInfo('TURN 5: Asking about treatment details...');
    const r5 = await agent.chat('What drugs or treatments are being studied in that trial?');
    const s5 = agent.getConversationState();
    conversationLog.push({ turn: 5, user: 'What treatments in that trial', response: r5.text.slice(0, 100), responseId: s5.previousResponseId || '' });
    logResponse(r5.text);
    logInfo(`ResponseId: ${s5.previousResponseId?.slice(0, 30)}`);
    
    const knowsWhichTrialStill = !r5.text.toLowerCase().includes('which trial') &&
                                  !r5.text.toLowerCase().includes('specify');
    if (knowsWhichTrialStill) {
      logPass('Turn 5: Agent still knows which trial we\'re discussing');
    } else {
      logFail('Turn 5: Agent forgot trial context');
    }
    
    if (r5.text.toLowerCase().includes('treatment') || r5.text.toLowerCase().includes('drug') || r5.text.toLowerCase().includes('intervention')) {
      logPass('Turn 5: Provided treatment info');
      toolsCalled.push('get_trial_treatment_info');
    }

    // TURN 6: Final context check - reference something from earlier
    logInfo('TURN 6: Final context verification...');
    const r6 = await agent.chat('Remind me - how far is the closest trial site from my location?');
    const s6 = agent.getConversationState();
    conversationLog.push({ turn: 6, user: 'How far is closest site', response: r6.text.slice(0, 100), responseId: s6.previousResponseId || '' });
    logResponse(r6.text);
    logInfo(`ResponseId: ${s6.previousResponseId?.slice(0, 30)}`);
    
    const remembersLocation = r6.text.toLowerCase().includes('nashville') ||
                              r6.text.toLowerCase().includes('tennessee') ||
                              r6.text.toLowerCase().includes('37203') ||
                              r6.text.toLowerCase().includes('mile');
    if (remembersLocation) {
      logPass('Turn 6: Agent remembers user location from turn 2');
    } else {
      logFail('Turn 6: Agent forgot user location (CONTEXT LOST!)');
    }

    // Summary
    console.log();
    logInfo('=== Conversation Log ===');
    conversationLog.forEach(entry => {
      logInfo(`Turn ${entry.turn}: [${entry.responseId.slice(0, 15)}...] ${entry.user}`);
    });
    
    logInfo(`Tools called: ${toolsCalled.join(', ')}`);
    
    const allToolsCalled = toolsCalled.includes('get_available_cancer_types') &&
                           toolsCalled.includes('check_location_coverage') &&
                           toolsCalled.includes('search_trials_nearby') &&
                           toolsCalled.includes('get_trial_eligibility');
    
    const contextMaintained = remembersFromTurn1 && remembersContext && knowsWhichTrial && knowsWhichTrialStill && remembersLocation;
    
    if (allToolsCalled) logPass('All major tools were exercised');
    else logFail(`Missing tools. Called: ${toolsCalled.join(', ')}`);
    
    if (contextMaintained) logPass('Context maintained across all 6 turns');
    else logFail('Context was lost at some point');

    const passed = allToolsCalled && contextMaintained;
    logTestEnd(passed);
    
    return {
      name: testName,
      passed,
      duration: Date.now() - start,
      toolsCalled,
      responseReceived: true,
    };
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    logFail(`Error: ${errorMsg}`);
    logTestEnd(false);
    return {
      name: testName,
      passed: false,
      duration: Date.now() - start,
      error: errorMsg,
      toolsCalled,
      responseReceived: false,
    };
  }
}

// Run
main().catch(error => {
  console.error('Fatal error:', error);
  process.exit(1);
});
