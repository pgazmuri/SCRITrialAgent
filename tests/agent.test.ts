import { describe, it, expect, vi, beforeEach } from 'vitest';
import { TrialAgent, AGENT_TOOLS } from '@/services/agent';
import type { TrialSummary } from '@/types';

// Mock the geo service
vi.mock('@/services/geo', () => ({
  getCoverageMessage: vi.fn().mockReturnValue('SCRI has trial sites in Tennessee and nearby states.'),
  getZipCoordinates: vi.fn().mockReturnValue({ lat: 36.1627, lon: -86.7816, city: 'Nashville', state: 'TN' }),
  calculateDistance: vi.fn().mockReturnValue(50),
  SCRI_COVERAGE_STATES: ['TN', 'TX', 'FL', 'CA', 'PA'],
}));

// Mock the clinicaltrials-gov service
vi.mock('@/services/clinicaltrials-gov', () => ({
  fetchCTGovStudy: vi.fn().mockResolvedValue({
    protocolSection: {
      identificationModule: { briefTitle: 'Test Study' },
      eligibilityModule: {
        eligibilityCriteria: 'Inclusion:\n- Age 18+\n\nExclusion:\n- None',
        minimumAge: '18 Years',
        sex: 'All',
      },
      armsInterventionsModule: {
        interventions: [{ name: 'Test Drug', type: 'Drug' }],
      },
    },
  }),
  formatEligibilityForDisplay: vi.fn().mockReturnValue({
    minimumAge: '18 Years',
    sex: 'All',
    inclusionCriteria: ['Age 18+'],
    exclusionCriteria: ['None'],
  }),
  formatTreatmentInfo: vi.fn().mockReturnValue({
    interventions: [{ name: 'Test Drug', type: 'Drug' }],
  }),
}));

// Mock the SCRI API client
vi.mock('@/services/scri-api', () => {
  // Helper to create toTrialSummary mock
  const mockToTrialSummary = (trial: any): any => ({
    id: trial.studyId,
    name: trial.studyName,
    title: trial.protocolTitle,
    nctId: trial.nct,
    phases: trial.phaseNames,
    cancerTypes: trial.programTypeNames,
    locationCount: (trial.siteList?.length || 0) + (trial.officeList?.length || 0),
    closestLocation: {
      name: 'Test Location',
      city: 'Nashville',
      state: 'TN',
      distance: 50,
    },
  });

  const MockSCRIApiClient = vi.fn().mockImplementation(() => ({
    getCancerTypeList: vi.fn().mockResolvedValue(['Breast', 'Lung', 'Lymphoma']),
    searchTrials: vi.fn().mockResolvedValue({
      currentPage: 1,
      itemsPerPage: 10,
      totalItemCount: 2,
      totalPageCount: 1,
      searchResultsData: [
        {
          studyId: '12345',
          studyName: 'BRE 001',
          protocolTitle: 'Test Trial',
          nct: 'NCT12345678',
          siteList: [],
          officeList: [],
          programTypeNames: ['Breast Cancer'],
          phaseNames: ['Phase 2'],
        },
      ],
    }),
    getTrialDetails: vi.fn().mockResolvedValue({
      studyId: '12345',
      studyName: 'BRE 001',
      protocolTitle: 'Test Trial',
      nct: 'NCT12345678',
      siteList: [],
      officeList: [],
      programTypeNames: ['Breast Cancer'],
      phaseNames: ['Phase 2'],
    }),
  }));

  MockSCRIApiClient.toTrialSummary = mockToTrialSummary;

  return {
    SCRIApiClient: MockSCRIApiClient,
    scriApi: {
      getCancerTypeList: vi.fn().mockResolvedValue(['Breast', 'Lung', 'Lymphoma']),
      searchTrials: vi.fn(),
      getTrialDetails: vi.fn(),
    },
  };
});

describe('TrialAgent', () => {
  describe('AGENT_TOOLS', () => {
    it('should define search_trials tool with optional zipCode', () => {
      const tool = AGENT_TOOLS.find((t) => t.type === 'function' && t.name === 'search_trials');
      expect(tool).toBeDefined();
      expect(tool?.parameters?.properties).toHaveProperty('cancerType');
      expect(tool?.parameters?.properties).toHaveProperty('zipCode');
      expect(tool?.parameters?.required).toContain('cancerType');
      // zipCode should NOT be required
      expect(tool?.parameters?.required).not.toContain('zipCode');
    });

    it('should define get_study_details tool', () => {
      const tool = AGENT_TOOLS.find((t) => t.type === 'function' && t.name === 'get_study_details');
      expect(tool).toBeDefined();
      expect(tool?.parameters?.properties).toHaveProperty('studyId');
      expect(tool?.parameters?.required).toContain('studyId');
    });

    it('should define get_trial_eligibility tool', () => {
      const tool = AGENT_TOOLS.find((t) => t.type === 'function' && t.name === 'get_trial_eligibility');
      expect(tool).toBeDefined();
      expect(tool?.parameters?.properties).toHaveProperty('nctId');
    });

    it('should define get_available_cancer_types tool', () => {
      const tool = AGENT_TOOLS.find((t) => t.type === 'function' && t.name === 'get_available_cancer_types');
      expect(tool).toBeDefined();
    });
  });

  describe('Tool Execution', () => {
    let agent: TrialAgent;

    beforeEach(() => {
      agent = new TrialAgent('test-api-key');
    });

    it('should execute search_trials without zipCode', async () => {
      const result = await agent.executeTool('search_trials', {
        cancerType: 'Breast',
      }) as any;

      expect(result).toHaveProperty('searchQuery');
      expect(result).toHaveProperty('totalFound');
      expect(result).toHaveProperty('trials');
      expect(Array.isArray(result.trials)).toBe(true);
      // Should show at most 20 trials (new limit)
      expect(result.trials.length).toBeLessThanOrEqual(20);
    });

    it('should execute search_trials with zipCode and sort by distance', async () => {
      const result = await agent.executeTool('search_trials', {
        cancerType: 'Breast',
        zipCode: '37203',
      }) as any;

      expect(result).toHaveProperty('searchQuery');
      expect(result).toHaveProperty('totalFound');
      expect(result).toHaveProperty('trials');
      expect(Array.isArray(result.trials)).toBe(true);
      // Should show at most 20 trials (new limit)
      expect(result.trials.length).toBeLessThanOrEqual(20);
    });

    it('should execute get_trial_eligibility and return eligibility info', async () => {
      const result = await agent.executeTool('get_trial_eligibility', {
        nctId: 'NCT12345678',
      }) as any;

      expect(result).toHaveProperty('nctId');
      expect(result).toHaveProperty('eligibility');
    });

    it('should execute get_available_cancer_types', async () => {
      const result = await agent.executeTool('get_available_cancer_types', {});

      expect(Array.isArray(result)).toBe(true);
      expect(result).toContain('Breast');
    });

    it('should throw error for unknown tool', async () => {
      await expect(agent.executeTool('unknown_tool', {})).rejects.toThrow('Unknown tool');
    });
  });

  describe('System Prompt', () => {
    it('should generate quality-focused system prompt', () => {
      const agent = new TrialAgent('test-api-key');
      const prompt = agent.getSystemPrompt();

      expect(prompt).toContain('clinical trial');
      expect(prompt).toContain('SCRI');
      // Quality-focused elements
      expect(prompt).toContain('Quality');
      expect(prompt).toContain('search_trials');
      expect(prompt).toContain('get_study_details');
    });

    it('should include patient profile in system prompt when provided', () => {
      const agent = new TrialAgent('test-api-key', {
        cancerType: 'Breast',
        zipCode: '37203',
        age: 55,
      });
      const prompt = agent.getSystemPrompt();

      expect(prompt).toContain('Breast');
      expect(prompt).toContain('37203');
    });
  });
});

describe('Agent Response Parsing', () => {
  it('should format trial results for user display', () => {
    const trials: TrialSummary[] = [
      {
        id: '12345',
        name: 'BRE 001',
        title: 'Phase 2 Study of New Treatment',
        nctId: 'NCT12345678',
        phases: ['Phase 2'],
        cancerTypes: ['Breast Cancer'],
        locationCount: 5,
        closestLocation: {
          name: 'Nashville Cancer Center',
          city: 'Nashville',
          state: 'TN',
          phone: '(615) 555-0100',
          distance: 25,
        },
      },
    ];

    const agent = new TrialAgent('test-api-key');
    const formatted = agent.formatTrialsForDisplay(trials);

    expect(formatted).toContain('BRE 001');
    expect(formatted).toContain('NCT12345678');
    expect(formatted).toContain('Nashville');
    expect(formatted).toContain('25 miles');
  });
});
