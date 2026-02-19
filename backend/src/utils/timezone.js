import { query } from '../config/database.js';

/**
 * Format a Date object using a specific IANA timezone
 * @param {Date|string} date - Date object or ISO string
 * @param {string} timezone - IANA timezone identifier (e.g., 'Asia/Kolkata')
 * @returns {string} Formatted date string (e.g., "Feb 19, 2026, 5:11:02 PM IST")
 */
export function formatWithTimezone(date, timezone = 'UTC') {
  const d = date instanceof Date ? date : new Date(date);
  if (isNaN(d.getTime())) return 'Invalid date';

  const formatted = d.toLocaleString('en-US', {
    timeZone: timezone,
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: true,
  });

  // Get timezone abbreviation
  const abbr = getTimezoneAbbreviation(d, timezone);

  return `${formatted} ${abbr}`;
}

/**
 * Get the timezone abbreviation for a given timezone and date
 * @param {Date} date - Date object
 * @param {string} timezone - IANA timezone identifier
 * @returns {string} Timezone abbreviation (e.g., 'IST', 'PST')
 */
function getTimezoneAbbreviation(date, timezone) {
  try {
    const formatter = new Intl.DateTimeFormat('en-US', {
      timeZone: timezone,
      timeZoneName: 'short',
    });
    const parts = formatter.formatToParts(date);
    const tzPart = parts.find((part) => part.type === 'timeZoneName');
    return tzPart ? tzPart.value : timezone;
  } catch {
    return timezone;
  }
}

/**
 * Get the admin timezone from system_settings
 * @returns {Promise<string>} IANA timezone identifier (defaults to 'UTC')
 */
export async function getAdminTimezone() {
  try {
    const result = await query('SELECT admin_timezone FROM system_settings WHERE id = 1');
    return result.rows[0]?.admin_timezone || 'UTC';
  } catch {
    return 'UTC';
  }
}
