import crypto from 'crypto';
import pool from '../config/database.js';
import { formatWithTimezone } from '../utils/timezone.js';

/**
 * Webhook Service
 * Handles sending webhooks for API status changes and logging delivery attempts
 */

/**
 * Get or generate the webhook signing secret.
 * Auto-generates a 32-byte hex secret on first use and stores it in system_settings.
 * @returns {Promise<string>} The webhook secret
 */
async function getWebhookSecret() {
  const result = await pool.query('SELECT webhook_secret FROM system_settings WHERE id = 1');
  const existing = result.rows[0]?.webhook_secret;
  if (existing) return existing;

  // Generate and persist a new secret
  const secret = crypto.randomBytes(32).toString('hex');
  await pool.query('UPDATE system_settings SET webhook_secret = $1 WHERE id = 1', [secret]);
  return secret;
}

/**
 * Sign a webhook payload with HMAC-SHA256.
 * @param {string} body - The JSON string payload
 * @param {string} secret - The webhook secret
 * @param {number} timestamp - Unix timestamp (seconds)
 * @returns {string} The HMAC hex signature
 */
function signPayload(body, secret, timestamp) {
  // Sign "timestamp.body" to prevent replay attacks
  return crypto.createHmac('sha256', secret).update(`${timestamp}.${body}`).digest('hex');
}

/**
 * Build consistent webhook payload structure
 * @param {string} eventType - 'api_down' or 'api_up'
 * @param {object} api - API object with id, name, url, etc.
 * @param {object} incident - Incident object with details
 * @param {number|null} currentStatusCode - Current HTTP status code (for api_up events, this is the recovery code like 200)
 * @param {string} timezone - IANA timezone identifier
 * @returns {object} Webhook payload
 */
function buildWebhookPayload(eventType, api, incident, currentStatusCode = null, timezone = 'UTC') {
  const status = eventType === 'api_down' ? 'down' : 'up';

  // Calculate downtime in minutes if incident is resolved
  let downtimeMinutes = null;
  if (incident.resolved_at && incident.started_at) {
    const start = new Date(incident.started_at);
    const end = new Date(incident.resolved_at);
    downtimeMinutes = Math.round((end - start) / 60000);
  }

  // Determine the status code to send:
  // - For api_down: use incident.status_code (the error code that caused the incident)
  // - For api_up: use currentStatusCode (the recovery code, e.g., 200)
  const statusCodeToSend = eventType === 'api_up' && currentStatusCode
    ? currentStatusCode
    : (incident.status_code || null);

  return {
    event_type: eventType,
    status: status,
    timestamp: formatWithTimezone(new Date(), timezone),
    api: {
      id: api.id,
      name: api.name,
      url: api.url,
      monitoring_interval: api.monitoring_interval,
      expected_status_code: api.expected_status_code
    },
    incident: {
      id: incident.id,
      title: incident.title,
      description: incident.description,
      status: incident.status,
      status_code: statusCodeToSend,
      started_at: incident.started_at ? formatWithTimezone(new Date(incident.started_at), timezone) : null,
      resolved_at: incident.resolved_at ? formatWithTimezone(new Date(incident.resolved_at), timezone) : null,
      ...(downtimeMinutes !== null && { downtime_minutes: downtimeMinutes })
    }
  };
}

/**
 * Log webhook delivery attempt to database
 * @param {string} webhookUrl - URL where webhook was sent
 * @param {string} eventType - Event type (api_down/api_up)
 * @param {number} apiId - API ID
 * @param {number} incidentId - Incident ID
 * @param {object} payload - Webhook payload
 * @param {boolean} success - Whether delivery succeeded
 * @param {number|null} statusCode - HTTP status code
 * @param {string|null} errorMessage - Error message if failed
 * @param {number} responseTime - Response time in milliseconds
 */
async function logWebhookDelivery(webhookUrl, eventType, apiId, incidentId, payload, success, statusCode, errorMessage, responseTime) {
  try {
    await pool.query(
      `INSERT INTO webhook_logs
       (webhook_url, event_type, api_id, incident_id, payload, success, status_code, error_message, response_time)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
      [webhookUrl, eventType, apiId, incidentId, payload, success, statusCode, errorMessage, responseTime]
    );
  } catch (error) {
    console.error('Failed to log webhook delivery:', error);
  }
}

/**
 * Send webhook notification
 * Fire-and-forget async function - does not block incident processing
 * @param {string} eventType - 'api_down' or 'api_up'
 * @param {object} api - API object
 * @param {object} incident - Incident object
 * @param {number|null} currentStatusCode - Current HTTP status code (for api_up, this is the recovery code like 200)
 */
export async function sendWebhook(eventType, api, incident, currentStatusCode = null) {
  // Execute webhook asynchronously without blocking
  setImmediate(async () => {
    const startTime = Date.now();
    let success = false;
    let statusCode = null;
    let errorMessage = null;

    try {
      // Get webhook settings
      const settingsResult = await pool.query(
        'SELECT webhook_url, webhook_enabled, admin_timezone FROM system_settings WHERE id = 1'
      );

      if (!settingsResult.rows.length) {
        console.log('No system settings found, skipping webhook');
        return;
      }

      const { webhook_url, webhook_enabled, admin_timezone } = settingsResult.rows[0];
      const timezone = admin_timezone || 'UTC';

      // Check if webhooks are enabled and URL is configured
      if (!webhook_enabled) {
        console.log('Webhooks disabled, skipping');
        return;
      }

      if (!webhook_url || webhook_url.trim() === '') {
        console.log('Webhook URL not configured, skipping');
        return;
      }

      // Build payload
      const payload = buildWebhookPayload(eventType, api, incident, currentStatusCode, timezone);
      const body = JSON.stringify(payload);

      // Generate HMAC signature
      const secret = await getWebhookSecret();
      const timestamp = Math.floor(Date.now() / 1000);
      const signature = signPayload(body, secret, timestamp);

      // Send webhook with 10-second timeout
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 10000);

      const response = await fetch(webhook_url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'User-Agent': 'Pabbly-Status-Monitor/1.0',
          'X-Webhook-Signature': `sha256=${signature}`,
          'X-Webhook-Timestamp': String(timestamp)
        },
        body,
        signal: controller.signal
      });

      clearTimeout(timeoutId);

      statusCode = response.status;
      success = response.ok;

      if (!response.ok) {
        const responseText = await response.text();
        errorMessage = `HTTP ${statusCode}: ${responseText.substring(0, 500)}`;
        console.error(`Webhook delivery failed: ${errorMessage}`);
      } else {
        console.log(`Webhook delivered successfully: ${eventType} for ${api.name}`);
      }

      const responseTime = Date.now() - startTime;

      // Log delivery attempt
      await logWebhookDelivery(
        webhook_url,
        eventType,
        api.id,
        incident.id,
        payload,
        success,
        statusCode,
        errorMessage,
        responseTime
      );

    } catch (error) {
      const responseTime = Date.now() - startTime;
      errorMessage = error.message;

      if (error.name === 'AbortError') {
        errorMessage = 'Request timeout after 10 seconds';
      }

      console.error(`Webhook error for ${eventType}:`, errorMessage);

      // Try to get webhook URL for logging
      try {
        const settingsResult = await pool.query(
          'SELECT webhook_url FROM system_settings WHERE id = 1'
        );
        const webhook_url = settingsResult.rows[0]?.webhook_url || 'unknown';

        // Build payload for logging (even if webhook failed)
        const payload = buildWebhookPayload(eventType, api, incident, currentStatusCode);

        await logWebhookDelivery(
          webhook_url,
          eventType,
          api.id,
          incident.id,
          payload,
          false,
          null,
          errorMessage,
          responseTime
        );
      } catch (logError) {
        console.error('Failed to log webhook failure:', logError);
      }
    }
  });
}

/**
 * Send test webhook
 * @returns {object} Result with success status and details
 */
export async function testWebhook() {
  const startTime = Date.now();

  try {
    // Get webhook settings
    const settingsResult = await pool.query(
      'SELECT webhook_url, webhook_enabled, admin_timezone FROM system_settings WHERE id = 1'
    );

    if (!settingsResult.rows.length) {
      return { success: false, message: 'System settings not found' };
    }

    const { webhook_url, webhook_enabled, admin_timezone } = settingsResult.rows[0];
    const timezone = admin_timezone || 'UTC';

    if (!webhook_url || webhook_url.trim() === '') {
      return { success: false, message: 'Webhook URL not configured' };
    }

    // Build test payload (matches real webhook structure - simulates an api_up event with resolution)
    const now = new Date();
    const testStartTime = new Date(now.getTime() - 5 * 60000); // 5 minutes ago
    const testPayload = {
      event_type: 'test',
      status: 'test',
      timestamp: formatWithTimezone(now, timezone),
      api: {
        id: 0,
        name: 'Test API',
        url: 'https://example.com/test',
        monitoring_interval: 60,
        expected_status_code: 200
      },
      incident: {
        id: 0,
        title: 'Test Webhook',
        description: 'This is a test webhook from Status Monitor to verify your endpoint is working correctly',
        status: 'test',
        status_code: 500, // Example status code for test
        started_at: formatWithTimezone(testStartTime, timezone),
        resolved_at: formatWithTimezone(now, timezone),
        downtime_minutes: 5
      }
    };

    // Generate HMAC signature
    const body = JSON.stringify(testPayload);
    const secret = await getWebhookSecret();
    const timestamp = Math.floor(Date.now() / 1000);
    const signature = signPayload(body, secret, timestamp);

    // Send test webhook with 10-second timeout
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 10000);

    const response = await fetch(webhook_url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'User-Agent': 'Pabbly-Status-Monitor/1.0',
        'X-Webhook-Signature': `sha256=${signature}`,
        'X-Webhook-Timestamp': String(timestamp)
      },
      body,
      signal: controller.signal
    });

    clearTimeout(timeoutId);

    const responseTime = Date.now() - startTime;

    if (response.ok) {
      return {
        success: true,
        message: `Test webhook sent successfully (${responseTime}ms)`,
        statusCode: response.status,
        responseTime
      };
    } else {
      const responseText = await response.text();
      return {
        success: false,
        message: `Webhook endpoint returned HTTP ${response.status}`,
        statusCode: response.status,
        error: responseText.substring(0, 500),
        responseTime
      };
    }

  } catch (error) {
    const responseTime = Date.now() - startTime;
    let errorMessage = error.message;

    if (error.name === 'AbortError') {
      errorMessage = 'Request timeout after 10 seconds';
    }

    return {
      success: false,
      message: 'Failed to send test webhook',
      error: errorMessage,
      responseTime
    };
  }
}
