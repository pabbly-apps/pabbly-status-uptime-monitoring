import { query } from '../config/database.js';
import { sendDowntimeAlert, sendRecoveryNotification } from './emailService.js';
import { sendWebhook } from './webhookService.js';
import { sendGoogleChatNotification } from './googleChatService.js';

/**
 * Auto-create incident when API goes down
 * @param {object} api - API object with id, name, url, etc.
 * @param {number|null} statusCode - HTTP status code that caused the failure (null for timeouts/connection failures)
 */
export async function detectAndCreateIncident(api, statusCode = null) {
  try {
    // Check if there's already an open incident for this API
    const existingIncident = await query(
      `SELECT id FROM incidents
       WHERE api_id = $1
       AND status != 'resolved'
       ORDER BY started_at DESC
       LIMIT 1`,
      [api.id]
    );

    // If there's already an open incident, don't create a new one
    if (existingIncident.rows.length > 0) {
      console.log(`   ⚠️  Incident already exists for ${api.name}`);
      return;
    }

    // Build description with status code info
    let description = `Automated incident: ${api.name} (${api.url}) is not responding as expected.`;
    if (statusCode) {
      description = `Automated incident: ${api.name} (${api.url}) returned HTTP ${statusCode} (expected ${api.expected_status_code}).`;
    }

    // Create new incident with status_code
    const incident = await query(
      `INSERT INTO incidents (api_id, title, description, status, status_code, started_at)
       VALUES ($1, $2, $3, $4, $5, CURRENT_TIMESTAMP)
       RETURNING *`,
      [
        api.id,
        `${api.name} is down`,
        description,
        'ongoing',
        statusCode,
      ]
    );

    console.log(`   📋 Created incident #${incident.rows[0].id} for ${api.name}`);

    // Send email notification if enabled
    await sendDowntimeAlert(api, incident.rows[0]);

    // Send webhook notification for API down
    await sendWebhook('api_down', api, incident.rows[0]);

    // Send Google Chat notification for API down
    await sendGoogleChatNotification('api_down', api, incident.rows[0]);

    return incident.rows[0];
  } catch (error) {
    console.error('Error creating incident:', error);
  }
}

/**
 * Auto-resolve incident when API comes back up
 * @param {object} api - API object with id, name, url, etc.
 * @param {number|null} currentStatusCode - Current HTTP status code (the recovery status code, e.g., 200)
 */
export async function autoResolveIncident(api, currentStatusCode = null) {
  try {
    // Find the most recent open incident for this API
    const openIncident = await query(
      `SELECT * FROM incidents
       WHERE api_id = $1
       AND status != 'resolved'
       ORDER BY started_at DESC
       LIMIT 1`,
      [api.id]
    );

    if (openIncident.rows.length === 0) {
      // No open incident to resolve
      return;
    }

    const incident = openIncident.rows[0];

    // Calculate downtime duration for logging
    const startedAt = new Date(incident.started_at);
    const resolvedAt = new Date();
    const durationMinutes = Math.round((resolvedAt - startedAt) / 1000 / 60);

    // Resolve the incident
    await query(
      `UPDATE incidents
       SET status = 'resolved',
           resolved_at = CURRENT_TIMESTAMP,
           description = $1,
           updated_at = CURRENT_TIMESTAMP
       WHERE id = $2`,
      [
        `${incident.description} Resolved automatically.`,
        incident.id,
      ]
    );

    console.log(`   ✅ Resolved incident #${incident.id} for ${api.name} (${durationMinutes}m downtime)`);

    // Fetch the updated incident with resolved_at timestamp
    const updatedIncident = await query(
      `SELECT * FROM incidents WHERE id = $1`,
      [incident.id]
    );

    // Send email recovery notification if enabled (pass current status code for recovery)
    await sendRecoveryNotification(api, updatedIncident.rows[0], durationMinutes, currentStatusCode);

    // Send webhook notification for API up (pass current status code for recovery)
    await sendWebhook('api_up', api, updatedIncident.rows[0], currentStatusCode);

    // Send Google Chat notification for API up
    await sendGoogleChatNotification('api_up', api, updatedIncident.rows[0], currentStatusCode);

    return incident;
  } catch (error) {
    console.error('Error resolving incident:', error);
  }
}

/**
 * Get current active incidents
 */
export async function getActiveIncidents() {
  try {
    const result = await query(
      `SELECT i.*, a.name as api_name, a.url as api_url
       FROM incidents i
       JOIN apis a ON i.api_id = a.id
       WHERE i.status != 'resolved'
       ORDER BY i.started_at DESC`
    );

    return result.rows;
  } catch (error) {
    console.error('Error fetching active incidents:', error);
    return [];
  }
}

/**
 * Get incident statistics
 */
export async function getIncidentStats(apiId = null, days = 30) {
  try {
    let queryText = `
      SELECT
        COUNT(*) as total_incidents,
        COUNT(*) FILTER (WHERE status = 'resolved') as resolved_incidents,
        AVG(
          EXTRACT(EPOCH FROM (resolved_at - started_at)) / 60
        ) as avg_downtime_minutes
      FROM incidents
      WHERE started_at >= CURRENT_DATE - INTERVAL '${days} days'
    `;

    const values = [];
    if (apiId) {
      queryText += ' AND api_id = $1';
      values.push(apiId);
    }

    const result = await query(queryText, values);
    return result.rows[0];
  } catch (error) {
    console.error('Error fetching incident stats:', error);
    return null;
  }
}

export default {
  detectAndCreateIncident,
  autoResolveIncident,
  getActiveIncidents,
  getIncidentStats,
};
