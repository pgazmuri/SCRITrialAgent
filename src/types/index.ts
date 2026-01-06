/**
 * Patient profile for personalized trial matching
 */
export interface PatientProfile {
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
  performanceStatus?: string; // ECOG scale (0-5)
  comorbidities?: string[];

  // Preferences
  preferredLocations?: string[];
  trialPhasePreferences?: ('Phase 1' | 'Phase 2' | 'Phase 3' | 'Phase 4')[];
}

/**
 * SCRI API Response wrapper
 */
export interface SCRIResponse<T> {
  data: T;
  message: string;
  success: boolean;
  exceptionDetail: string;
}

/**
 * SCRI Filter item (cancer type)
 */
export interface SCRIFilterItem {
  filterItemId: number;
  filterItemText: string;
  filterItemTextDescription: string;
  isEnabled: boolean;
  sortOrder: number;
}

/**
 * SCRI Filter response
 */
export interface SCRIFilterData {
  filterHeading: string;
  filterId: number;
  filterColumnName: string;
  searchFilterType: number;
  isEnabled: boolean;
  filterItemList: SCRIFilterItem[];
  sortOrder: number;
}

/**
 * SCRI Site (research location)
 */
export interface SCRISite {
  siteId: string;
  siteName1: string;
  siteName2: string;
  displayName: string;
  phoneNumber1: string;
  phoneNumber2: string;
  faxNumber: string;
  address1: string;
  address2: string;
  city: string;
  state: string;
  zipCode: string;
  country: string;
  latitude: string;
  longitude: string;
  distanceFromTargetZipCode: number;
}

/**
 * SCRI Office (specific location within a site)
 */
export interface SCRIOffice extends SCRISite {
  officeId: string;
  officeName: string;
  rfSiteId: string;
  rfSiteName: string;
  engSiteId: string;
  engSiteName: string;
}

/**
 * Generic location type for the API
 */
export type SCRILocation = SCRISite | SCRIOffice;

/**
 * SCRI Clinical Trial
 */
export interface SCRITrial {
  searchScore: number | null;
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
  searchCancerType: string[];
  ncT_Conditions: string[];
  ncT_Keywords: string[];
}

/**
 * SCRI Search results
 */
export interface SCRISearchData {
  currentPage: number;
  itemsPerPage: number;
  totalItemCount: number;
  totalPageCount: number;
  searchResultsData: SCRITrial[];
}

/**
 * Location summary for display
 */
export interface LocationSummary {
  name: string;
  city: string;
  state: string;
  distance?: number;
  phone?: string;
}

/**
 * Simplified trial representation for the agent
 */
export interface TrialSummary {
  id: string;
  name: string;
  title: string;
  nctId: string;
  phases: string[];
  cancerTypes: string[];
  locationCount: number;
  closestLocation?: LocationSummary;
  allLocations?: LocationSummary[];
  scriUrl: string; // Link to SCRI trial detail page
  ctGovUrl: string; // Link to ClinicalTrials.gov
}

/**
 * Slim trial summary for search results (reduced fields for efficiency)
 * Agent can call get_study_details for full info on specific trials
 */
export interface TrialSearchResult {
  id: string;
  name: string; // e.g., "BRE-430"
  title: string; // Protocol title
  nctId: string;
  phases: string[];
  closestCity?: string;
  closestState?: string;
  distance?: number; // miles from user ZIP
  scriUrl: string;
}

/**
 * Eligibility status for a trial in the user's list
 */
export type EligibilityStatus = 
  | 'unknown'        // Haven't checked yet or no NCT ID
  | 'likely_eligible'    // Patient appears to meet criteria
  | 'likely_ineligible'  // Patient appears to NOT meet criteria
  | 'needs_review';      // Some criteria unclear, needs physician review

/**
 * A trial in the user's consideration list ("shopping cart")
 */
export interface TrialListItem {
  trial: TrialSearchResult | TrialSummary;
  addedAt: Date;
  status: EligibilityStatus;
  statusReason?: string;  // AI explanation of eligibility assessment
  eligibilityCriteria?: string; // Raw eligibility text from CT.gov
  userNotes?: string;     // User's own notes
  starred?: boolean;      // User-favorited
}

/**
 * Result of an eligibility check
 */
export interface EligibilityCheckResult {
  trialId: string;
  status: EligibilityStatus;
  reason: string;
  matchingCriteria?: string[];    // Criteria patient meets
  concerningCriteria?: string[];  // Criteria that may disqualify
}

/**
 * Matching request submission
 */
export interface MatchingRequest {
  trials: TrialListItem[];
  patientProfile: PatientProfile;
  submittedAt: Date;
  contactPreference?: 'phone' | 'email';
  additionalNotes?: string;
}

/**
 * Chat message
 */
export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  timestamp: Date;
  trials?: TrialSummary[];
  isLoading?: boolean;
}

/**
 * Extension message types for cross-component communication
 */
export type ExtensionMessage =
  | { type: 'CHAT'; payload: { message: string; currentTrialList?: { id: string; name: string; title: string; nctId?: string; status: string; statusReason?: string }[] } }
  | { type: 'CHAT_MESSAGE'; payload: { text: string } }
  | { type: 'SEARCH_TRIALS'; payload: { cancerType: string; zipCode?: string; page?: number } }
  | { type: 'GET_TRIAL'; payload: { trialId: string } }
  | { type: 'GET_FILTERS'; payload: Record<string, never> }
  | { type: 'UPDATE_PROFILE'; payload: PatientProfile }
  | { type: 'GET_PROFILE'; payload: Record<string, never> }
  | { type: 'SET_API_KEY'; payload: { key: string } }
  | { type: 'GET_API_KEY'; payload: Record<string, never> }
  | { type: 'RESET_CONVERSATION'; payload?: Record<string, never> }
  | { type: 'AGENT_RESPONSE'; payload: { text: string; trials?: TrialSummary[] } }
  | { type: 'ERROR'; payload: { message: string; code?: string } }
  // Trial list management
  | { type: 'ADD_TO_TRIAL_LIST'; payload: { trial: TrialSearchResult | TrialSummary } }
  | { type: 'REMOVE_FROM_TRIAL_LIST'; payload: { trialId: string } }
  | { type: 'UPDATE_TRIAL_STATUS'; payload: { trialId: string; status: EligibilityStatus; reason?: string } }
  | { type: 'CHECK_ELIGIBILITY'; payload: { trialId: string; nctId?: string } }
  | { type: 'SUBMIT_MATCHING_REQUEST'; payload: { trialIds: string[]; notes?: string } }
  | { type: 'GET_TRIAL_LIST'; payload?: Record<string, never> }
  | { type: 'CLEAR_TRIAL_LIST'; payload?: Record<string, never> };

/**
 * Storage keys for chrome.storage.local
 */
export const STORAGE_KEYS = {
  API_KEY: 'openai_api_key',
  PATIENT_PROFILE: 'patient_profile',
  CHAT_HISTORY: 'chat_history',
  SETTINGS: 'settings',
} as const;

/**
 * OpenAI tool definitions for the agent
 */
export interface AgentTool {
  type: 'function';
  function: {
    name: string;
    description: string;
    parameters: {
      type: 'object';
      properties: Record<string, {
        type: string;
        description: string;
        enum?: string[];
      }>;
      required?: string[];
    };
  };
}
