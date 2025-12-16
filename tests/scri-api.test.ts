import { describe, it, expect, vi, beforeEach } from 'vitest';
import { SCRIApiClient } from '@/services/scri-api';
import type { SCRIFilterData, SCRISearchData, SCRITrial } from '@/types';

// Mock fetch globally
const mockFetch = vi.fn();
global.fetch = mockFetch;

describe('SCRIApiClient', () => {
  let client: SCRIApiClient;

  beforeEach(() => {
    client = new SCRIApiClient();
    mockFetch.mockClear();
  });

  describe('getFilters', () => {
    it('should fetch and return cancer type filters', async () => {
      const mockResponse: { data: SCRIFilterData; success: boolean; message: string; exceptionDetail: string } = {
        data: {
          filterHeading: 'Indication',
          filterId: 1,
          filterColumnName: 'Indication',
          searchFilterType: 0,
          isEnabled: true,
          filterItemList: [
            { filterItemId: 4, filterItemText: 'Breast', filterItemTextDescription: '', isEnabled: true, sortOrder: 4 },
            { filterItemId: 15, filterItemText: 'Lung', filterItemTextDescription: '', isEnabled: true, sortOrder: 15 },
          ],
          sortOrder: 1,
        },
        success: true,
        message: '',
        exceptionDetail: '',
      };

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(mockResponse),
      });

      const result = await client.getFilters();

      expect(mockFetch).toHaveBeenCalledWith(
        'https://trials.scri.com/api/v1/uifilters/default',
        expect.objectContaining({ method: 'GET' })
      );
      expect(result).toHaveLength(2);
      expect(result[0].filterItemText).toBe('Breast');
    });

    it('should throw error on API failure', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 500,
        statusText: 'Internal Server Error',
      });

      await expect(client.getFilters()).rejects.toThrow('API error: 500');
    });
  });

  describe('searchTrials', () => {
    it('should search trials by cancer type', async () => {
      const mockSearchData: SCRISearchData = {
        currentPage: 1,
        itemsPerPage: 10,
        totalItemCount: 45,
        totalPageCount: 5,
        searchResultsData: [
          {
            searchScore: 3.92,
            provider: 'CTMS-SQL',
            studyId: '24226',
            studyName: 'BRE 451',
            protocolName: 'A prospective study',
            protocolTitle: 'The PREDICT Registry',
            nct: 'NCT03448926',
            siteList: [],
            officeList: [],
            programTypeNames: ['Breast Cancer'],
            phaseNames: [],
            searchCancerType: [],
            ncT_Conditions: [],
            ncT_Keywords: [],
          },
        ],
      };

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ data: mockSearchData, success: true, message: '', exceptionDetail: '' }),
      });

      const result = await client.searchTrials('Breast');

      expect(mockFetch).toHaveBeenCalledWith(
        'https://trials.scri.com/api/v1/trials/search/1/Breast/1',
        expect.objectContaining({ method: 'GET' })
      );
      expect(result.totalItemCount).toBe(45);
      expect(result.searchResultsData).toHaveLength(1);
      expect(result.searchResultsData[0].studyName).toBe('BRE 451');
    });

    it('should support pagination', async () => {
      const mockSearchData: SCRISearchData = {
        currentPage: 2,
        itemsPerPage: 10,
        totalItemCount: 45,
        totalPageCount: 5,
        searchResultsData: [],
      };

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ data: mockSearchData, success: true, message: '', exceptionDetail: '' }),
      });

      await client.searchTrials('Breast', 2);

      expect(mockFetch).toHaveBeenCalledWith(
        'https://trials.scri.com/api/v1/trials/search/1/Breast/2',
        expect.objectContaining({ method: 'GET' })
      );
    });

    it('should encode cancer type with spaces', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ 
          data: { currentPage: 1, itemsPerPage: 10, totalItemCount: 0, totalPageCount: 0, searchResultsData: [] }, 
          success: true, message: '', exceptionDetail: '' 
        }),
      });

      await client.searchTrials('Acute Myeloid Leukemia');

      expect(mockFetch).toHaveBeenCalledWith(
        'https://trials.scri.com/api/v1/trials/search/1/Acute%20Myeloid%20Leukemia/1',
        expect.any(Object)
      );
    });
  });

  describe('getTrialDetails', () => {
    it('should fetch trial details by study ID', async () => {
      const mockTrial: SCRITrial = {
        searchScore: null,
        provider: 'CTMS-SQL',
        studyId: '24226',
        studyName: 'BRE 451',
        protocolName: 'A prospective study',
        protocolTitle: 'The PREDICT Registry',
        nct: 'NCT03448926',
        siteList: [
          {
            siteId: '3674',
            siteName1: 'Northwest Cancer Specialists',
            siteName2: '',
            displayName: 'Compass Oncology',
            phoneNumber1: '(503)280-1223',
            phoneNumber2: '',
            faxNumber: '',
            address1: '265 N. Broadway',
            address2: '',
            city: 'Portland',
            state: 'OR',
            zipCode: '97227',
            country: 'US',
            latitude: '45.5351837',
            longitude: '-122.6699195',
            distanceFromTargetZipCode: -1,
          },
        ],
        officeList: [],
        programTypeNames: ['Breast Cancer'],
        phaseNames: [],
        searchCancerType: ['BRE'],
        ncT_Conditions: [],
        ncT_Keywords: [],
      };

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ data: mockTrial, success: true, message: '', exceptionDetail: '' }),
      });

      const result = await client.getTrialDetails('24226');

      expect(mockFetch).toHaveBeenCalledWith(
        'https://trials.scri.com/api/v1/trials/24226',
        expect.objectContaining({ method: 'GET' })
      );
      expect(result.studyId).toBe('24226');
      expect(result.siteList).toHaveLength(1);
    });
  });

  describe('getCancerTypeList', () => {
    it('should return a formatted list of cancer types', async () => {
      const mockResponse = {
        data: {
          filterHeading: 'Indication',
          filterId: 1,
          filterColumnName: 'Indication',
          searchFilterType: 0,
          isEnabled: true,
          filterItemList: [
            { filterItemId: 4, filterItemText: 'Breast', filterItemTextDescription: '', isEnabled: true, sortOrder: 4 },
            { filterItemId: 15, filterItemText: 'Lung', filterItemTextDescription: '', isEnabled: true, sortOrder: 15 },
            { filterItemId: 99, filterItemText: 'Disabled Type', filterItemTextDescription: '', isEnabled: false, sortOrder: 99 },
          ],
          sortOrder: 1,
        },
        success: true,
        message: '',
        exceptionDetail: '',
      };

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(mockResponse),
      });

      const result = await client.getCancerTypeList();

      expect(result).toEqual(['Breast', 'Lung']);
      expect(result).not.toContain('Disabled Type');
    });
  });
});
