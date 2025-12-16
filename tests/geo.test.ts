import { describe, it, expect } from 'vitest';
import {
  calculateDistance,
  getZipCoordinates,
  getCoverageMessage,
  SCRI_COVERAGE_STATES,
} from '@/services/geo';

describe('Geo Service', () => {
  describe('calculateDistance', () => {
    it('should calculate distance between two points using Haversine formula', () => {
      // Boston to New York: approximately 190 miles
      const distance = calculateDistance(42.3601, -71.0589, 40.7128, -74.006);
      expect(distance).toBeGreaterThan(180);
      expect(distance).toBeLessThan(200);
    });

    it('should return 0 for same location', () => {
      const distance = calculateDistance(42.3601, -71.0589, 42.3601, -71.0589);
      expect(distance).toBe(0);
    });

    it('should handle cross-country distances', () => {
      // Boston to Los Angeles: approximately 2600 miles
      const distance = calculateDistance(42.3601, -71.0589, 34.0522, -118.2437);
      expect(distance).toBeGreaterThan(2500);
      expect(distance).toBeLessThan(2700);
    });
  });

  describe('getZipCoordinates', () => {
    it('should return coordinates for known ZIP codes', () => {
      const boston = getZipCoordinates('02101');
      expect(boston).toBeDefined();
      expect(boston?.city).toBe('Boston');
      expect(boston?.state).toBe('MA');
      expect(boston?.lat).toBeCloseTo(42.36, 1);
    });

    it('should return coordinates for Nashville', () => {
      const nashville = getZipCoordinates('37203');
      expect(nashville).toBeDefined();
      expect(nashville?.city).toBe('Nashville');
      expect(nashville?.state).toBe('TN');
    });

    it('should return null for unknown ZIP codes', () => {
      const unknown = getZipCoordinates('00000');
      expect(unknown).toBeNull();
    });
  });

  describe('getCoverageMessage', () => {
    it('should return positive message for covered state (Tennessee)', () => {
      const message = getCoverageMessage('37203');
      expect(message).toContain('trial sites');
      expect(message.toLowerCase()).not.toContain('unfortunately');
      expect(message.toLowerCase()).not.toContain("doesn't currently");
    });

    it('should return honest message for non-covered state (Massachusetts)', () => {
      const message = getCoverageMessage('02101');
      // Check that it explains no coverage in MA
      expect(message).toContain('MA');
      expect(message.toLowerCase()).toContain("doesn't") || expect(message).toContain('nearest');
    });

    it('should handle unknown ZIP codes gracefully', () => {
      const message = getCoverageMessage('00000');
      // Should still provide useful information
      expect(message.toLowerCase()).toContain('couldn\'t') || expect(message).toContain('SCRI');
    });
  });

  describe('SCRI_COVERAGE_STATES', () => {
    it('should include known SCRI states', () => {
      expect(SCRI_COVERAGE_STATES).toContain('TN');
      expect(SCRI_COVERAGE_STATES).toContain('TX');
      expect(SCRI_COVERAGE_STATES).toContain('FL');
      expect(SCRI_COVERAGE_STATES).toContain('CA');
    });

    it('should not include Massachusetts', () => {
      expect(SCRI_COVERAGE_STATES).not.toContain('MA');
    });

    it('should have 18 states total', () => {
      expect(SCRI_COVERAGE_STATES).toHaveLength(18);
    });
  });
});
