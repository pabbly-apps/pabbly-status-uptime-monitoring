import { query } from '../config/database.js';
import {
  silenceDeviceForIncident,
  getIncidentForResponder,
} from '../services/criticalAlertService.js';

// Get overall system status
export const getOverallStatus = async (req, res) => {
  try {
    // Get all active APIs with their latest ping status
    const apis = await query(`
      SELECT
        a.id,
        a.name,
        a.url,
        a.group_id,
        g.name as group_name,
        g.display_order as group_order,
        (
          SELECT status
          FROM ping_logs
          WHERE api_id = a.id
          ORDER BY pinged_at DESC
          LIMIT 1
        ) as last_status,
        (
          SELECT response_time
          FROM ping_logs
          WHERE api_id = a.id
          ORDER BY pinged_at DESC
          LIMIT 1
        ) as last_response_time,
        (
          SELECT pinged_at
          FROM ping_logs
          WHERE api_id = a.id
          ORDER BY pinged_at DESC
          LIMIT 1
        ) as last_checked
      FROM apis a
      LEFT JOIN api_groups g ON a.group_id = g.id
      WHERE a.is_active = true AND a.is_public = true
      ORDER BY g.display_order ASC, a.display_order ASC, a.id ASC
    `);

    // Get system settings for branding
    const settings = await query('SELECT id, page_title, logo_url, brand_color, custom_message, admin_timezone FROM system_settings WHERE id = 1');

    // Calculate overall system status
    let overallStatus = 'operational';
    let downCount = 0;

    apis.rows.forEach(api => {
      // Mark as 'pending' if no pings exist yet
      if (!api.last_status) {
        api.last_status = 'pending';
      }

      if (api.last_status === 'failure' || api.last_status === 'timeout') {
        downCount++;
      }
    });

    if (downCount > 0) {
      if (downCount === apis.rows.length) {
        overallStatus = 'major_outage';
      } else if (downCount >= apis.rows.length / 2) {
        overallStatus = 'partial_outage';
      } else {
        overallStatus = 'degraded';
      }
    }

    res.json({
      success: true,
      overall_status: overallStatus,
      total_services: apis.rows.length,
      services_down: downCount,
      services: apis.rows,
      settings: settings.rows[0] || {},
      last_updated: new Date().toISOString(),
    });
  } catch (error) {
    console.error('Get overall status error:', error);
    res.status(500).json({
      error: 'Server error',
      message: 'Failed to fetch status',
    });
  }
};

// Get list of all monitored services (public view only)
export const getServices = async (req, res) => {
  try {
    const result = await query(`
      SELECT
        a.id,
        a.name,
        a.url,
        a.group_id,
        g.name as group_name,
        g.display_order as group_order,
        (
          SELECT status
          FROM ping_logs
          WHERE api_id = a.id
          ORDER BY pinged_at DESC
          LIMIT 1
        ) as current_status,
        (
          SELECT response_time
          FROM ping_logs
          WHERE api_id = a.id
          ORDER BY pinged_at DESC
          LIMIT 1
        ) as response_time,
        (
          SELECT pinged_at
          FROM ping_logs
          WHERE api_id = a.id
          ORDER BY pinged_at DESC
          LIMIT 1
        ) as last_checked
      FROM apis a
      LEFT JOIN api_groups g ON a.group_id = g.id
      WHERE a.is_active = true AND a.is_public = true
      ORDER BY g.display_order ASC, a.display_order ASC, a.id ASC
    `);

    // Mark as 'pending' if no pings exist yet
    result.rows.forEach(service => {
      if (!service.current_status) {
        service.current_status = 'pending';
      }
    });

    res.json({
      success: true,
      count: result.rows.length,
      services: result.rows,
    });
  } catch (error) {
    console.error('Get services error:', error);
    res.status(500).json({
      error: 'Server error',
      message: 'Failed to fetch services',
    });
  }
};

// Get list of all monitored services including private ones (for authenticated admins)
export const getAllServicesForAdmin = async (req, res) => {
  try {
    const result = await query(`
      SELECT
        a.id,
        a.name,
        a.url,
        a.is_public,
        a.group_id,
        g.name as group_name,
        g.display_order as group_order,
        (
          SELECT status
          FROM ping_logs
          WHERE api_id = a.id
          ORDER BY pinged_at DESC
          LIMIT 1
        ) as current_status,
        (
          SELECT response_time
          FROM ping_logs
          WHERE api_id = a.id
          ORDER BY pinged_at DESC
          LIMIT 1
        ) as response_time,
        (
          SELECT pinged_at
          FROM ping_logs
          WHERE api_id = a.id
          ORDER BY pinged_at DESC
          LIMIT 1
        ) as last_checked
      FROM apis a
      LEFT JOIN api_groups g ON a.group_id = g.id
      WHERE a.is_active = true
      ORDER BY a.is_public DESC, g.display_order ASC, a.display_order ASC, a.id ASC
    `);

    // Mark as 'pending' if no pings exist yet
    result.rows.forEach(service => {
      if (!service.current_status) {
        service.current_status = 'pending';
      }
    });

    // Separate public and private services
    const publicServices = result.rows.filter(s => s.is_public);
    const privateServices = result.rows.filter(s => !s.is_public);

    res.json({
      success: true,
      count: result.rows.length,
      publicServices,
      privateServices,
      allServices: result.rows,
    });
  } catch (error) {
    console.error('Get all services for admin error:', error);
    res.status(500).json({
      error: 'Server error',
      message: 'Failed to fetch services',
    });
  }
};

// Get uptime statistics for all services
export const getUptimeStats = async (req, res) => {
  try {
    const result = await query(`
      SELECT
        a.id,
        a.name,
        us24.uptime_percentage as uptime_24h,
        us7.uptime_percentage as uptime_7d,
        us30.uptime_percentage as uptime_30d,
        us24.avg_response_time as avg_response_time_24h
      FROM apis a
      LEFT JOIN uptime_summaries us24 ON a.id = us24.api_id AND us24.period = '24h'
      LEFT JOIN uptime_summaries us7 ON a.id = us7.api_id AND us7.period = '7d'
      LEFT JOIN uptime_summaries us30 ON a.id = us30.api_id AND us30.period = '30d'
      WHERE a.is_active = true AND a.is_public = true
      ORDER BY a.name
    `);

    res.json({
      success: true,
      uptime_stats: result.rows,
    });
  } catch (error) {
    console.error('Get uptime stats error:', error);
    res.status(500).json({
      error: 'Server error',
      message: 'Failed to fetch uptime statistics',
    });
  }
};

// Get recent incidents (only for public APIs)
export const getRecentIncidents = async (req, res) => {
  try {
    const { limit = 10 } = req.query;

    const result = await query(
      `SELECT
        i.*,
        a.name as api_name
      FROM incidents i
      JOIN apis a ON i.api_id = a.id
      WHERE a.is_public = true
      ORDER BY i.started_at DESC
      LIMIT $1`,
      [limit]
    );

    res.json({
      success: true,
      count: result.rows.length,
      incidents: result.rows,
    });
  } catch (error) {
    console.error('Get recent incidents error:', error);
    res.status(500).json({
      error: 'Server error',
      message: 'Failed to fetch incidents',
    });
  }
};

// Get recent incidents for private APIs (requires authentication)
export const getPrivateIncidents = async (req, res) => {
  try {
    const { limit = 10 } = req.query;

    const result = await query(
      `SELECT
        i.*,
        a.name as api_name
      FROM incidents i
      JOIN apis a ON i.api_id = a.id
      WHERE a.is_public = false
      ORDER BY i.started_at DESC
      LIMIT $1`,
      [limit]
    );

    res.json({
      success: true,
      count: result.rows.length,
      incidents: result.rows,
    });
  } catch (error) {
    console.error('Get private incidents error:', error);
    res.status(500).json({
      error: 'Server error',
      message: 'Failed to fetch private incidents',
    });
  }
};

// Get 90-day timeline data
export const getTimeline = async (req, res) => {
  try {
    // Get daily uptime for last 90 days for all APIs
    const result = await query(`
      SELECT
        DATE(pinged_at) as date,
        api_id,
        COUNT(*) as total_pings,
        COUNT(*) FILTER (WHERE status = 'success') as successful_pings,
        ROUND(
          (COUNT(*) FILTER (WHERE status = 'success')::numeric / COUNT(*)::numeric) * 100,
          2
        ) as uptime_percentage
      FROM ping_logs
      WHERE pinged_at >= CURRENT_DATE - INTERVAL '90 days'
      GROUP BY DATE(pinged_at), api_id
      ORDER BY date DESC, api_id
    `);

    // Get API names
    const apis = await query(`
      SELECT id, name
      FROM apis
      WHERE is_active = true AND is_public = true
      ORDER BY name
    `);

    res.json({
      success: true,
      apis: apis.rows,
      timeline: result.rows,
    });
  } catch (error) {
    console.error('Get timeline error:', error);
    res.status(500).json({
      error: 'Server error',
      message: 'Failed to fetch timeline data',
    });
  }
};

// Get response time data for charts
export const getResponseTimes = async (req, res) => {
  try {
    const { apiId, period = '24h' } = req.query;

    let interval;
    switch (period) {
      case '24h':
        interval = '24 hours';
        break;
      case '7d':
        interval = '7 days';
        break;
      case '30d':
        interval = '30 days';
        break;
      default:
        interval = '24 hours';
    }

    let queryText = `
      SELECT
        DATE_TRUNC('hour', pinged_at) as hour,
        api_id,
        AVG(response_time) as avg_response_time,
        MIN(response_time) as min_response_time,
        MAX(response_time) as max_response_time,
        COUNT(*) FILTER (WHERE status = 'success') as success_count,
        COUNT(*) as total_count
      FROM ping_logs
      WHERE pinged_at >= NOW() - INTERVAL '${interval}'
    `;

    const values = [];
    if (apiId) {
      queryText += ' AND api_id = $1';
      values.push(apiId);
    }

    queryText += `
      GROUP BY hour, api_id
      ORDER BY hour ASC
    `;

    const result = await query(queryText, values);

    res.json({
      success: true,
      period,
      data: result.rows,
    });
  } catch (error) {
    console.error('Get response times error:', error);
    res.status(500).json({
      error: 'Server error',
      message: 'Failed to fetch response time data',
    });
  }
};

// Get ping logs for a specific API (public endpoint)
export const getPingLogs = async (req, res) => {
  try {
    const { apiId } = req.params;
    const limit = parseInt(req.query.limit) || 60; // Default to 1 hour (60 pings)

    const result = await query(
      `SELECT
        id,
        status,
        status_code,
        response_time,
        error_message,
        response_body,
        response_headers,
        pinged_at
      FROM ping_logs
      WHERE api_id = $1
      ORDER BY pinged_at DESC
      LIMIT $2`,
      [apiId, Math.min(limit, 1440)] // Max 24 hours
    );

    res.json({
      success: true,
      logs: result.rows,
    });
  } catch (error) {
    console.error('Get ping logs error:', error);
    res.status(500).json({
      error: 'Server error',
      message: 'Failed to fetch ping logs',
    });
  }
};

// Get aggregated ping logs for longer periods (7d, 90d)
export const getAggregatedPingLogs = async (req, res) => {
  try {
    const { apiId } = req.params;
    const { period, timezone } = req.query; // '7d' or '90d', and optional timezone

    // Determine aggregation interval and time range
    const config = {
      '7d': { interval: 'hour', days: 7 },
      '90d': { interval: 'day', days: 90 }
    };

    const periodConfig = config[period];
    if (!periodConfig) {
      return res.status(400).json({
        error: 'Invalid period',
        message: 'Period must be either 7d or 90d'
      });
    }

    const { interval, days } = periodConfig;

    // Use provided timezone or default to UTC
    let userTimezone = timezone || 'UTC';

    // Map old timezone names to new ones for PostgreSQL compatibility
    const timezoneAliases = {
      'Asia/Calcutta': 'Asia/Kolkata'
    };

    if (timezoneAliases[userTimezone]) {
      userTimezone = timezoneAliases[userTimezone];
    }

    // Query with timezone-aware time bucketing
    // Double AT TIME ZONE: first declares pinged_at as UTC, then converts to user's local tz
    // This ensures DATE_TRUNC aligns hour/day boundaries with the user's local clock
    const result = await query(
      `SELECT
        DATE_TRUNC($1, (pinged_at AT TIME ZONE 'UTC') AT TIME ZONE $3) as time_bucket,
        COUNT(*) as total_pings,
        COUNT(*) FILTER (WHERE status = 'success') as successful_pings,
        COUNT(*) FILTER (WHERE status IN ('failure', 'timeout')) as failed_pings,
        AVG(response_time) as avg_response_time,
        (DATE_TRUNC($1, (pinged_at AT TIME ZONE 'UTC') AT TIME ZONE $3)) AT TIME ZONE $3 as bucket_start,
        (DATE_TRUNC($1, (pinged_at AT TIME ZONE 'UTC') AT TIME ZONE $3) + INTERVAL '1 ${interval}') AT TIME ZONE $3 as bucket_end,
        ROUND(
          (COUNT(*) FILTER (WHERE status = 'success')::numeric / COUNT(*)::numeric) * 100,
          2
        ) as uptime_percentage
      FROM ping_logs
      WHERE api_id = $2
        AND pinged_at >= NOW() - INTERVAL '${days} days'
      GROUP BY DATE_TRUNC($1, (pinged_at AT TIME ZONE 'UTC') AT TIME ZONE $3)
      ORDER BY time_bucket ASC`,
      [interval, apiId, userTimezone]
    );

    res.json({
      success: true,
      period,
      aggregation: interval,
      buckets: result.rows
    });
  } catch (error) {
    console.error('Get aggregated ping logs error:', error);
    res.status(500).json({
      error: 'Server error',
      message: 'Failed to fetch aggregated ping logs'
    });
  }
};

// Get drill-down ping logs for a specific time period
export const getDrillDownPingLogs = async (req, res) => {
  try {
    const { apiId } = req.params;
    const { start, end } = req.query;

    if (!start || !end) {
      return res.status(400).json({
        error: 'Invalid parameters',
        message: 'Both start and end timestamps are required'
      });
    }

    const result = await query(
      `SELECT
        id,
        status,
        status_code,
        response_time,
        error_message,
        response_body,
        response_headers,
        pinged_at
      FROM ping_logs
      WHERE api_id = $1
        AND pinged_at >= ($2::timestamptz AT TIME ZONE 'UTC')
        AND pinged_at < ($3::timestamptz AT TIME ZONE 'UTC')
      ORDER BY pinged_at ASC`,
      [apiId, start, end]
    );

    res.json({
      success: true,
      logs: result.rows,
      period: { start, end }
    });
  } catch (error) {
    console.error('Get drill-down ping logs error:', error);
    res.status(500).json({
      error: 'Server error',
      message: 'Failed to fetch drill-down ping logs'
    });
  }
};

// ============================================
// CRITICAL ALARM RESPONDER ACTIONS
// ============================================

// Minimal HTML escape — the API name is admin-controlled, but this page is
// reachable without auth, so never interpolate raw values into markup.
const escapeHtml = (value) => String(value ?? '')
  .replace(/&/g, '&amp;')
  .replace(/</g, '&lt;')
  .replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;')
  .replace(/'/g, '&#39;');

const PAGE_STYLE = `
  :root { color-scheme: light dark; }
  body { margin:0; min-height:100vh; display:flex; align-items:center; justify-content:center;
         font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
         background:#f8fafc; color:#0f172a; padding:24px; }
  @media (prefers-color-scheme: dark) {
    body { background:#0f172a; color:#f1f5f9; }
    .card { background:#1e293b !important; }
    .ghost { background:transparent !important; color:#f1f5f9 !important; border-color:#475569 !important; }
  }
  .card { background:#fff; border-radius:16px; padding:36px 28px; max-width:440px; width:100%;
          text-align:center; box-shadow:0 10px 30px rgba(0,0,0,.08); }
  .icon { width:68px; height:68px; border-radius:50%; margin:0 auto 18px; display:flex;
          align-items:center; justify-content:center; font-size:34px; color:#fff; }
  h1 { font-size:21px; margin:0 0 10px; }
  p { margin:0 0 8px; font-size:15px; line-height:1.55; opacity:.75; }
  form { margin:0; }
  button { width:100%; padding:15px 18px; font-size:16px; font-weight:600; border-radius:12px;
           border:none; cursor:pointer; margin-top:12px; font-family:inherit; }
  .primary { background:#dc2626; color:#fff; }
  .ghost { background:#f1f5f9; color:#0f172a; border:1px solid #cbd5e1; }
  .hint { font-size:13px; opacity:.6; margin-top:8px; }
`;

const shell = (title, bodyHtml) => `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<title>${escapeHtml(title)}</title>
<style>${PAGE_STYLE}</style>
</head>
<body>
  <div class="card">${bodyHtml}</div>
</body>
</html>`;

const resultPage = (heading, detail, tone) => {
  const color = tone === 'error' ? '#dc2626' : tone === 'muted' ? '#64748b' : '#16a34a';
  const icon = tone === 'error' ? '&#10007;' : tone === 'muted' ? '&#128263;' : '&#10003;';
  return shell(heading, `
    <div class="icon" style="background:${color}">${icon}</div>
    <h1>${escapeHtml(heading)}</h1>
    <p>${escapeHtml(detail)}</p>
  `);
};

/**
 * The choice page a responder lands on when they tap the notification.
 *
 * Rendering it has NO side effects, deliberately. Silencing an alarm must never
 * happen on a GET: link previewers, security scanners and browser prefetch all
 * issue GETs, and any of them could otherwise silence a live 3am alarm before a
 * human ever saw it. Both actions below are POSTs.
 */
export const acknowledgeAlarmPage = async (req, res) => {
  const { incidentId } = req.params;
  const token = req.query.t;
  const device = req.query.d;

  res.set('Cache-Control', 'no-store');

  if (!/^\d+$/.test(String(incidentId))) {
    return res.status(400).type('html').send(
      resultPage('Invalid link', 'That acknowledgement link is malformed.', 'error')
    );
  }

  const info = await getIncidentForResponder(Number(incidentId), token);

  if (!info.ok) {
    const messages = {
      not_found: 'That incident no longer exists.',
      invalid_token: 'This link is invalid or has expired.',
      server_error: 'Something went wrong. The alarm may still be active — check the dashboard.',
    };
    return res.status(info.status || 400).type('html').send(
      resultPage('Cannot respond', messages[info.reason] || 'Unable to act on this alarm.', 'error')
    );
  }

  if (info.acknowledged) {
    return res.type('html').send(
      resultPage('Alarm already stopped', `The alarm for ${info.apiName} is no longer active.`, 'success')
    );
  }

  if (!info.alarmActive) {
    return res.type('html').send(
      resultPage('Alarm already stopped', `The alarm for ${info.apiName} is no longer active.`, 'success')
    );
  }

  // Without a device we cannot silence anything specific, and silencing
  // everyone is deliberately not on offer.
  if (!device) {
    return res.type('html').send(
      resultPage('Alarm active', `${info.apiName} is still down. This link is not tied to a device, so it cannot silence anything — check the dashboard.`, 'error')
    );
  }

  return res.type('html').send(shell(`${info.apiName} is down`, `
    <div class="icon" style="background:#dc2626">&#9888;</div>
    <h1>${escapeHtml(info.apiName)} is down</h1>
    <p>Still down. Silencing only affects this phone.</p>
    <form method="POST" action="/api/public/ack/${encodeURIComponent(incidentId)}/mute">
      <input type="hidden" name="t" value="${escapeHtml(token)}">
      <input type="hidden" name="d" value="${escapeHtml(device)}">
      <button type="submit" class="primary">Silence my phone</button>
    </form>
    <p class="hint">Everyone else keeps ringing. The alarm stops by itself when the service recovers.</p>
  `));
};

/**
 * "Silence my phone only" — mute this one device, leave everyone else ringing.
 */
export const muteAlarmForDevice = async (req, res) => {
  const { incidentId } = req.params;
  const token = req.body?.t || req.query.t;
  const device = req.body?.d || req.query.d;

  res.set('Cache-Control', 'no-store');

  if (!/^\d+$/.test(String(incidentId))) {
    return res.status(400).type('html').send(
      resultPage('Invalid link', 'That link is malformed.', 'error')
    );
  }

  const result = await silenceDeviceForIncident(Number(incidentId), token, device);

  if (!result.ok) {
    const messages = {
      not_found: 'That incident no longer exists.',
      invalid_token: 'This link is invalid or has expired.',
      unknown_device: 'This link is not tied to a registered device.',
      not_configured: 'Critical alarms are not configured.',
      server_error: 'Something went wrong. Check the dashboard.',
    };
    return res.status(result.status || 400).type('html').send(
      resultPage('Not silenced', messages[result.reason] || 'Unable to silence this alarm.', 'error')
    );
  }

  const detail = result.remaining > 0
    ? `Silenced on this phone. ${result.remaining} other device(s) are still being alerted about ${result.apiName}.`
    : `Silenced on this phone. Every device has now silenced this alarm and ${result.apiName} is still down — please check the dashboard.`;

  return res.type('html').send(
    resultPage('Silenced on this phone', detail, result.remaining > 0 ? 'muted' : 'error')
  );
};
