#!/usr/bin/env node
/**
 * API Explorer - Inspect SCRI API responses for improvement opportunities
 */

import { SCRIApiClient } from '../services/scri-api';

const colors = {
  reset: '\x1b[0m',
  bright: '\x1b[1m',
  cyan: '\x1b[36m',
  yellow: '\x1b[33m',
  green: '\x1b[32m',
  dim: '\x1b[2m',
};

async function main() {
  const api = new SCRIApiClient();

  console.log(`\n${colors.cyan}═══════════════════════════════════════════════════════════════${colors.reset}`);
  console.log(`${colors.bright}SCRI API Explorer${colors.reset}`);
  console.log(`${colors.cyan}═══════════════════════════════════════════════════════════════${colors.reset}\n`);

  // 1. Get cancer types
  console.log(`${colors.yellow}1. Available Cancer Types:${colors.reset}`);
  const cancerTypes = await api.getCancerTypeList();
  console.log(`   ${cancerTypes.join(', ')}\n`);

  // 2. Search for breast cancer trials
  console.log(`${colors.yellow}2. Sample Breast Cancer Trial (Full API Response):${colors.reset}`);
  const searchResults = await api.searchTrials('Breast', 1);
  console.log(`   Total trials: ${searchResults.totalItemCount}`);
  console.log(`   Page: ${searchResults.currentPage} of ${searchResults.totalPageCount}\n`);

  if (searchResults.searchResultsData.length > 0) {
    const firstTrial = searchResults.searchResultsData[0];
    console.log(`${colors.green}   First trial from search:${colors.reset}`);
    console.log(`   ${JSON.stringify(firstTrial, null, 2).split('\n').map(l => '   ' + l).join('\n')}\n`);

    // 3. Get detailed trial info
    console.log(`${colors.yellow}3. Trial Details (get_trial_details response):${colors.reset}`);
    try {
      const trialDetails = await api.getTrialDetails(firstTrial.studyId.toString());
      console.log(`   ${JSON.stringify(trialDetails, null, 2).split('\n').map(l => '   ' + l).join('\n')}\n`);
      
      // Check for eligibility fields
      console.log(`${colors.yellow}4. Fields in Trial Details:${colors.reset}`);
      const fields = Object.keys(trialDetails);
      console.log(`   ${fields.join(', ')}\n`);
      
      // Check for location details
      if (trialDetails.siteList && trialDetails.siteList.length > 0) {
        console.log(`${colors.yellow}5. Sample Location Details:${colors.reset}`);
        console.log(`   ${JSON.stringify(trialDetails.siteList[0], null, 2).split('\n').map(l => '   ' + l).join('\n')}\n`);
      }

      // Look for eligibility-related fields
      console.log(`${colors.yellow}6. Looking for Eligibility/Criteria Fields:${colors.reset}`);
      const eligibilityFields = fields.filter(f => 
        f.toLowerCase().includes('eligib') || 
        f.toLowerCase().includes('criteria') ||
        f.toLowerCase().includes('inclusion') ||
        f.toLowerCase().includes('exclusion') ||
        f.toLowerCase().includes('age') ||
        f.toLowerCase().includes('gender')
      );
      
      if (eligibilityFields.length > 0) {
        console.log(`   Found fields: ${eligibilityFields.join(', ')}`);
        eligibilityFields.forEach(f => {
          console.log(`   ${f}: ${JSON.stringify((trialDetails as any)[f])}`);
        });
      } else {
        console.log(`   No obvious eligibility fields found in API response`);
      }

    } catch (error) {
      console.log(`   Error getting trial details: ${error}`);
    }
  }

  // 4. List all unique states/locations
  console.log(`\n${colors.yellow}7. Scanning for Unique States in Breast Cancer Trials:${colors.reset}`);
  const allStates = new Set<string>();
  const allTrials = await api.searchAllTrials('Breast');
  allTrials.forEach(trial => {
    trial.siteList?.forEach((site: any) => {
      if (site.state) allStates.add(site.state);
    });
    trial.officeList?.forEach((office: any) => {
      if (office.state) allStates.add(office.state);
    });
  });
  console.log(`   States with trial sites: ${[...allStates].sort().join(', ')}`);
  console.log(`   Total unique states: ${allStates.size}`);
  
  // Check for Massachusetts specifically
  const hasMA = allStates.has('MA') || allStates.has('Massachusetts');
  console.log(`   ${colors.bright}Massachusetts sites: ${hasMA ? 'YES' : 'NO'}${colors.reset}\n`);
}

main().catch(console.error);
