import pool from '../config/database.js';
import { formatWithTimezone } from '../utils/timezone.js';

/**
 * Google Chat Webhook Service
 * Sends formatted text notifications directly to Google Chat spaces
 * Independent of the generic webhook — works even when Pabbly Connect is down
 */

/**
 * Build a Google Chat text payload for a downtime event
 * Matches the existing Pabbly Connect notification format
 */
function buildDowntimePayload(api, incident, timezone = 'UTC') {
  const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:5173';
  const statusCodeText = incident.status_code ? `${incident.status_code}` : '—';
  const detectedAt = incident.started_at ? formatWithTimezone(new Date(incident.started_at), timezone) : '';

  const lines = [
    `━━━━━━━━━━━━━━━━━━━━━━━━━━`,
    `🚨 *SERVICE ALERT — ${api.name}*`,
    `━━━━━━━━━━━━━━━━━━━━━━━━━━`,
    '',
    `🔴 *INCIDENT DETECTED*`,
    '',
    `▸ Service       : ${api.name}`,
    `▸ Status        : Down`,
    `▸ Response Code : ${statusCodeText}`,
    `▸ Detected      : ${detectedAt}`,
    '',
    `📝 ${incident.description || `${api.name} (${api.url}) returned HTTP ${statusCodeText} (expected ${api.expected_status_code || 200}).`}`,
    '',
    `🔗 Dashboard: ${frontendUrl}`,
    `━━━━━━━━━━━━━━━━━━━━━━━━━━`,
  ];

  return { text: lines.join('\n') };
}

/**
 * Build a Google Chat text payload for a recovery event
 * Matches the existing Pabbly Connect notification format
 */
function buildRecoveryPayload(api, incident, currentStatusCode, timezone = 'UTC') {
  const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:5173';
  const recoveryCode = currentStatusCode || api.expected_status_code || 200;
  const detectedAt = incident.started_at ? formatWithTimezone(new Date(incident.started_at), timezone) : '';
  const resolvedAt = incident.resolved_at ? formatWithTimezone(new Date(incident.resolved_at), timezone) : '';

  let downtimeMinutes = null;
  if (incident.resolved_at && incident.started_at) {
    const start = new Date(incident.started_at);
    const end = new Date(incident.resolved_at);
    downtimeMinutes = Math.round((end - start) / 60000);
  }

  const lines = [
    `━━━━━━━━━━━━━━━━━━━━━━━━━━`,
    `✅ *SERVICE RESTORED — ${api.name}*`,
    `━━━━━━━━━━━━━━━━━━━━━━━━━━`,
    '',
    `🟢 *INCIDENT RESOLVED*`,
    '',
    `▸ Service       : ${api.name}`,
    `▸ Status        : Recovered`,
    `▸ Response Code : ${recoveryCode}`,
    `▸ Detected      : ${detectedAt}`,
    `▸ Resolved      : ${resolvedAt}`,
  ];

  if (downtimeMinutes !== null) {
    lines.push(`▸ Downtime      : ${downtimeMinutes} minutes`);
  }

  lines.push(
    '',
    `🔗 Service: ${api.url}`,
    `🔗 Dashboard: ${frontendUrl}`,
    `━━━━━━━━━━━━━━━━━━━━━━━━━━`,
  );

  return { text: lines.join('\n') };
}

/**
 * Build a test text payload
 */
function buildTestPayload(timezone = 'UTC') {
  const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:5173';
  const now = new Date();

  const lines = [
    `━━━━━━━━━━━━━━━━━━━━━━━━━━`,
    `🔔 *TEST NOTIFICATION*`,
    `━━━━━━━━━━━━━━━━━━━━━━━━━━`,
    '',
    `✅ *Connection Verified*`,
    '',
    `Your Google Chat webhook is configured correctly.`,
    `Notifications from Pabbly Status Monitor will appear here.`,
    '',
    `▸ Sent At : ${formatWithTimezone(now, timezone)}`,
    '',
    `🔗 Dashboard: ${frontendUrl}`,
    `━━━━━━━━━━━━━━━━━━━━━━━━━━`,
  ];

  return { text: lines.join('\n') };
}

/**
 * Log Google Chat webhook delivery to the shared webhook_logs table
 */
async function logDelivery(webhookUrl, eventType, apiId, incidentId, payload, success, statusCode, errorMessage, responseTime) {
  try {
    await pool.query(
      `INSERT INTO webhook_logs
       (webhook_url, event_type, api_id, incident_id, payload, success, status_code, error_message, response_time)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
      [webhookUrl, eventType, apiId, incidentId, payload, success, statusCode, errorMessage, responseTime]
    );
  } catch (error) {
    console.error('Failed to log Google Chat webhook delivery:', error);
  }
}

/**
 * Send a notification to Google Chat
 * Fire-and-forget async — does not block incident processing
 */
export async function sendGoogleChatNotification(eventType, api, incident, currentStatusCode = null) {
  setImmediate(async () => {
    const startTime = Date.now();
    let success = false;
    let statusCode = null;
    let errorMessage = null;

    try {
      const settingsResult = await pool.query(
        'SELECT google_chat_webhook_url, google_chat_webhook_enabled, admin_timezone FROM system_settings WHERE id = 1'
      );

      if (!settingsResult.rows.length) {
        return;
      }

      const { google_chat_webhook_url, google_chat_webhook_enabled, admin_timezone } = settingsResult.rows[0];
      const timezone = admin_timezone || 'UTC';

      if (!google_chat_webhook_enabled) {
        return;
      }

      if (!google_chat_webhook_url || google_chat_webhook_url.trim() === '') {
        return;
      }

      // Build the appropriate payload
      let payload;
      if (eventType === 'api_down') {
        payload = buildDowntimePayload(api, incident, timezone);
      } else if (eventType === 'api_up') {
        payload = buildRecoveryPayload(api, incident, currentStatusCode, timezone);
      } else {
        return;
      }

      // Send with 30-second timeout
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 30000);

      const response = await fetch(google_chat_webhook_url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json; charset=UTF-8' },
        body: JSON.stringify(payload),
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      statusCode = response.status;
      success = response.ok;

      if (!response.ok) {
        const responseText = await response.text();
        errorMessage = `HTTP ${statusCode}: ${responseText.substring(0, 500)}`;
        console.error(`Google Chat webhook delivery failed: ${errorMessage}`);
      } else {
        console.log(`Google Chat notification sent: ${eventType} for ${api.name}`);
      }

      const responseTime = Date.now() - startTime;

      await logDelivery(
        google_chat_webhook_url,
        `gchat_${eventType}`,
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
      errorMessage = error.name === 'AbortError'
        ? 'Request timeout after 30 seconds'
        : error.message;

      console.error(`Google Chat webhook error for ${eventType}:`, errorMessage);

      try {
        const settingsResult = await pool.query(
          'SELECT google_chat_webhook_url, admin_timezone FROM system_settings WHERE id = 1'
        );
        const gchatUrl = settingsResult.rows[0]?.google_chat_webhook_url || 'unknown';
        const tz = settingsResult.rows[0]?.admin_timezone || 'UTC';

        const payload = eventType === 'api_down'
          ? buildDowntimePayload(api, incident, tz)
          : buildRecoveryPayload(api, incident, currentStatusCode, tz);

        await logDelivery(
          gchatUrl,
          `gchat_${eventType}`,
          api.id,
          incident.id,
          payload,
          false,
          null,
          errorMessage,
          responseTime
        );
      } catch (logError) {
        console.error('Failed to log Google Chat webhook failure:', logError);
      }
    }
  });
}

/**
 * Send a test notification to Google Chat (synchronous — returns result)
 */
export async function testGoogleChatWebhook() {
  const startTime = Date.now();

  try {
    const settingsResult = await pool.query(
      'SELECT google_chat_webhook_url, google_chat_webhook_enabled, admin_timezone FROM system_settings WHERE id = 1'
    );

    if (!settingsResult.rows.length) {
      return { success: false, message: 'System settings not found' };
    }

    const { google_chat_webhook_url, admin_timezone } = settingsResult.rows[0];

    if (!google_chat_webhook_url || google_chat_webhook_url.trim() === '') {
      return { success: false, message: 'Google Chat webhook URL not configured' };
    }

    const payload = buildTestPayload(admin_timezone || 'UTC');

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 30000);

    const response = await fetch(google_chat_webhook_url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json; charset=UTF-8' },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });

    clearTimeout(timeoutId);

    const responseTime = Date.now() - startTime;

    if (response.ok) {
      return {
        success: true,
        message: `Test notification sent to Google Chat (${responseTime}ms)`,
        statusCode: response.status,
        responseTime,
      };
    } else {
      const responseText = await response.text();
      return {
        success: false,
        message: `Google Chat returned HTTP ${response.status}`,
        statusCode: response.status,
        error: responseText.substring(0, 500),
        responseTime,
      };
    }
  } catch (error) {
    const responseTime = Date.now() - startTime;
    return {
      success: false,
      message: 'Failed to send test notification to Google Chat',
      error: error.name === 'AbortError' ? 'Request timeout after 30 seconds' : error.message,
      responseTime,
    };
  }
}
