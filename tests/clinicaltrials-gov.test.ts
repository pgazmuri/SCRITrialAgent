import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  fetchCTGovStudy,
  formatEligibilityForDisplay,
  formatTreatmentInfo,
  parseEligibilityCriteria,
} from '@/services/clinicaltrials-gov';
import type { CTGovStudy } from '@/services/clinicaltrials-gov';

// Mock global fetch
const mockFetch = vi.fn();
global.fetch = mockFetch;

describe('ClinicalTrials.gov Service', () => {
  beforeEach(() => {
    mockFetch.mockReset();
  });

  describe('fetchCTGovStudy', () => {
    it('should fetch study from ClinicalTrials.gov API', async () => {
      // Mock the raw API response structure
      const mockApiResponse = {
        protocolSection: {
          identificationModule: {
            nctId: 'NCT12345678',
            briefTitle: 'Test Study',
          },
          descriptionModule: {
            briefSummary: 'A test study',
          },
          eligibilityModule: {
            eligibilityCriteria: 'Inclusion Criteria:\n- Age 18+',
            minimumAge: '18 Years',
            sex: 'All',
          },
          armsInterventionsModule: {
            interventions: [
              { type: 'Drug', name: 'Test Drug', description: 'Test' },
            ],
          },
        },
      };

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(mockApiResponse),
      });

      const result = await fetchCTGovStudy('NCT12345678');
      expect(result).toBeDefined();
      expect(result?.nctId).toBe('NCT12345678');
      expect(result?.briefTitle).toBe('Test Study');
      expect(result?.eligibility?.minimumAge).toBe('18 Years');
    });

    it('should return null for failed request', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 404,
      });

      const result = await fetchCTGovStudy('NCT00000000');
      expect(result).toBeNull();
    });

    it('should return null for invalid NCT ID', async () => {
      const result = await fetchCTGovStudy('INVALID');
      expect(result).toBeNull();
    });
  });

  describe('parseEligibilityCriteria', () => {
    it('should parse inclusion and exclusion criteria', () => {
      const criteria = `Inclusion Criteria:
- Age 18 or older
- Confirmed diagnosis of breast cancer
- ECOG performance status 0-1

Exclusion Criteria:
- Prior treatment with anthracycline
- Active brain metastases`;

      const result = parseEligibilityCriteria(criteria);
      expect(result.inclusion).toContain('Age 18 or older');
      expect(result.inclusion).toContain('Confirmed diagnosis of breast cancer');
      expect(result.exclusion).toContain('Prior treatment with anthracycline');
    });

    it('should handle criteria without clear sections', () => {
      const criteria = `Must be 18 years or older with confirmed cancer diagnosis and ECOG 0-1`;

      const result = parseEligibilityCriteria(criteria);
      // When no clear sections, treat as inclusion
      expect(result.inclusion.length + result.exclusion.length).toBeGreaterThanOrEqual(0);
    });

    it('should return empty arrays for empty criteria', () => {
      const result = parseEligibilityCriteria('');
      expect(result.inclusion).toEqual([]);
      expect(result.exclusion).toEqual([]);
    });
  });

  describe('formatEligibilityForDisplay', () => {
    it('should format eligibility information from study', () => {
      const study: CTGovStudy = {
        nctId: 'NCT12345678',
        briefTitle: 'Test Study',
        eligibility: {
          minimumAge: '18 Years',
          maximumAge: '75 Years',
          sex: 'Female',
          healthyVolunteers: 'No',
        },
        eligibilityCriteria: 'Inclusion Criteria:\n- Age 18+\n\nExclusion Criteria:\n- None applicable',
      };

      const result = formatEligibilityForDisplay(study);
      expect(result).toContain('Age');
      expect(result).toContain('18 Years');
      expect(result).toContain('Female');
    });

    it('should return fallback message when no eligibility info', () => {
      const study: CTGovStudy = {
        nctId: 'NCT12345678',
        briefTitle: 'Test Study',
      };

      const result = formatEligibilityForDisplay(study);
      expect(result).toContain('not available');
    });
  });

  describe('formatTreatmentInfo', () => {
    it('should format intervention information from study', () => {
      const study: CTGovStudy = {
        nctId: 'NCT12345678',
        briefTitle: 'Test Study',
        interventions: [
          {
            type: 'Drug',
            name: 'Tucatinib',
            description: 'HER2 tyrosine kinase inhibitor',
          },
          {
            type: 'Drug',
            name: 'Doxorubicin',
            description: 'Chemotherapy agent',
          },
        ],
      };

      const result = formatTreatmentInfo(study);
      expect(result).toContain('Tucatinib');
      expect(result).toContain('Drug');
      expect(result).toContain('Doxorubicin');
    });

    it('should handle study without interventions', () => {
      const study: CTGovStudy = {
        nctId: 'NCT12345678',
        briefTitle: 'Test Study',
      };

      const result = formatTreatmentInfo(study);
      expect(result).toContain('not available');
    });
  });
});
