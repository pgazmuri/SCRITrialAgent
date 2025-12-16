/**
 * Geo utilities for distance calculation and ZIP code lookup
 */

// Simple US ZIP code to lat/lon lookup (major cities and regions)
// In production, use a full ZIP database or geocoding API
const ZIP_COORDINATES: Record<string, { lat: number; lon: number; city: string; state: string }> = {
  // Massachusetts
  '02101': { lat: 42.3601, lon: -71.0589, city: 'Boston', state: 'MA' },
  '02102': { lat: 42.3601, lon: -71.0589, city: 'Boston', state: 'MA' },
  '02108': { lat: 42.3576, lon: -71.0636, city: 'Boston', state: 'MA' },
  '02109': { lat: 42.3604, lon: -71.0535, city: 'Boston', state: 'MA' },
  '02110': { lat: 42.3570, lon: -71.0513, city: 'Boston', state: 'MA' },
  '02115': { lat: 42.3420, lon: -71.0904, city: 'Boston', state: 'MA' },
  '02116': { lat: 42.3503, lon: -71.0766, city: 'Boston', state: 'MA' },
  '02134': { lat: 42.3554, lon: -71.1317, city: 'Allston', state: 'MA' },
  '02138': { lat: 42.3809, lon: -71.1342, city: 'Cambridge', state: 'MA' },
  '02139': { lat: 42.3650, lon: -71.1042, city: 'Cambridge', state: 'MA' },
  
  // New York
  '10001': { lat: 40.7506, lon: -73.9971, city: 'New York', state: 'NY' },
  '10016': { lat: 40.7459, lon: -73.9778, city: 'New York', state: 'NY' },
  '10019': { lat: 40.7654, lon: -73.9854, city: 'New York', state: 'NY' },
  '10021': { lat: 40.7693, lon: -73.9588, city: 'New York', state: 'NY' },
  '10022': { lat: 40.7587, lon: -73.9681, city: 'New York', state: 'NY' },
  
  // Tennessee (SCRI HQ)
  '37203': { lat: 36.1503, lon: -86.7958, city: 'Nashville', state: 'TN' },
  '37215': { lat: 36.1048, lon: -86.8417, city: 'Nashville', state: 'TN' },
  '37232': { lat: 36.1412, lon: -86.8031, city: 'Nashville', state: 'TN' },
  
  // Texas
  '75001': { lat: 32.9545, lon: -96.8389, city: 'Addison', state: 'TX' },
  '75093': { lat: 33.0340, lon: -96.8073, city: 'Plano', state: 'TX' },
  '77001': { lat: 29.7543, lon: -95.3532, city: 'Houston', state: 'TX' },
  '77030': { lat: 29.7070, lon: -95.3964, city: 'Houston', state: 'TX' },
  '78701': { lat: 30.2729, lon: -97.7444, city: 'Austin', state: 'TX' },
  '75201': { lat: 32.7872, lon: -96.7985, city: 'Dallas', state: 'TX' },
  
  // California
  '90001': { lat: 33.9425, lon: -118.2551, city: 'Los Angeles', state: 'CA' },
  '90210': { lat: 34.0901, lon: -118.4065, city: 'Beverly Hills', state: 'CA' },
  '94102': { lat: 37.7813, lon: -122.4167, city: 'San Francisco', state: 'CA' },
  '92101': { lat: 32.7194, lon: -117.1628, city: 'San Diego', state: 'CA' },
  '93101': { lat: 34.4208, lon: -119.6982, city: 'Santa Barbara', state: 'CA' },
  
  // Florida
  '32801': { lat: 28.5421, lon: -81.3790, city: 'Orlando', state: 'FL' },
  '33101': { lat: 25.7753, lon: -80.1946, city: 'Miami', state: 'FL' },
  '33602': { lat: 27.9517, lon: -82.4588, city: 'Tampa', state: 'FL' },
  
  // Maryland (closest to Boston with SCRI sites)
  '21401': { lat: 38.9784, lon: -76.4922, city: 'Annapolis', state: 'MD' },
  '20814': { lat: 38.9970, lon: -77.0975, city: 'Bethesda', state: 'MD' },
  '21201': { lat: 39.2904, lon: -76.6122, city: 'Baltimore', state: 'MD' },
  
  // Pennsylvania
  '19101': { lat: 39.9526, lon: -75.1652, city: 'Philadelphia', state: 'PA' },
  '15201': { lat: 40.4681, lon: -79.9513, city: 'Pittsburgh', state: 'PA' },
  
  // Illinois
  '60601': { lat: 41.8819, lon: -87.6278, city: 'Chicago', state: 'IL' },
  '60611': { lat: 41.8930, lon: -87.6246, city: 'Chicago', state: 'IL' },
  
  // Colorado
  '80202': { lat: 39.7530, lon: -104.9996, city: 'Denver', state: 'CO' },
  
  // Virginia
  '22201': { lat: 38.8851, lon: -77.0946, city: 'Arlington', state: 'VA' },
  '23219': { lat: 37.5407, lon: -77.4360, city: 'Richmond', state: 'VA' },
  
  // Ohio
  '43215': { lat: 39.9611, lon: -83.0000, city: 'Columbus', state: 'OH' },
  '44101': { lat: 41.4822, lon: -81.6697, city: 'Cleveland', state: 'OH' },
  
  // Oregon
  '97201': { lat: 45.5051, lon: -122.6750, city: 'Portland', state: 'OR' },
  '97015': { lat: 45.4340, lon: -122.5344, city: 'Clackamas', state: 'OR' },
  '97227': { lat: 45.5351, lon: -122.6699, city: 'Portland', state: 'OR' },
  
  // Washington
  '98101': { lat: 47.6097, lon: -122.3331, city: 'Seattle', state: 'WA' },
  '98684': { lat: 45.6198, lon: -122.5344, city: 'Vancouver', state: 'WA' },
  
  // Other states with SCRI sites
  '35203': { lat: 33.5186, lon: -86.8104, city: 'Birmingham', state: 'AL' },
  '19801': { lat: 39.7391, lon: -75.5398, city: 'Wilmington', state: 'DE' },
  '55401': { lat: 44.9833, lon: -93.2667, city: 'Minneapolis', state: 'MN' },
  '63101': { lat: 38.6270, lon: -90.1994, city: 'St. Louis', state: 'MO' },
  '87101': { lat: 35.0853, lon: -106.6056, city: 'Albuquerque', state: 'NM' },
  '53201': { lat: 43.0389, lon: -87.9065, city: 'Milwaukee', state: 'WI' },
};

/**
 * Get coordinates for a ZIP code
 * Returns null if ZIP not in database
 */
export function getZipCoordinates(zipCode: string): { lat: number; lon: number; city: string; state: string } | null {
  const normalized = zipCode.trim().substring(0, 5);
  return ZIP_COORDINATES[normalized] || null;
}

/**
 * Calculate distance between two points using Haversine formula
 * @returns Distance in miles
 */
export function calculateDistance(
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number
): number {
  const R = 3959; // Earth's radius in miles
  const dLat = toRadians(lat2 - lat1);
  const dLon = toRadians(lon2 - lon1);
  
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRadians(lat1)) * Math.cos(toRadians(lat2)) *
    Math.sin(dLon / 2) * Math.sin(dLon / 2);
  
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  
  return Math.round(R * c);
}

function toRadians(degrees: number): number {
  return degrees * (Math.PI / 180);
}

/**
 * States where SCRI has trial sites
 */
export const SCRI_COVERAGE_STATES = [
  'AL', 'CA', 'CO', 'DE', 'FL', 'IL', 'MD', 'MN', 'MO', 
  'NM', 'OH', 'OR', 'PA', 'TN', 'TX', 'VA', 'WA', 'WI'
];

/**
 * Check if a state has SCRI trial coverage
 */
export function hasStateCoverage(state: string): boolean {
  const normalized = state.toUpperCase().trim();
  return SCRI_COVERAGE_STATES.includes(normalized);
}

/**
 * Get coverage message for a location
 */
export function getCoverageMessage(zipCode: string): string {
  const location = getZipCoordinates(zipCode);
  
  if (!location) {
    return "I couldn't find your location. SCRI has trial sites in: " + 
           SCRI_COVERAGE_STATES.join(', ') + ".";
  }
  
  if (hasStateCoverage(location.state)) {
    return `Great news! SCRI has trial sites in ${location.state}.`;
  }
  
  // Find nearest states with coverage
  const nearestStates = getNearestCoverageStates(location.lat, location.lon);
  
  return `SCRI doesn't currently have trial sites in ${location.state} (${location.city}). ` +
         `The nearest states with trial sites are: ${nearestStates.join(', ')}. ` +
         `Would you be willing to travel to one of these locations for treatment?`;
}

/**
 * Get the nearest states with SCRI coverage
 */
function getNearestCoverageStates(lat: number, lon: number): string[] {
  // State centroids for distance calculation
  const stateCentroids: Record<string, { lat: number; lon: number }> = {
    'AL': { lat: 32.806671, lon: -86.791130 },
    'CA': { lat: 36.778259, lon: -119.417931 },
    'CO': { lat: 39.550051, lon: -105.782067 },
    'DE': { lat: 39.318523, lon: -75.507141 },
    'FL': { lat: 27.994402, lon: -81.760254 },
    'IL': { lat: 40.349457, lon: -88.986137 },
    'MD': { lat: 39.063946, lon: -76.802101 },
    'MN': { lat: 45.694454, lon: -93.900192 },
    'MO': { lat: 38.573936, lon: -92.603760 },
    'NM': { lat: 34.840515, lon: -106.248482 },
    'OH': { lat: 40.388783, lon: -82.764915 },
    'OR': { lat: 43.804133, lon: -120.554201 },
    'PA': { lat: 41.203322, lon: -77.194525 },
    'TN': { lat: 35.860119, lon: -86.660156 },
    'TX': { lat: 31.968599, lon: -99.901810 },
    'VA': { lat: 37.769337, lon: -78.169968 },
    'WA': { lat: 47.400902, lon: -121.490494 },
    'WI': { lat: 44.268543, lon: -89.616508 },
  };
  
  const distances = Object.entries(stateCentroids)
    .map(([state, coords]) => ({
      state,
      distance: calculateDistance(lat, lon, coords.lat, coords.lon),
    }))
    .sort((a, b) => a.distance - b.distance);
  
  return distances.slice(0, 3).map(d => `${d.state} (~${d.distance} miles)`);
}
