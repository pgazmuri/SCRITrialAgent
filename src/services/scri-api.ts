import type {
  SCRIResponse,
  SCRIFilterData,
  SCRIFilterItem,
  SCRISearchData,
  SCRITrial,
  TrialSummary,
  SCRILocation,
} from '@/types';
import { calculateDistance, getZipCoordinates } from './geo';

const BASE_URL = 'https://trials.scri.com/api/v1';

/**
 * Client for interacting with the SCRI Clinical Trials API
 * 
 * Note: This client is designed to be used from:
 * 1. Content scripts (same-origin, no CORS issues)
 * 2. Background service worker (has host_permissions)
 */
export class SCRIApiClient {
  private baseUrl: string;

  constructor(baseUrl: string = BASE_URL) {
    this.baseUrl = baseUrl;
  }

  /**
   * Make a GET request to the SCRI API
   */
  private async get<T>(endpoint: string): Promise<T> {
    const response = await fetch(`${this.baseUrl}${endpoint}`, {
      method: 'GET',
      headers: {
        'Accept': 'application/json',
      },
    });

    if (!response.ok) {
      throw new Error(`API error: ${response.status}`);
    }

    const json = await response.json() as SCRIResponse<T>;

    if (!json.success) {
      throw new Error(`API error: ${json.message || json.exceptionDetail}`);
    }

    return json.data;
  }

  /**
   * Get available cancer type filters
   */
  async getFilters(): Promise<SCRIFilterItem[]> {
    const data = await this.get<SCRIFilterData>('/uifilters/default');
    return data.filterItemList;
  }

  /**
   * Get list of enabled cancer types as simple strings
   */
  async getCancerTypeList(): Promise<string[]> {
    const filters = await this.getFilters();
    return filters
      .filter((f) => f.isEnabled)
      .sort((a, b) => a.sortOrder - b.sortOrder)
      .map((f) => f.filterItemText);
  }

  /**
   * Search for clinical trials by cancer type
   * 
   * @param cancerType - Cancer type to search for (e.g., "Breast", "Lung")
   * @param page - Page number (1-indexed)
   * @returns Search results with pagination info
   */
  async searchTrials(cancerType: string, page: number = 1): Promise<SCRISearchData> {
    const encodedType = encodeURIComponent(cancerType);
    return this.get<SCRISearchData>(`/trials/search/1/${encodedType}/${page}`);
  }

  /**
   * Get detailed information about a specific trial
   * 
   * @param studyId - The study ID or GUID
   */
  async getTrialDetails(studyId: string): Promise<SCRITrial> {
    return this.get<SCRITrial>(`/trials/${studyId}`);
  }

  /**
   * Search for all trials of a cancer type (handling pagination)
   */
  async searchAllTrials(cancerType: string): Promise<SCRITrial[]> {
    const firstPage = await this.searchTrials(cancerType, 1);
    const allTrials = [...firstPage.searchResultsData];

    // Fetch remaining pages if needed
    for (let page = 2; page <= firstPage.totalPageCount; page++) {
      const nextPage = await this.searchTrials(cancerType, page);
      allTrials.push(...nextPage.searchResultsData);
    }

    return allTrials;
  }

  /**
   * Convert an SCRITrial to a simpler TrialSummary for the agent
   * Calculates actual distances if user ZIP code is provided
   */
  static toTrialSummary(trial: SCRITrial, userZipCode?: string): TrialSummary {
    const locations = trial.officeList.length > 0 ? trial.officeList : trial.siteList;
    
    // Calculate distances for all locations if we have user coordinates
    let userCoords: { lat: number; lon: number } | null = null;
    if (userZipCode) {
      userCoords = getZipCoordinates(userZipCode);
    }

    // Build location list with distances
    const locationsWithDistance = locations.map((loc: SCRILocation) => {
      let distance: number | undefined;
      
      if (userCoords && loc.latitude && loc.longitude) {
        const locLat = parseFloat(String(loc.latitude));
        const locLon = parseFloat(String(loc.longitude));
        if (!isNaN(locLat) && !isNaN(locLon)) {
          distance = calculateDistance(userCoords.lat, userCoords.lon, locLat, locLon);
        }
      }
      
      return {
        name: loc.displayName || loc.siteName1,
        city: (loc.city || '').trim(),
        state: loc.state,
        phone: loc.phoneNumber1 || undefined,
        distance,
      };
    });

    // Sort by distance and find closest
    const sortedLocations = locationsWithDistance
      .filter(l => l.distance !== undefined)
      .sort((a, b) => (a.distance || Infinity) - (b.distance || Infinity));

    const closestLocation = sortedLocations.length > 0 
      ? sortedLocations[0] 
      : locationsWithDistance[0];

    return {
      id: trial.studyId,
      name: trial.studyName,
      title: trial.protocolTitle,
      nctId: trial.nct,
      phases: trial.phaseNames,
      cancerTypes: trial.programTypeNames,
      locationCount: locations.length,
      closestLocation,
      // Include all locations sorted by distance for filtering
      allLocations: sortedLocations.length > 0 ? sortedLocations : locationsWithDistance,
      scriUrl: `https://trials.scri.com/trial/${trial.studyId}`,
      ctGovUrl: trial.nct ? `https://clinicaltrials.gov/study/${trial.nct}` : '',
    };
  }
}

// Export singleton instance for convenience
export const scriApi = new SCRIApiClient();
