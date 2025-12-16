/**
 * ClinicalTrials.gov API integration
 * Used to fetch eligibility criteria and detailed study information
 * Also provides search as a backstop when SCRI doesn't have trials
 */

export interface CTGovStudy {
  nctId: string;
  briefTitle: string;
  officialTitle?: string;
  briefSummary?: string;
  detailedDescription?: string;
  eligibilityCriteria?: string;
  eligibility?: {
    minimumAge?: string;
    maximumAge?: string;
    sex?: string;
    healthyVolunteers?: string;
    criteria?: string;
  };
  phase?: string;
  studyType?: string;
  conditions?: string[];
  interventions?: Array<{
    type: string;
    name: string;
    description?: string;
  }>;
  primaryOutcomes?: Array<{
    measure: string;
    description?: string;
    timeFrame?: string;
  }>;
  contacts?: Array<{
    name?: string;
    phone?: string;
    email?: string;
  }>;
  locations?: Array<{
    facility: string;
    city: string;
    state: string;
    country: string;
    distance?: number;
  }>;
}

export interface CTGovSearchResult {
  nctId: string;
  briefTitle: string;
  phase?: string;
  status: string;
  conditions: string[];
  interventions: string[];
  locations: Array<{
    facility: string;
    city: string;
    state: string;
    country: string;
  }>;
}

/**
 * Search ClinicalTrials.gov for trials (backstop when SCRI has no coverage)
 * @param condition - Cancer type or condition to search for
 * @param location - City, state, or ZIP code for location filtering
 * @param distance - Miles from location (default 100)
 * @param maxResults - Maximum results to return (default 10)
 */
export async function searchCTGov(
  condition: string,
  location?: string,
  distance: number = 100,
  maxResults: number = 10
): Promise<CTGovSearchResult[]> {
  try {
    // Build query parameters
    const params = new URLSearchParams({
      'query.cond': condition,
      'filter.overallStatus': 'RECRUITING',
      'pageSize': String(Math.min(maxResults, 20)),
      'sort': 'LastUpdatePostDate:desc',
    });

    // Add location filter only if location is provided and non-empty
    // CT.gov expects format like "distance(37.7749,-122.4194,100mi)" or "distance(San Francisco,100mi)"
    const trimmedLocation = location?.trim();
    if (trimmedLocation && trimmedLocation.length > 0) {
      params.set('filter.geo', `distance(${trimmedLocation},${distance}mi)`);
    }

    const url = `https://clinicaltrials.gov/api/v2/studies?${params.toString()}`;
    console.log(`[CTGov] Searching: ${url}`);
    
    const response = await fetch(url, {
      headers: {
        'Accept': 'application/json',
      },
    });

    if (!response.ok) {
      // If geo filter failed, retry without it
      if (response.status === 400 && trimmedLocation) {
        console.warn(`[CTGov] Geo filter failed, retrying without location filter`);
        return searchCTGov(condition, undefined, distance, maxResults);
      }
      console.error(`ClinicalTrials.gov search error: ${response.status}`);
      return [];
    }

    const data = await response.json();
    const studies = data.studies || [];

    return studies.map((study: any): CTGovSearchResult => {
      const protocol = study.protocolSection || {};
      const identification = protocol.identificationModule || {};
      const design = protocol.designModule || {};
      const status = protocol.statusModule || {};
      const conditions = protocol.conditionsModule || {};
      const interventions = protocol.armsInterventionsModule || {};
      const locations = protocol.contactsLocationsModule || {};

      return {
        nctId: identification.nctId || '',
        briefTitle: identification.briefTitle || '',
        phase: design.phases?.join(', '),
        status: status.overallStatus || 'Unknown',
        conditions: conditions.conditions || [],
        interventions: (interventions.interventions || []).map((i: any) => i.name),
        locations: (locations.locations || []).slice(0, 3).map((loc: any) => ({
          facility: loc.facility || '',
          city: loc.city || '',
          state: loc.state || '',
          country: loc.country || '',
        })),
      };
    });
  } catch (error) {
    console.error('Error searching ClinicalTrials.gov:', error);
    return [];
  }
}

/**
 * Fetch study details from ClinicalTrials.gov API
 */
export async function fetchCTGovStudy(nctId: string): Promise<CTGovStudy | null> {
  try {
    // Clean NCT ID
    const cleanNctId = nctId.toUpperCase().trim();
    if (!cleanNctId.startsWith('NCT')) {
      return null;
    }

    const url = `https://clinicaltrials.gov/api/v2/studies/${cleanNctId}`;
    
    const response = await fetch(url, {
      headers: {
        'Accept': 'application/json',
      },
    });

    if (!response.ok) {
      console.error(`ClinicalTrials.gov API error: ${response.status}`);
      return null;
    }

    const data = await response.json();
    
    // Parse the response into our format
    const study = data.protocolSection;
    if (!study) return null;

    const identification = study.identificationModule || {};
    const description = study.descriptionModule || {};
    const eligibility = study.eligibilityModule || {};
    const design = study.designModule || {};
    const conditions = study.conditionsModule || {};
    const interventions = study.armsInterventionsModule || {};
    const outcomes = study.outcomesModule || {};
    const contacts = study.contactsLocationsModule || {};

    return {
      nctId: identification.nctId || cleanNctId,
      briefTitle: identification.briefTitle || '',
      officialTitle: identification.officialTitle,
      briefSummary: description.briefSummary,
      detailedDescription: description.detailedDescription,
      eligibilityCriteria: eligibility.eligibilityCriteria,
      eligibility: {
        minimumAge: eligibility.minimumAge,
        maximumAge: eligibility.maximumAge,
        sex: eligibility.sex,
        healthyVolunteers: eligibility.healthyVolunteers,
        criteria: eligibility.eligibilityCriteria,
      },
      phase: design.phases?.join(', '),
      studyType: design.studyType,
      conditions: conditions.conditions,
      interventions: interventions.interventions?.map((i: any) => ({
        type: i.type,
        name: i.name,
        description: i.description,
      })),
      primaryOutcomes: outcomes.primaryOutcomes?.map((o: any) => ({
        measure: o.measure,
        description: o.description,
        timeFrame: o.timeFrame,
      })),
      contacts: contacts.centralContacts?.map((c: any) => ({
        name: c.name,
        phone: c.phone,
        email: c.email,
      })),
    };
  } catch (error) {
    console.error('Error fetching from ClinicalTrials.gov:', error);
    return null;
  }
}

/**
 * Parse eligibility criteria into structured format
 */
export function parseEligibilityCriteria(criteria: string): {
  inclusion: string[];
  exclusion: string[];
} {
  const result = {
    inclusion: [] as string[],
    exclusion: [] as string[],
  };

  if (!criteria) return result;

  // Split into inclusion and exclusion sections
  const lowerCriteria = criteria.toLowerCase();
  const inclusionIndex = lowerCriteria.indexOf('inclusion criteria');
  const exclusionIndex = lowerCriteria.indexOf('exclusion criteria');

  let inclusionText = '';
  let exclusionText = '';

  if (inclusionIndex !== -1 && exclusionIndex !== -1) {
    if (inclusionIndex < exclusionIndex) {
      inclusionText = criteria.substring(inclusionIndex, exclusionIndex);
      exclusionText = criteria.substring(exclusionIndex);
    } else {
      exclusionText = criteria.substring(exclusionIndex, inclusionIndex);
      inclusionText = criteria.substring(inclusionIndex);
    }
  } else if (inclusionIndex !== -1) {
    inclusionText = criteria.substring(inclusionIndex);
  } else if (exclusionIndex !== -1) {
    exclusionText = criteria.substring(exclusionIndex);
  } else {
    // No clear sections, treat all as inclusion
    inclusionText = criteria;
  }

  // Parse bullet points
  const parseBullets = (text: string): string[] => {
    return text
      .split(/[\n\r]+/)
      .map(line => line.trim())
      .filter(line => line.length > 0)
      .filter(line => !line.toLowerCase().includes('criteria:'))
      .filter(line => !line.toLowerCase().match(/^(inclusion|exclusion)/))
      .map(line => line.replace(/^[-*•]\s*/, '').trim())
      .filter(line => line.length > 10); // Filter out very short fragments
  };

  result.inclusion = parseBullets(inclusionText);
  result.exclusion = parseBullets(exclusionText);

  return result;
}

/**
 * Format eligibility criteria for display
 */
export function formatEligibilityForDisplay(study: CTGovStudy): string {
  const parts: string[] = [];

  if (study.eligibility) {
    const elig = study.eligibility;
    
    if (elig.minimumAge || elig.maximumAge) {
      const ageRange = [];
      if (elig.minimumAge && elig.minimumAge !== 'N/A') {
        ageRange.push(`${elig.minimumAge} or older`);
      }
      if (elig.maximumAge && elig.maximumAge !== 'N/A') {
        ageRange.push(`up to ${elig.maximumAge}`);
      }
      if (ageRange.length > 0) {
        parts.push(`**Age:** ${ageRange.join(', ')}`);
      }
    }

    if (elig.sex && elig.sex !== 'All') {
      parts.push(`**Sex:** ${elig.sex}`);
    }
  }

  if (study.eligibilityCriteria) {
    const parsed = parseEligibilityCriteria(study.eligibilityCriteria);
    
    if (parsed.inclusion.length > 0) {
      parts.push('\n**Key Inclusion Criteria:**');
      parsed.inclusion.slice(0, 5).forEach((criterion, i) => {
        parts.push(`${i + 1}. ${criterion}`);
      });
      if (parsed.inclusion.length > 5) {
        parts.push(`   _(and ${parsed.inclusion.length - 5} more)_`);
      }
    }

    if (parsed.exclusion.length > 0) {
      parts.push('\n**Key Exclusion Criteria:**');
      parsed.exclusion.slice(0, 3).forEach((criterion, i) => {
        parts.push(`${i + 1}. ${criterion}`);
      });
      if (parsed.exclusion.length > 3) {
        parts.push(`   _(and ${parsed.exclusion.length - 3} more)_`);
      }
    }
  }

  if (parts.length === 0) {
    return 'Eligibility criteria not available. Please contact the trial site for details.';
  }

  return parts.join('\n');
}

/**
 * Format intervention/treatment info for display
 */
export function formatTreatmentInfo(study: CTGovStudy): string {
  if (!study.interventions || study.interventions.length === 0) {
    return 'Treatment information not available.';
  }

  const parts: string[] = ['**Study Treatments:**'];
  
  study.interventions.forEach((intervention, i) => {
    let line = `${i + 1}. **${intervention.name}** (${intervention.type})`;
    if (intervention.description) {
      line += `: ${intervention.description.substring(0, 200)}${intervention.description.length > 200 ? '...' : ''}`;
    }
    parts.push(line);
  });

  return parts.join('\n');
}
