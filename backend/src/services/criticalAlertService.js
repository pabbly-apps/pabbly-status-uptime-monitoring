import crypto from 'crypto';
import pool, { query } from '../config/database.js';
import { decrypt } from '../utils/encryption.js';
import { formatWithTimezone } from '../utils/timezone.js';

/**
 * Critical Phone Alarm Service
 *
 * Pushes a loud, DND-piercing alarm to on-call phones when an API marked
 * `is_critical` goes down, and repeats it until every subscribed phone has
 * silenced it, the service recovers, or the configured window elapses.
 *
 * Delivery runs through a self-hosted Home Assistant instance used purely as a
 * push gateway. HA is the only free, self-hostable option whose mobile app
 * holds Apple's Critical Alerts entitlement, which is what lets an iPhone ring
 * at full volume through the silent switch and Focus/Do Not Disturb.
 *
 * Neither platform can loop a sound indefinitely from a push notification
 * (iOS caps notification sound at ~30s, played once), so "continuous until
 * silenced" is achieved by re-sending on a fixed interval. Every repeat
 * carries the same tag, so it replaces the previous notification rather than
 * stacking a pile of them.
 *
 * Alarm state lives in Postgres, not memory, so a pm2 restart cannot silently
 * kill a live alarm — the exact failure this feature exists to prevent. The
 * repeater polls for due rows, so it self-heals across restarts with no
 * rehydration step.
 */

// How often the repeater looks for due alarms. Finer than the repeat interval
// so a 30s cadence stays roughly accurate.
const TICK_INTERVAL_MS = 5000;

// Per-request timeout when talking to Home Assistant.
const HA_TIMEOUT_MS = 10000;

let repeaterHandle = null;

/**
 * Parse a device list.
 *
 * Each entry is a Home Assistant notify target, optionally followed by a
 * friendly label: "mobile_app_ravi:Ravi (iPhone)". HA service names can't
 * contain a colon, so it is a safe separator. A bare entry labels itself, which
 * keeps older configurations working untouched.
 */
export function parseTargetSpec(raw) {
  return (raw || '')
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean)
    .map((entry) => {
      const idx = entry.indexOf(':');
      if (idx === -1) return { target: entry, label: entry };
      const target = entry.slice(0, idx).trim();
      const label = entry.slice(idx + 1).trim();
      return { target, label: label || target };
    })
    .filter((d) => d.target);
}

/**
 * Load and validate the Home Assistant gateway config.
 * Returns null when critical alerts are disabled or not configured, which
 * makes every public entry point in this module a no-op.
 */
async function getConfig() {
  const result = await query(
    `SELECT ha_base_url, ha_token, ha_notify_targets, critical_alert_enabled,
            critical_alert_repeat_seconds, critical_alert_max_minutes, admin_timezone
     FROM system_settings WHERE id = 1`
  );

  if (!result.rows.length) return null;

  const row = result.rows[0];
  if (!row.critical_alert_enabled) return null;
  if (!row.ha_base_url || !row.ha_base_url.trim()) return null;

  const token = decrypt(row.ha_token);
  if (!token || !token.trim()) return null;

  const devices = parseTargetSpec(row.ha_notify_targets);
  const targets = devices.map((d) => d.target);

  if (!targets.length) return null;

  return {
    baseUrl: row.ha_base_url.trim().replace(/\/+$/, ''),
    token: token.trim(),
    targets,
    labelFor: (t) => devices.find((d) => d.target === t)?.label || t,
    repeatSeconds: row.critical_alert_repeat_seconds || 30,
    maxMinutes: row.critical_alert_max_minutes || 15,
    timezone: row.admin_timezone || 'UTC',
  };
}

/**
 * Work out which phones a given API should ring.
 *
 * An API's own alert_targets wins; NULL/empty falls back to the global list,
 * which is what every API did before per-API routing existed.
 *
 * The result is always intersected with the currently-configured devices, so a
 * phone removed from the global list stops ringing everywhere without having to
 * edit every API.
 *
 * Deliberately NO fallback to "everyone": these phones belong to different
 * project teams, and waking the wrong team at 3am is its own incident. If the
 * routing resolves to nobody this returns an empty list, and the caller refuses
 * to arm the alarm and logs an error. Google Chat and email still fire, so the
 * outage is never invisible — and updateSettings warns before an admin can
 * strand an API this way.
 */
function resolveTargets(cfg, apiAlertTargets) {
  const raw = parseTargetSpec(apiAlertTargets).map((d) => d.target);
  if (!raw.length) return cfg.targets;
  return raw.filter((t) => cfg.targets.includes(t));
}

/**
 * Build the URL a responder lands on when they tap the notification.
 *
 * Deliberately under /api/ — nginx only proxies /api/ and /health to this
 * backend, so a bare /ack/... path would be swallowed by the static frontend
 * and the request would never arrive.
 */
function buildAckUrl(incidentId, token, device) {
  const base = (process.env.FRONTEND_URL || 'http://localhost:5000').replace(/\/+$/, '');
  const suffix = device ? `&d=${encodeURIComponent(device)}` : '';
  return `${base}/api/public/ack/${incidentId}?t=${token}${suffix}`;
}

/**
 * Build the alarm payload.
 *
 * One payload covers both platforms — Home Assistant ignores the keys that
 * don't apply to the receiving device.
 */
function buildAlarmPayload(api, incident, ackUrl, attempt, timezone) {
  const statusCodeText = incident.status_code ? `HTTP ${incident.status_code}` : 'no response';
  const detectedAt = incident.started_at
    ? formatWithTimezone(new Date(incident.started_at), timezone)
    : '';

  const repeatSuffix = attempt > 1 ? ` (alert ${attempt})` : '';

  return {
    title: `🚨 ${api.name} is DOWN`,
    message: `${api.name} returned ${statusCodeText}. Detected ${detectedAt}. Tap to silence on this phone.${repeatSuffix}`,
    data: {
      // --- iPhone: Critical Alert ---
      // Plays at full volume through the silent switch and Focus/DND.
      // Requires the recipient to have granted Critical Alerts permission.
      push: {
        sound: { name: 'default', critical: 1, volume: 1.0 },
      },

      // --- Android: alarm stream at max volume ---
      // Rings even when the phone is on silent/vibrate.
      channel: 'alarm_stream_max',
      importance: 'high',
      priority: 'high',
      ttl: 0,

      // Same tag on every repeat => replaces, never stacks.
      tag: `incident-${incident.id}`,

      // Tapping opens a page that silences this phone only. Everyone else
      // keeps ringing until they silence their own, the service recovers,
      // or the max-duration window closes.
      url: ackUrl, // iOS
      clickAction: ackUrl, // Android
    },
  };
}

/**
 * Build the payload that wipes an alarm off every device.
 */
function buildClearPayload(incidentId) {
  return {
    message: 'clear_notification',
    data: { tag: `incident-${incidentId}` },
  };
}

/**
 * Build a low-key recovery notification — deliberately NOT a critical alert,
 * since good news should not wake anyone a second time.
 */
function buildRecoveryPayload(api, incident, timezone) {
  const resolvedAt = incident.resolved_at
    ? formatWithTimezone(new Date(incident.resolved_at), timezone)
    : '';

  return {
    title: `✅ ${api.name} recovered`,
    message: `${api.name} is responding normally again as of ${resolvedAt}.`,
    data: {
      tag: `incident-${incident.id}-recovered`,
    },
  };
}

function buildTestPayload(dismissUrl, timezone) {
  return {
    title: '🔔 Test Alarm — Pabbly Status Monitor',
    message: `This is what a critical alert sounds like. Sent ${formatWithTimezone(new Date(), timezone)}. Tap to dismiss.`,
    data: {
      push: { sound: { name: 'default', critical: 1, volume: 1.0 } },
      channel: 'alarm_stream_max',
      importance: 'high',
      priority: 'high',
      ttl: 0,
      tag: 'critical-alert-test',
      url: dismissUrl,
      clickAction: dismissUrl,
    },
  };
}

/**
 * Log a delivery attempt to the shared webhook_logs ledger, matching the
 * convention already used by webhookService and googleChatService.
 */
async function logDelivery(url, eventType, apiId, incidentId, payload, success, statusCode, errorMessage, responseTime) {
  try {
    await pool.query(
      `INSERT INTO webhook_logs
       (webhook_url, event_type, api_id, incident_id, payload, success, status_code, error_message, response_time)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
      [url, eventType, apiId, incidentId, payload, success, statusCode, errorMessage, responseTime]
    );
  } catch (error) {
    console.error('Failed to log critical alert delivery:', error);
  }
}

/**
 * POST one payload to one Home Assistant notify target.
 * Never throws — returns a result object instead.
 */
async function postToHomeAssistant(cfg, target, payload) {
  const startTime = Date.now();
  const url = `${cfg.baseUrl}/api/services/notify/${target}`;

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), HA_TIMEOUT_MS);

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${cfg.token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });

    clearTimeout(timeoutId);

    const responseTime = Date.now() - startTime;

    if (!response.ok) {
      const text = await response.text();
      return {
        url,
        success: false,
        statusCode: response.status,
        errorMessage: `HTTP ${response.status}: ${text.substring(0, 500)}`,
        responseTime,
      };
    }

    return { url, success: true, statusCode: response.status, errorMessage: null, responseTime };
  } catch (error) {
    clearTimeout(timeoutId);
    return {
      url,
      success: false,
      statusCode: null,
      errorMessage: error.name === 'AbortError'
        ? `Request timeout after ${HA_TIMEOUT_MS / 1000} seconds`
        : error.message,
      responseTime: Date.now() - startTime,
    };
  }
}

/**
 * Fan a payload out to devices, logging each attempt.
 *
 * @param payloadFor - either a payload object (same for every device) or a
 *   function (target) => payload. Alarms use the function form so each phone
 *   receives a link scoped to itself, which is what makes "silence my phone
 *   only" possible.
 * @param targets - defaults to every configured device; the repeater passes a
 *   filtered list so muted phones are skipped.
 * Returns true if at least one device accepted it.
 */
async function pushToAllTargets(cfg, payloadFor, eventType, apiId, incidentId, targets = null) {
  const list = targets || cfg.targets;
  const build = typeof payloadFor === 'function' ? payloadFor : () => payloadFor;

  const results = await Promise.all(
    list.map(async (target) => {
      const payload = build(target);
      const r = await postToHomeAssistant(cfg, target, payload);
      return { ...r, payload };
    })
  );

  for (const r of results) {
    await logDelivery(
      r.url, eventType, apiId, incidentId, r.payload,
      r.success, r.statusCode, r.errorMessage, r.responseTime
    );
    if (!r.success) {
      console.error(`Critical alert delivery failed (${r.url}): ${r.errorMessage}`);
    }
  }

  return results.some((r) => r.success);
}

/**
 * Arm and fire the first alarm for a newly-created incident.
 * Fire-and-forget: never blocks or breaks incident creation.
 */
export async function startCriticalAlert(api, incident) {
  setImmediate(async () => {
    try {
      if (!api.is_critical) return;

      const cfg = await getConfig();
      if (!cfg) return;

      const targets = resolveTargets(cfg, api.alert_targets);

      // Routed only to devices that no longer exist. Ring nobody rather than
      // wake an unrelated project's team. Checked before arming so a stranded
      // alarm is never left armed. Google Chat and email still fired, so the
      // outage is not invisible.
      if (!targets.length) {
        console.error(
          `Critical alarm NOT sent for "${api.name}" (incident #${incident.id}): ` +
          `its routed devices (${api.alert_targets}) are no longer configured. ` +
          `Fix the routing under Settings -> Phone Alarm.`
        );
        await query(
          `UPDATE incidents
           SET alarm_next_send_at = NULL,
               alarm_stopped_reason = 'no_targets',
               updated_at = CURRENT_TIMESTAMP
           WHERE id = $1`,
          [incident.id]
        );
        return;
      }

      const token = crypto.randomBytes(32).toString('hex');

      await query(
        `UPDATE incidents
         SET ack_token = $1,
             alarm_attempts = 1,
             alarm_stopped_reason = NULL,
             acknowledged_at = NULL,
             acknowledged_by = NULL,
             alerted_devices = $2::jsonb,
             alarm_next_send_at = CURRENT_TIMESTAMP + ($3 * INTERVAL '1 second'),
             updated_at = CURRENT_TIMESTAMP
         WHERE id = $4`,
        [token, JSON.stringify(targets), cfg.repeatSeconds, incident.id]
      );

      // Each phone gets a link scoped to itself, so the landing page knows
      // which device is responding.
      await pushToAllTargets(
        cfg,
        (target) => buildAlarmPayload(api, incident, buildAckUrl(incident.id, token, target), 1, cfg.timezone),
        'critical_api_down',
        api.id,
        incident.id,
        targets
      );

      console.log(`   📢 Critical alarm armed for ${api.name} (incident #${incident.id}) -> ${targets.join(', ')}`);
    } catch (error) {
      console.error('Failed to start critical alert:', error.message);
    }
  });
}

/**
 * Disarm an alarm and wipe the notification from every device.
 *
 * @param {number} incidentId
 * @param {string} reason - acknowledged | resolved | expired | disabled
 * @param {string|null} acknowledgedBy - how it was acknowledged, if it was
 */
export async function stopCriticalAlert(incidentId, reason, acknowledgedBy = null) {
  try {
    const existing = await query(
      'SELECT id, api_id, alarm_next_send_at, alerted_devices FROM incidents WHERE id = $1',
      [incidentId]
    );

    if (!existing.rows.length) return;

    // Nothing armed — no alarm to stop, no notification to clear.
    if (!existing.rows[0].alarm_next_send_at) return;

    await query(
      `UPDATE incidents
       SET alarm_next_send_at = NULL,
           alarm_stopped_reason = $1,
           acknowledged_at = COALESCE(
             acknowledged_at,
             CASE WHEN $2::text IS NULL THEN NULL ELSE CURRENT_TIMESTAMP END
           ),
           acknowledged_by = COALESCE(acknowledged_by, $2),
           updated_at = CURRENT_TIMESTAMP
       WHERE id = $3`,
      [reason, acknowledgedBy, incidentId]
    );

    const cfg = await getConfig();
    if (!cfg) return;

    // Clear only the phones this alarm actually reached. Sweeping every
    // configured device would push into other project teams' phones — silent,
    // but exactly the cross-team noise per-API routing exists to prevent.
    const alerted = Array.isArray(existing.rows[0].alerted_devices)
      ? existing.rows[0].alerted_devices
      : [];
    if (!alerted.length) return;

    await pushToAllTargets(
      cfg,
      buildClearPayload(incidentId),
      'critical_alarm_clear',
      existing.rows[0].api_id,
      incidentId,
      alerted
    );

    console.log(`   🔕 Critical alarm stopped for incident #${incidentId} (${reason})`);
  } catch (error) {
    console.error('Failed to stop critical alert:', error.message);
  }
}

/**
 * Stop the alarm because the service recovered, then send a quiet all-clear.
 * Fire-and-forget.
 */
export async function resolveCriticalAlert(api, incident) {
  setImmediate(async () => {
    try {
      if (!api.is_critical) return;

      await stopCriticalAlert(incident.id, 'resolved', 'auto-resolved');

      const cfg = await getConfig();
      if (!cfg) return;

      const recoveryTargets = resolveTargets(cfg, api.alert_targets);
      if (!recoveryTargets.length) return;

      // The all-clear goes only to the phones this API actually woke.
      // (Clearing the alarm above deliberately targets every device, so a
      // stale critical notification can never linger if routing changed
      // mid-incident.)
      await pushToAllTargets(
        cfg,
        buildRecoveryPayload(api, incident, cfg.timezone),
        'critical_api_up',
        api.id,
        incident.id,
        recoveryTargets
      );
    } catch (error) {
      console.error('Failed to send critical recovery alert:', error.message);
    }
  });
}

/**
 * Load an incident and verify the caller holds its token.
 * Shared by every responder action; never throws.
 */
async function verifyIncidentToken(incidentId, providedToken) {
  const result = await query(
    `SELECT i.id, i.ack_token, i.acknowledged_at, i.alarm_next_send_at,
            i.silenced_devices, a.name AS api_name, a.alert_targets
     FROM incidents i
     JOIN apis a ON i.api_id = a.id
     WHERE i.id = $1`,
    [incidentId]
  );

  if (!result.rows.length) {
    return { ok: false, status: 404, reason: 'not_found' };
  }

  const incident = result.rows[0];

  if (!incident.ack_token) {
    return { ok: false, status: 403, reason: 'invalid_token' };
  }

  // Constant-time compare so the token can't be discovered by timing.
  const expected = Buffer.from(incident.ack_token);
  const actual = Buffer.from(String(providedToken || ''));
  if (expected.length !== actual.length || !crypto.timingSafeEqual(expected, actual)) {
    return { ok: false, status: 403, reason: 'invalid_token' };
  }

  return { ok: true, incident };
}

/**
 * Read-only lookup for the responder landing page, so simply opening the link
 * has no side effects. Anything that can silence an alarm must be a POST.
 */
export async function getIncidentForResponder(incidentId, providedToken) {
  try {
    const check = await verifyIncidentToken(incidentId, providedToken);
    if (!check.ok) return check;

    const { incident } = check;
    const silenced = Array.isArray(incident.silenced_devices) ? incident.silenced_devices : [];

    return {
      ok: true,
      apiName: incident.api_name,
      acknowledged: incident.acknowledged_at !== null,
      alarmActive: incident.alarm_next_send_at !== null,
      silencedDevices: silenced,
    };
  } catch (error) {
    console.error('Failed to load incident for responder:', error.message);
    return { ok: false, status: 500, reason: 'server_error' };
  }
}

/**
 * Silence the alarm on ONE device without stopping it anywhere else.
 *
 * The incident stays unacknowledged and unclaimed on purpose: muting your own
 * phone must never mute the person who will actually fix the problem.
 */
export async function silenceDeviceForIncident(incidentId, providedToken, device) {
  try {
    const check = await verifyIncidentToken(incidentId, providedToken);
    if (!check.ok) return check;

    const { incident } = check;

    const cfg = await getConfig();
    if (!cfg) return { ok: false, status: 503, reason: 'not_configured' };

    // Only ever store a device that is actually configured, so the column can't
    // be filled with arbitrary caller-supplied strings.
    if (!device || !cfg.targets.includes(device)) {
      return { ok: false, status: 400, reason: 'unknown_device' };
    }

    const silenced = Array.isArray(incident.silenced_devices) ? incident.silenced_devices : [];
    const routed = resolveTargets(cfg, incident.alert_targets);
    const remaining = routed.filter((t) => !silenced.includes(t) && t !== device).length;

    if (!silenced.includes(device)) {
      await query(
        `UPDATE incidents
         SET silenced_devices = COALESCE(silenced_devices, '[]'::jsonb) || $1::jsonb,
             updated_at = CURRENT_TIMESTAMP
         WHERE id = $2`,
        [JSON.stringify([device]), incidentId]
      );
    }

    // Clear the notification on this device only.
    await pushToAllTargets(
      cfg,
      buildClearPayload(incidentId),
      'critical_alarm_mute',
      null,
      incidentId,
      [device]
    );

    console.log(`   🔇 Incident #${incidentId} silenced on ${device} (${remaining} device(s) still ringing)`);

    return {
      ok: true,
      apiName: incident.api_name,
      device,
      remaining,
      acknowledged: incident.acknowledged_at !== null,
    };
  } catch (error) {
    console.error('Failed to silence device:', error.message);
    return { ok: false, status: 500, reason: 'server_error' };
  }
}

/**
 * One pass of the repeater: re-send every alarm that has come due.
 */
async function runAlarmTick() {
  const cfg = await getConfig();
  if (!cfg) return;

  const due = await query(
    // Elapsed time is computed in SQL on purpose. started_at is TIMESTAMP
    // WITHOUT TIME ZONE holding UTC, and node-pg parses those as local time —
    // so doing this arithmetic in JS silently skews by the server's UTC offset
    // and would expire every alarm instantly on a non-UTC host.
    `SELECT i.id, i.api_id, i.status_code, i.started_at, i.ack_token,
            i.alarm_attempts, i.acknowledged_at, i.silenced_devices, i.alerted_devices,
            EXTRACT(EPOCH FROM (CURRENT_TIMESTAMP - i.started_at)) AS elapsed_seconds,
            a.name AS api_name, a.is_critical, a.alert_targets
     FROM incidents i
     JOIN apis a ON i.api_id = a.id
     WHERE i.alarm_next_send_at IS NOT NULL
       AND i.alarm_next_send_at <= CURRENT_TIMESTAMP
       AND i.acknowledged_at IS NULL
       AND i.status != 'resolved'
     ORDER BY i.alarm_next_send_at ASC
     LIMIT 20`
  );

  for (const row of due.rows) {
    // The API may have been un-marked as critical mid-incident.
    if (!row.is_critical) {
      await stopCriticalAlert(row.id, 'disabled');
      continue;
    }

    // Give up once the configured window has elapsed. Ringing forever at 3am
    // when nobody is reachable is its own kind of failure.
    const elapsedSeconds = Number(row.elapsed_seconds) || 0;
    if (elapsedSeconds > cfg.maxMinutes * 60) {
      console.warn(`   ⏰ Critical alarm for incident #${row.id} expired unacknowledged after ${cfg.maxMinutes}m`);
      await stopCriticalAlert(row.id, 'expired', 'expired');
      continue;
    }

    // Only the phones this API is routed to, minus anyone who already
    // silenced their own.
    const silenced = Array.isArray(row.silenced_devices) ? row.silenced_devices : [];
    const routed = resolveTargets(cfg, row.alert_targets);

    if (!routed.length) {
      console.error(
        `Critical alarm for incident #${row.id} ("${row.api_name}") has no configured ` +
        `devices left; standing down rather than alerting an unrelated team.`
      );
      await stopCriticalAlert(row.id, 'no_targets');
      continue;
    }

    const activeTargets = routed.filter((t) => !silenced.includes(t));

    // Every subscribed device muted, but nobody claimed the incident. There is
    // no one left to ring, so stand the alarm down — recorded distinctly from a
    // real acknowledgement so it is visible that nobody took ownership.
    if (!activeTargets.length) {
      console.warn(`   🔇 Critical alarm for incident #${row.id} silenced on every device without being claimed`);
      await stopCriticalAlert(row.id, 'all_silenced');
      continue;
    }

    const attempt = (row.alarm_attempts || 0) + 1;
    const api = { id: row.api_id, name: row.api_name };
    const incident = {
      id: row.id,
      status_code: row.status_code,
      started_at: row.started_at,
    };

    // Reschedule before sending so a slow or failing HA can't cause a tight loop.
    await query(
      `UPDATE incidents
       SET alarm_attempts = $1,
           alarm_next_send_at = CURRENT_TIMESTAMP + ($2 * INTERVAL '1 second'),
           updated_at = CURRENT_TIMESTAMP
       WHERE id = $3`,
      [attempt, cfg.repeatSeconds, row.id]
    );

    // Remember anyone newly routed in, so cleanup still reaches them later.
    const known = Array.isArray(row.alerted_devices) ? row.alerted_devices : [];
    const newlyAlerted = activeTargets.filter((t) => !known.includes(t));
    if (newlyAlerted.length) {
      await query(
        `UPDATE incidents SET alerted_devices = COALESCE(alerted_devices, '[]'::jsonb) || $1::jsonb WHERE id = $2`,
        [JSON.stringify(newlyAlerted), row.id]
      );
    }

    await pushToAllTargets(
      cfg,
      (target) => buildAlarmPayload(api, incident, buildAckUrl(row.id, row.ack_token, target), attempt, cfg.timezone),
      'critical_api_down',
      row.api_id,
      row.id,
      activeTargets
    );
  }
}

/**
 * Start the repeat loop. Errors are contained per-tick so a transient DB or
 * network fault can never take the process down.
 */
export function startCriticalAlertRepeater() {
  if (repeaterHandle) return;

  repeaterHandle = setInterval(() => {
    runAlarmTick().catch((error) => {
      console.error('Critical alarm repeater tick failed:', error.message);
    });
  }, TICK_INTERVAL_MS);

  // Don't hold the event loop open on shutdown.
  if (typeof repeaterHandle.unref === 'function') repeaterHandle.unref();

  console.log(`📢 Critical alarm repeater started (tick every ${TICK_INTERVAL_MS / 1000}s)`);
}

export function stopCriticalAlertRepeater() {
  if (repeaterHandle) {
    clearInterval(repeaterHandle);
    repeaterHandle = null;
  }
}

/**
 * Send a test alarm (synchronous — returns a result for the admin UI).
 */
export async function testCriticalAlert() {
  const startTime = Date.now();

  try {
    const settings = await query(
      `SELECT ha_base_url, ha_token, ha_notify_targets, admin_timezone
       FROM system_settings WHERE id = 1`
    );

    if (!settings.rows.length) {
      return { success: false, message: 'System settings not found' };
    }

    const row = settings.rows[0];

    if (!row.ha_base_url || !row.ha_base_url.trim()) {
      return { success: false, message: 'Home Assistant URL is not configured' };
    }

    const token = decrypt(row.ha_token);
    if (!token || !token.trim()) {
      return {
        success: false,
        message: row.ha_token
          ? 'Stored Home Assistant token could not be decrypted (ENCRYPTION_KEY may have changed). Re-enter the token.'
          : 'Home Assistant access token is not configured',
      };
    }

    const targets = (row.ha_notify_targets || '')
      .split(',')
      .map((t) => t.trim())
      .filter(Boolean);

    if (!targets.length) {
      return { success: false, message: 'No notification targets configured (e.g. mobile_app_your_phone)' };
    }

    const cfg = {
      baseUrl: row.ha_base_url.trim().replace(/\/+$/, ''),
      token: token.trim(),
      targets,
      timezone: row.admin_timezone || 'UTC',
    };

    // Test alarms are self-dismissing — there's no incident to acknowledge.
    const dismissUrl = (process.env.FRONTEND_URL || 'http://localhost:5173').replace(/\/+$/, '');
    const payload = buildTestPayload(dismissUrl, cfg.timezone);

    const results = await Promise.all(
      cfg.targets.map((target) => postToHomeAssistant(cfg, target, payload))
    );

    const responseTime = Date.now() - startTime;
    const failed = results.filter((r) => !r.success);

    if (!failed.length) {
      return {
        success: true,
        message: `Test alarm sent to ${results.length} device target(s) in ${responseTime}ms`,
        responseTime,
      };
    }

    if (failed.length === results.length) {
      return {
        success: false,
        message: `Home Assistant rejected the test alarm: ${failed[0].errorMessage}`,
        statusCode: failed[0].statusCode,
        responseTime,
      };
    }

    return {
      success: true,
      message: `Test alarm sent, but ${failed.length} of ${results.length} target(s) failed: ${failed[0].errorMessage}`,
      responseTime,
    };
  } catch (error) {
    return {
      success: false,
      message: 'Failed to send test alarm',
      error: error.message,
      responseTime: Date.now() - startTime,
    };
  }
}

export default {
  startCriticalAlert,
  stopCriticalAlert,
  resolveCriticalAlert,
  silenceDeviceForIncident,
  getIncidentForResponder,
  startCriticalAlertRepeater,
  stopCriticalAlertRepeater,
  testCriticalAlert,
};
