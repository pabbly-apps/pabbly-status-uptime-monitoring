import cron from 'node-cron';
import { Agent } from 'undici';
import { query } from '../config/database.js';
import { detectAndCreateIncident, autoResolveIncident } from './incidentService.js';

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

    // Critical timeout parameters
    headersTimeout: 30000,       // 30s for response headers
    bodyTimeout: 30000,          // 30s for response body
  });
}

// Track last status for each API to detect status changes
const apiLastStatus = new Map();

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

/**
 * Ping a single API endpoint
 * @param {object} api - API object with url, timeout_duration, expected_status_code
 * @param {Agent} agent - Undici Agent instance for this monitoring cycle
 */
async function pingAPI(api, agent) {
  const startTime = Date.now();

  try {
    // Use native fetch (available in Node.js 18+)
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
      // Capture response body (as text)
      try {
        const bodyText = await response.text();
        responseBody = truncateBody(bodyText);
      } catch (bodyError) {
        console.error('Error reading response body:', bodyError);
        responseBody = `[Error reading response body: ${bodyError.message}]`;
      }

      // Capture response headers
      responseHeaders = {};
      response.headers.forEach((value, key) => {
        responseHeaders[key] = value;
      });
    }

    return {
      api_id: api.id,
      status: isSuccess ? 'success' : 'failure',
      status_code: response.status,
      response_time: responseTime,
      error_message: isSuccess ? null : `Unexpected status code: ${response.status} (expected ${api.expected_status_code})`,
      response_body: responseBody,
      response_headers: responseHeaders,
    };
  } catch (error) {
    const responseTime = Date.now() - startTime;

    // Determine if it's a timeout or other error
    const status = error.name === 'AbortError' ? 'timeout' : 'failure';

    // Build detailed error message with error code for debugging
    let errorMessage = error.message || 'Connection failed';
    if (error.code) {
      errorMessage = `${error.code}: ${errorMessage}`;
    }
    if (error.cause?.message) {
      errorMessage = `${errorMessage} (${error.cause.message})`;
    }

    return {
      api_id: api.id,
      status,
      status_code: null,
      response_time: responseTime,
      error_message: errorMessage,
      response_body: null,
      response_headers: null,
    };
  }
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
  const lastStatus = apiLastStatus.get(apiId);

  // Update last status
  apiLastStatus.set(apiId, currentStatus);

  // If this is the first ping AND API is down, create incident
  if (!lastStatus && currentStatus !== 'success') {
    console.log(`🔴 NEW API DOWN: ${api.name} (${api.url})`);
    await detectAndCreateIncident(api, statusCode);
    return;
  }

  // If this is the first ping but API is up, just track it
  if (!lastStatus) {
    return;
  }

  // Detect UP → DOWN transition (create incident)
  if (lastStatus === 'success' && currentStatus !== 'success') {
    console.log(`🔴 API DOWN: ${api.name} (${api.url})`);
    await detectAndCreateIncident(api, statusCode);
  }

  // Detect DOWN → UP transition (resolve incident)
  if (lastStatus !== 'success' && currentStatus === 'success') {
    console.log(`🟢 API UP: ${api.name} (${api.url})`);
    await autoResolveIncident(api, statusCode);
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

    console.log(`   Monitoring ${activeAPIs.length} API(s)...`);

    // Ping all APIs in parallel using the fresh agent
    const pingPromises = activeAPIs.map(api => pingAPI(api, agent));
    const results = await Promise.all(pingPromises);

    // Save all results and handle incidents
    for (let i = 0; i < results.length; i++) {
      const result = results[i];
      const api = activeAPIs[i];

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
