# SCRI Trial Agent - Improvement Plan

## ✅ COMPLETED Improvements

### 1. ✅ Fix Location Awareness  
**Status**: COMPLETE

**What was done**:
- Created `src/services/geo.ts` with Haversine distance calculation
- Added ZIP code to lat/lon lookup table for major cities
- Modified `toTrialSummary()` to calculate actual distances from patient ZIP to trial sites
- Agent now sorts trials by distance and shows only top 5 closest
- Geographic coverage awareness: warns patients when no SCRI sites in their state

**Files changed**:
- `src/services/geo.ts` - NEW: distance calculation, ZIP lookup, coverage checking
- `src/services/scri-api.ts` - Updated `toTrialSummary()` with distance calculation

### 2. ✅ Capture Eligibility Criteria  
**Status**: COMPLETE

**What was done**:
- Created `src/services/clinicaltrials-gov.ts` for ClinicalTrials.gov API v2 integration
- Agent can now fetch detailed eligibility (inclusion/exclusion criteria) for any NCT ID
- Parses eligibility into structured format for clear presentation
- Added `get_trial_eligibility` and `get_trial_treatment_info` tools

**Files changed**:
- `src/services/clinicaltrials-gov.ts` - NEW: ClinicalTrials.gov API integration

### 3. ✅ Geographic Coverage Transparency  
**Status**: COMPLETE

**What was done**:
- Added `check_location_coverage` tool that agent MUST call first
- Documented SCRI's 18-state coverage: AL, CA, CO, DE, FL, IL, MD, MN, MO, NM, OH, OR, PA, TN, TX, VA, WA, WI
- Agent immediately tells patients if no sites in their state
- Suggests nearby alternatives with distances

**Files changed**:
- `src/services/geo.ts` - `getCoverageMessage()` function, `SCRI_COVERAGE_STATES` constant
- `src/services/agent.ts` - Updated system prompt with geographic honesty requirement

### 4. ✅ Quality Over Quantity Approach  
**Status**: COMPLETE

**What was done**:
- Rewrote system prompt to emphasize quality conversation
- Agent shows only TOP 5 closest trials instead of dumping all results
- Agent asks clarifying questions about cancer subtype, stage, prior treatments
- Empathetic, patient-centered conversation flow
- Created quality-focused CLI (`npm run cli:quality`)

**Files changed**:
- `src/services/agent.ts` - Complete rewrite of system prompt and tools
- `src/cli/quality-agent.ts` - NEW: quality-focused CLI agent

## Medium Priority (TODO)

### 5. Add Breast Cancer Subtype Filtering
**Problem**: Breast cancer trials are very specific to HER2, ER/PR status, etc.

**Solutions**:
- [ ] Add a conversational flow that asks about tumor characteristics
- [ ] Create subtype-aware search: `search_trials_by_subtype`
- [ ] Map patient answers to trial inclusion criteria

### 6. Smarter NCT Lookup
**Problem**: SCRI API doesn't expose eligibility, so we use ClinicalTrials.gov.

**Solutions**:
- [x] Call ClinicalTrials.gov API directly for NCT lookups ✅
- [ ] Cache study data to reduce API calls
- [ ] Prefetch eligibility for displayed trials

### 7. Conversation State for Patient Profile
**Problem**: Agent asks questions but could remember answers better.

**Solutions**:
- [ ] Build patient profile incrementally during conversation
- [ ] Store and reference: cancer subtype, stage, prior treatments, location, preferences
- [ ] Use profile to filter results automatically

## Lower Priority (TODO)

### 8. Rich Trial Details
- [ ] Add study arms/treatment descriptions
- [ ] Include expected visit frequency  
- [ ] Show study phase explanations (what Phase 1 vs 3 means)

### 9. Contact Integration
- [ ] Format phone numbers as clickable links
- [ ] Add email addresses when available
- [ ] Include trial coordinator names

### 10. Comparison Tool
- [ ] Allow patients to compare 2-3 trials side by side
- [ ] Highlight key differences (phase, location, treatment)

## Technical Debt

### 11. Dedup Agent Code
- [ ] CLI and browser extension have duplicated agent logic
- [ ] Extract shared `TrialAgentCore` class that both can use
- [ ] Move tool definitions to shared module

### 12. Better Error Handling
- [ ] Handle API timeouts gracefully
- [ ] Provide helpful messages when SCRI API is down
- [ ] Cache cancer type list to reduce API calls

### 13. Add Observability
- [ ] Log tool calls and responses
- [ ] Track conversation metrics
- [ ] Measure API latency

---

## Test Results Summary

**Boston Breast Cancer Patient Test**:
- ✅ Agent immediately warns: "SCRI doesn't have trial sites in Massachusetts"
- ✅ Shows nearest alternatives with real distances (PA ~250mi, DE ~303mi, VA ~468mi)
- ✅ Presents only top 5 most relevant trials sorted by distance
- ✅ Fetches real eligibility from ClinicalTrials.gov when asked
- ✅ Empathetic, conversational tone throughout

**Run test yourself**:
```bash
npm run cli:quality     # Interactive quality agent
npx tsx src/cli/test-quality.ts  # Automated test conversation
```
