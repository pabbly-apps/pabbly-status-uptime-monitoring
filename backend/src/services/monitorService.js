import cron from 'node-cron';
import { Agent } from 'undici';
import { query } from '../config/database.js';
import { detectAndCreateIncident, autoResolveIncident } from './incidentService.js';

// Require N consecutive failures before marking an API as down
const FAILURE_THRESHOLD = 2;

/**
 * Create a fresh HTTP agent for each monitoring cycle
 * This prevents stale connection issues with Cloudflare (520/525 errors)
 * and eliminates intermittent "fetch failed" errors from connection reuse
 */
function createMonitoringAgent() {
  return new Agent({
    // Minimal connection pooling
    connections: 1,
    pipelining: 0,

    // Reasonable keep-alive (not too aggressive)
    keepAliveTimeout: 1000,      // 1 second
    keepAliveMaxTimeout: 5000,   // 5 seconds max lifetime

    // Disable undici's built-in timeouts — let the per-API AbortController
    // (which uses each API's timeout_duration from the dashboard) control all timeouts
    connect: { timeout: 120000 },
    headersTimeout: 120000,
    bodyTimeout: 120000,
  });
}

// Track last status for each API to detect status changes
const apiLastStatus = new Map();

// Overlap guard: ids of APIs whose check is currently in flight. If a new cron
// cycle fires while a previous (slow) check for the SAME api is still running,
// we skip re-pinging that api to avoid duplicate pings / duplicate ping_logs.
const inFlightApiIds = new Set();

/**
 * Truncate response body to prevent database bloat
 */
function truncateBody(body, maxLength = 50000) {
  if (!body) return null;

  let bodyStr;
  if (typeof body === 'object') {
    bodyStr = JSON.stringify(body, null, 2);
  } else {
    bodyStr = String(body);
  }

  if (bodyStr.length > maxLength) {
    return bodyStr.substring(0, maxLength) + '\n\n... [Response truncated - exceeded 50KB limit]';
  }

  return bodyStr;
}

// Max retries for connection-level failures (DNS, TCP, TLS timeouts)
const CONNECTION_RETRY_COUNT = 1;
const CONNECTION_RETRY_DELAY_MS = 1000;

/**
 * Perform a single fetch attempt against an API endpoint
 * @param {object} api - API object with url, timeout_duration, expected_status_code
 * @param {Agent} agent - Undici Agent instance for this monitoring cycle
 * @returns {{ result: object, isConnectionError: boolean }}
 */
async function attemptPing(api, agent) {
  const startTime = Date.now();

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), api.timeout_duration);

    const response = await fetch(api.url, {
      method: 'GET',
      headers: {
        'User-Agent': 'StatusMonitor/1.0',
        'Accept': '*/*',
      },
      signal: controller.signal,
      dispatcher: agent,
    });

    clearTimeout(timeout);

    const responseTime = Date.now() - startTime;
    const isSuccess = response.status === api.expected_status_code;

    // Capture response body and headers on failure
    let responseBody = null;
    let responseHeaders = null;

    if (!isSuccess) {
      try {
        const bodyText = await response.text();
        responseBody = truncateBody(bodyText);
      } catch (bodyError) {
        console.error('Error reading response body:', bodyError);
        responseBody = `[Error reading response body: ${bodyError.message}]`;
      }

      responseHeaders = {};
      response.headers.forEach((value, key) => {
        responseHeaders[key] = value;
      });
    }

    return {
      result: {
        api_id: api.id,
        status: isSuccess ? 'success' : 'failure',
        status_code: response.status,
        response_time: responseTime,
        error_message: isSuccess ? null : `Unexpected status code: ${response.status} (expected ${api.expected_status_code})`,
        response_body: responseBody,
        response_headers: responseHeaders,
      },
      isConnectionError: false,
    };
  } catch (error) {
    const responseTime = Date.now() - startTime;
    const status = error.name === 'AbortError' ? 'timeout' : 'failure';

    let errorMessage = error.message || 'Connection failed';
    if (error.code) {
      errorMessage = `${error.code}: ${errorMessage}`;
    }
    if (error.cause?.message) {
      errorMessage = `${errorMessage} (${error.cause.message})`;
    }

    return {
      result: {
        api_id: api.id,
        status,
        status_code: null,
        response_time: responseTime,
        error_message: errorMessage,
        response_body: null,
        response_headers: null,
      },
      isConnectionError: true,
    };
  }
}

/**
 * Ping a single API endpoint with automatic retry on connection-level failures.
 * Retries once after a 1s delay if the failure is a connection error (no HTTP response).
 * Does NOT retry HTTP-level failures (e.g., wrong status code).
 * @param {object} api - API object with url, timeout_duration, expected_status_code
 * @param {Agent} agent - Undici Agent instance for this monitoring cycle
 */
async function pingAPI(api, agent) {
  const { result, isConnectionError } = await attemptPing(api, agent);

  // If it's a connection-level failure, retry once after a short delay
  if (isConnectionError) {
    for (let retry = 1; retry <= CONNECTION_RETRY_COUNT; retry++) {
      console.log(`   ⚡ Retrying ${api.name} after connection failure (attempt ${retry + 1})...`);
      await new Promise(resolve => setTimeout(resolve, CONNECTION_RETRY_DELAY_MS));
      const retryAttempt = await attemptPing(api, agent);
      if (!retryAttempt.isConnectionError) {
        return retryAttempt.result;
      }
      // If retry also failed with connection error, use the retry's result
      return retryAttempt.result;
    }
  }

  return result;
}

/**
 * Save ping result to database
 */
async function savePingResult(result) {
  try {
    await query(
      `INSERT INTO ping_logs (api_id, status, status_code, response_time, error_message, response_body, response_headers, pinged_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, CURRENT_TIMESTAMP)`,
      [
        result.api_id,
        result.status,
        result.status_code,
        result.response_time,
        result.error_message,
        result.response_body,
        result.response_headers ? JSON.stringify(result.response_headers) : null,
      ]
    );
  } catch (error) {
    console.error('Error saving ping result:', error);
  }
}

/**
 * Check for status changes and handle incidents
 * @param {object} api - API object
 * @param {string} currentStatus - Current ping status ('success', 'failure', 'timeout')
 * @param {number|null} statusCode - HTTP status code from the ping (null for timeouts/connection failures)
 */
async function handleStatusChange(api, currentStatus, statusCode = null) {
  const apiId = api.id;
  const tracking = apiLastStatus.get(apiId);

  if (currentStatus === 'success') {
    // Reset counter on success
    apiLastStatus.set(apiId, { status: 'success', consecutiveFailures: 0 });

    // If was previously down, resolve incident
    if (tracking && tracking.status !== 'success') {
      console.log(`🟢 API UP: ${api.name} (${api.url})`);
      await autoResolveIncident(api, statusCode);
    }
    return;
  }

  // Failure or timeout - increment counter
  const prevFailures = tracking ? tracking.consecutiveFailures : 0;
  const newFailures = prevFailures + 1;
  apiLastStatus.set(apiId, { status: currentStatus, consecutiveFailures: newFailures });

  // Only create incident if threshold reached
  if (newFailures === FAILURE_THRESHOLD) {
    console.log(`🔴 API DOWN (${newFailures} consecutive failures): ${api.name} (${api.url})`);
    await detectAndCreateIncident(api, statusCode);
  } else if (newFailures < FAILURE_THRESHOLD) {
    console.log(`⚠️ API FAILING (${newFailures}/${FAILURE_THRESHOLD}): ${api.name} (${api.url})`);
  }
}

/**
 * Monitor all active APIs
 */
async function monitorAllAPIs() {
  // Create fresh agent for this monitoring cycle
  // This prevents stale connection issues and intermittent failures
  const agent = createMonitoringAgent();

  try {
    console.log(`\n⏰ [${new Date().toISOString()}] Running monitoring check...`);

    // Fetch all active APIs
    const result = await query(
      'SELECT * FROM apis WHERE is_active = true ORDER BY id'
    );

    const activeAPIs = result.rows;

    if (activeAPIs.length === 0) {
      console.log('   No active APIs to monitor');
      return;
    }

    // Overlap guard: skip any api whose previous check is still in flight so we
    // never double-ping a slow endpoint across cron cycles.
    const apisToCheck = activeAPIs.filter(api => !inFlightApiIds.has(api.id));
    const skippedCount = activeAPIs.length - apisToCheck.length;
    if (skippedCount > 0) {
      console.log(`   ⏭️  Skipping ${skippedCount} API(s) still in flight from a previous cycle`);
    }

    if (apisToCheck.length === 0) {
      console.log('   All active APIs still in flight — nothing to do this cycle');
      return;
    }

    console.log(`   Monitoring ${apisToCheck.length} API(s)...`);

    // Mark as in flight, then ping all in parallel using the fresh agent.
    // Each promise clears its own id when it settles (success or throw) so the
    // guard releases even if a check errors out.
    apisToCheck.forEach(api => inFlightApiIds.add(api.id));
    const pingPromises = apisToCheck.map(api =>
      pingAPI(api, agent).finally(() => inFlightApiIds.delete(api.id))
    );
    const results = await Promise.all(pingPromises);

    // Save all results and handle incidents
    for (let i = 0; i < results.length; i++) {
      const result = results[i];
      const api = apisToCheck[i];

      // Save ping result
      await savePingResult(result);

      // Handle status changes and incidents (pass status_code for incident tracking)
      await handleStatusChange(api, result.status, result.status_code);

      // Log result
      const statusIcon = result.status === 'success' ? '✅' : '❌';
      const statusText = result.status === 'success'
        ? `${result.response_time}ms`
        : result.error_message;

      console.log(`   ${statusIcon} ${api.name}: ${statusText}`);
    }

    console.log(`   Monitoring check completed!\n`);
  } catch (error) {
    console.error('❌ Error in monitoring service:', error);
  } finally {
    // Clean up - close agent after monitoring cycle
    agent.close();
  }
}

/**
 * Initialize and start the monitoring service
 */
export function startMonitoring() {
  console.log('\n🚀 Starting API monitoring service...');
  console.log(`   Ping interval: ${process.env.PING_INTERVAL_MINUTES || 1} minute(s)`);

  // Run immediately on startup
  monitorAllAPIs();

  // Schedule monitoring job (every 1 minute by default)
  const intervalMinutes = process.env.PING_INTERVAL_MINUTES || 1;
  const cronExpression = `*/${intervalMinutes} * * * *`;

  cron.schedule(cronExpression, () => {
    monitorAllAPIs();
  });

  console.log('✅ Monitoring service started successfully!\n');
}

/**
 * Manually trigger monitoring (useful for testing)
 */
export async function triggerManualMonitoring() {
  console.log('🔧 Manual monitoring triggered...');
  await monitorAllAPIs();
}

export default {
  startMonitoring,
  triggerManualMonitoring,
  monitorAllAPIs,
};
