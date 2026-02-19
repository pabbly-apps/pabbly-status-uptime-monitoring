import { formatDistanceToNow } from 'date-fns';

// List of all major timezones organized by region
export const TIMEZONES = [
  // Americas
  { value: 'America/New_York', label: 'Eastern Time', abbr: 'ET', region: 'Americas' },
  { value: 'America/Chicago', label: 'Central Time', abbr: 'CT', region: 'Americas' },
  { value: 'America/Denver', label: 'Mountain Time', abbr: 'MT', region: 'Americas' },
  { value: 'America/Los_Angeles', label: 'Pacific Time', abbr: 'PT', region: 'Americas' },
  { value: 'America/Anchorage', label: 'Alaska Time', abbr: 'AKT', region: 'Americas' },
  { value: 'America/Honolulu', label: 'Hawaii Time', abbr: 'HST', region: 'Americas' },
  { value: 'America/Toronto', label: 'Eastern Time (Canada)', abbr: 'ET', region: 'Americas' },
  { value: 'America/Mexico_City', label: 'Mexico City Time', abbr: 'CST', region: 'Americas' },
  { value: 'America/Sao_Paulo', label: 'Brasilia Time', abbr: 'BRT', region: 'Americas' },
  { value: 'America/Buenos_Aires', label: 'Argentina Time', abbr: 'ART', region: 'Americas' },

  // Europe
  { value: 'Europe/London', label: 'GMT/BST (London)', abbr: 'GMT', region: 'Europe' },
  { value: 'Europe/Paris', label: 'CET/CEST (Paris)', abbr: 'CET', region: 'Europe' },
  { value: 'Europe/Berlin', label: 'CET/CEST (Berlin)', abbr: 'CET', region: 'Europe' },
  { value: 'Europe/Madrid', label: 'CET/CEST (Madrid)', abbr: 'CET', region: 'Europe' },
  { value: 'Europe/Rome', label: 'CET/CEST (Rome)', abbr: 'CET', region: 'Europe' },
  { value: 'Europe/Amsterdam', label: 'CET/CEST (Amsterdam)', abbr: 'CET', region: 'Europe' },
  { value: 'Europe/Brussels', label: 'CET/CEST (Brussels)', abbr: 'CET', region: 'Europe' },
  { value: 'Europe/Moscow', label: 'Moscow Time', abbr: 'MSK', region: 'Europe' },
  { value: 'Europe/Istanbul', label: 'Turkey Time', abbr: 'TRT', region: 'Europe' },
  { value: 'Europe/Athens', label: 'Eastern European Time', abbr: 'EET', region: 'Europe' },

  // Asia
  { value: 'Asia/Kolkata', label: 'India Standard Time', abbr: 'IST', region: 'Asia' },
  { value: 'Asia/Dubai', label: 'Gulf Standard Time', abbr: 'GST', region: 'Asia' },
  { value: 'Asia/Shanghai', label: 'China Standard Time', abbr: 'CST', region: 'Asia' },
  { value: 'Asia/Hong_Kong', label: 'Hong Kong Time', abbr: 'HKT', region: 'Asia' },
  { value: 'Asia/Tokyo', label: 'Japan Standard Time', abbr: 'JST', region: 'Asia' },
  { value: 'Asia/Seoul', label: 'Korea Standard Time', abbr: 'KST', region: 'Asia' },
  { value: 'Asia/Singapore', label: 'Singapore Time', abbr: 'SGT', region: 'Asia' },
  { value: 'Asia/Bangkok', label: 'Indochina Time', abbr: 'ICT', region: 'Asia' },
  { value: 'Asia/Jakarta', label: 'Western Indonesia Time', abbr: 'WIB', region: 'Asia' },
  { value: 'Asia/Karachi', label: 'Pakistan Standard Time', abbr: 'PKT', region: 'Asia' },
  { value: 'Asia/Manila', label: 'Philippine Time', abbr: 'PHT', region: 'Asia' },
  { value: 'Asia/Tehran', label: 'Iran Standard Time', abbr: 'IRST', region: 'Asia' },

  // Pacific
  { value: 'Australia/Sydney', label: 'Australian Eastern Time', abbr: 'AEST', region: 'Pacific' },
  { value: 'Australia/Melbourne', label: 'Australian Eastern Time (Melbourne)', abbr: 'AEST', region: 'Pacific' },
  { value: 'Australia/Brisbane', label: 'Australian Eastern Time (Brisbane)', abbr: 'AEST', region: 'Pacific' },
  { value: 'Australia/Perth', label: 'Australian Western Time', abbr: 'AWST', region: 'Pacific' },
  { value: 'Pacific/Auckland', label: 'New Zealand Time', abbr: 'NZST', region: 'Pacific' },
  { value: 'Pacific/Fiji', label: 'Fiji Time', abbr: 'FJT', region: 'Pacific' },

  // Africa
  { value: 'Africa/Cairo', label: 'Eastern European Time (Cairo)', abbr: 'EET', region: 'Africa' },
  { value: 'Africa/Johannesburg', label: 'South Africa Time', abbr: 'SAST', region: 'Africa' },
  { value: 'Africa/Lagos', label: 'West Africa Time', abbr: 'WAT', region: 'Africa' },
  { value: 'Africa/Nairobi', label: 'East Africa Time', abbr: 'EAT', region: 'Africa' },

  // Special
  { value: 'UTC', label: 'Coordinated Universal Time', abbr: 'UTC', region: 'Special' },
];

/**
 * Get the user's current timezone from the browser
 * @returns {string} IANA timezone identifier (e.g., 'Asia/Kolkata')
 */
export const getUserTimezone = () => {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone;
  } catch (error) {
    console.error('Error detecting timezone:', error);
    return 'UTC'; // Fallback to UTC
  }
};

/**
 * Get the timezone abbreviation for a given timezone
 * @param {string} timezone - IANA timezone identifier
 * @param {Date} date - Optional date to get abbreviation for (defaults to now)
 * @returns {string} Timezone abbreviation (e.g., 'IST', 'PST')
 */
export const getTimezoneAbbreviation = (timezone, date = new Date()) => {
  try {
    const formatter = new Intl.DateTimeFormat('en-US', {
      timeZone: timezone,
      timeZoneName: 'short',
    });
    const parts = formatter.formatToParts(date);
    const tzPart = parts.find((part) => part.type === 'timeZoneName');
    const abbr = tzPart ? tzPart.value : timezone;

    // Browser returns offset form (e.g., "GMT+5:30") for some timezones
    // Show both abbreviation and offset (e.g., "IST (GMT+5:30)")
    if (abbr.startsWith('GMT+') || abbr.startsWith('GMT-')) {
      const tz = TIMEZONES.find((t) => t.value === timezone);
      if (tz) return `${tz.abbr} (${abbr})`;
    }

    return abbr;
  } catch (error) {
    console.error('Error getting timezone abbreviation:', error);
    // Try to find in our TIMEZONES list
    const tz = TIMEZONES.find((t) => t.value === timezone);
    return tz ? tz.abbr : timezone;
  }
};

/**
 * Get the full timezone label from IANA identifier
 * @param {string} timezone - IANA timezone identifier
 * @returns {string} Full timezone label (e.g., 'India Standard Time')
 */
export const getTimezoneLabel = (timezone) => {
  const tz = TIMEZONES.find((t) => t.value === timezone);
  return tz ? tz.label : timezone;
};

/**
 * Format a timestamp with timezone information
 * @param {string|Date} timestamp - The timestamp to format
 * @param {Object} options - Formatting options
 * @param {boolean} options.showRelative - Show relative time (e.g., "5 minutes ago")
 * @param {boolean} options.showExact - Show exact date/time
 * @param {boolean} options.showTimezone - Show timezone abbreviation
 * @param {string} options.timezone - Timezone to use (defaults to user's timezone)
 * @returns {string} Formatted timestamp string
 */
export const formatTimestampWithTZ = (timestamp, options = {}) => {
  const {
    showRelative = true,
    showExact = true,
    showTimezone = true,
    timezone = getUserTimezone(),
  } = options;

  if (!timestamp) return null;

  const date = new Date(timestamp);
  if (isNaN(date.getTime())) return 'Invalid date';

  const tzAbbr = getTimezoneAbbreviation(timezone, date);
  let result = '';

  // Add relative time
  if (showRelative) {
    result += formatDistanceToNow(date, { addSuffix: true });
  }

  // Add exact datetime
  if (showExact) {
    const exact = date.toLocaleString('en-US', {
      timeZone: timezone,
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: true,
    });

    if (showRelative) {
      result += ` (${exact}`;
    } else {
      result += exact;
    }

    if (showTimezone) {
      result += ` ${tzAbbr}`;
    }

    if (showRelative) {
      result += ')';
    }
  }

  return result;
};

/**
 * Format timestamp for full details (used in tooltips)
 * @param {string|Date} timestamp - The timestamp to format
 * @param {string} timezone - Timezone to use
 * @returns {string} Full formatted timestamp with long timezone name
 */
export const formatFullTimestamp = (timestamp, timezone = getUserTimezone()) => {
  if (!timestamp) return null;

  const date = new Date(timestamp);
  if (isNaN(date.getTime())) return 'Invalid date';

  return date.toLocaleString('en-US', {
    timeZone: timezone,
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: true,
    timeZoneName: 'long',
  });
};

/**
 * Group timezones by region for dropdown display
 * @returns {Object} Timezones grouped by region
 */
export const getGroupedTimezones = () => {
  const grouped = {};

  TIMEZONES.forEach((tz) => {
    if (!grouped[tz.region]) {
      grouped[tz.region] = [];
    }
    grouped[tz.region].push(tz);
  });

  return grouped;
};

/**
 * Find timezone object by value
 * @param {string} timezoneValue - IANA timezone identifier
 * @returns {Object|null} Timezone object or null
 */
export const findTimezone = (timezoneValue) => {
  return TIMEZONES.find((tz) => tz.value === timezoneValue) || null;
};
