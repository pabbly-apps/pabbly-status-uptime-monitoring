# Changelog

All notable changes to Pabbly Status Monitor will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

---

## [1.9.0] - 2026-08-22

### Added

#### Critical Phone Alarm (Home Assistant push gateway)

Google Chat is enough for routine downtime but not for a critical system failing at 3am. This adds an opt-in per-API **Critical** flag: when such an API goes down, a loud alarm is pushed to the on-call phones and repeated until each person silences it, the service recovers, or a maximum window elapses.

Delivery runs through a self-hosted **Home Assistant** instance used purely as a push gateway. It is the only free, self-hostable option whose mobile app holds Apple's Critical Alerts entitlement — which is what lets an iPhone ring at full volume through the silent switch and Focus/Do Not Disturb. Android rings on `alarm_stream_max`, i.e. max alarm volume even on silent/vibrate.

**Why it repeats rather than loops:** neither mobile OS can loop a sound from a push notification (iOS caps notification sound at ~30s, played once). "Continuous until silenced" is therefore achieved by re-sending on a fixed interval, every repeat reusing the same `tag` so it replaces the previous notification instead of stacking.

**Per-API routing.** Each critical API can name the exact phones it should wake, so one project's outage never wakes another project's team. There is deliberately **no fallback to alerting everyone**: if an API's routed devices are all gone it alarms nobody, logs an error, and the incident records `no_targets`. Google Chat and email still fire, so the outage is never invisible, and `updateSettings` warns before an admin can reach that state. Devices can carry a friendly label (`mobile_app_pixel_8:Ravi (Pixel)`) shown when picking who an API wakes.

**Per-device silencing.** Tapping the notification opens a page with a single action — *Silence my phone* — which clears that device only and leaves everyone else ringing, so someone muting their pocket can never mute the person who would actually fix the problem. Recovery auto-silences every phone with no action needed.

**Files Changed:**
- `backend/src/services/criticalAlertService.js` — **New.** Push, repeat, per-device silence, clear, recovery all-clear, and test. Fire-and-forget like `googleChatService`; logs to the shared `webhook_logs` ledger.
- `backend/src/services/incidentService.js` — Arms the alarm on incident creation and stands it down on auto-resolve (8 lines at the existing fan-out).
- `backend/src/routes/ack.js` + `backend/src/controllers/publicController.js` — **New.** Token-authenticated responder page. The GET only renders a choice and never silences anything; the action is a POST, so link previewers and security scanners cannot silence a live alarm.
- `backend/src/server.js` — Starts the repeater; mounts the responder route ahead of the shared public rate limiter with its own budget, so responder traffic and status-page traffic cannot starve each other.
- `backend/src/controllers/adminController.js` — `is_critical` / `alert_targets` on create+update with device validation; HA gateway settings; masks `ha_token` in responses; warns when a settings change would strand a critical API.
- `frontend/src/pages/Settings.jsx` — New **Phone Alarm** tab with a Test Alarm button.
- `frontend/src/components/admin/AddAPIModal.jsx` — **Critical** toggle plus a checkbox list of which phones to wake (a list, not free text — a typo would mean nobody gets woken).
- `database/schema.sql` + `database/migrations/010_add_critical_phone_alarm.sql` — 16 columns and 2 indexes, idempotent.
- `install.sh`, `docs/DEPLOYMENT.md`, `docs/AUTOMATED-DEPLOYMENT.md` — **Added the missing `npm run migrate` step** (see Fixed).
- `backend/package.json` → 1.9.0, `frontend/package.json` → 1.2.0

**Behaviour:** `is_critical` and `critical_alert_enabled` both default to `FALSE`, so nothing rings until an API is explicitly opted in and the gateway is configured. Google Chat, email, webhooks and the monitoring loop are unchanged.

**State lives in Postgres, not memory** — unlike `apiLastStatus`, a pm2 restart cannot silently kill a live alarm, which is the exact failure this feature exists to prevent. The repeater polls for due rows and self-heals across restarts with no rehydration step.

### Fixed

#### `npm run migrate` missing from every deploy path

`install.sh` applied `database/schema.sql` only, and the documented update commands went straight from `git pull` to `pm2 restart`. Any release that added a column would leave production unmigrated — verified against a pre-change database, that breaks adding an API and saving any setting, while monitoring keeps running (so it would look healthy). The step is now in the installer and both deployment docs.

**Known issue (unfixed):** `backend/src/config/migrate.js` compares `import.meta.url` against `process.argv[1]`, which never match on Windows (`file:///D:/...` vs `D:\...`), so `npm run migrate` is a silent no-op on Windows dev machines. Linux servers are unaffected.

### Notes

**Migration:** `010_add_critical_phone_alarm.sql` is idempotent (`ADD COLUMN IF NOT EXISTS`) and was verified against throwaway databases to produce a schema identical to a fresh `schema.sql` install.

**Deploy order:** `git pull` → `npm install --production` → **`npm run migrate`** → `npm run build` (frontend) → `pm2 restart`. The frontend must be rebuilt or the Phone Alarm tab will not appear.

**Before enabling:** set `ENCRYPTION_KEY` *before* saving the HA token or it is stored in plaintext (as `smtp_pass` is today); `FRONTEND_URL` must be the public HTTPS URL because the silence link is built from it; keep pm2 at a single instance, as the repeater runs in-process.

**Not yet verified on real hardware:** the test suite runs against a mock Home Assistant. Complete the HA setup and use **Send Test Alarm** to confirm the alarm is genuinely loud through Do Not Disturb before relying on it.

---

## [1.8.0] - 2026-07-21

### Added

#### Per-API Failure Threshold (editable)

Re-introduced a single per-API setting — **Failure Threshold** — editable from the Add/Edit API form. It controls how many consecutive failed checks are required before an API is marked DOWN and an incident/alert is raised. This is a focused subset of the removed v1.6.0 feature: **retry count and retry delay are intentionally NOT re-added** (retry stays fixed at the built-in single retry).

**Files Changed:**
- `backend/src/services/monitorService.js` — `handleStatusChange` now reads `api.failure_threshold ?? FAILURE_THRESHOLD`.
- `backend/src/controllers/adminController.js` — Accept/validate (1–10)/persist `failure_threshold` on create + update; added to the read SELECTs.
- `frontend/src/components/admin/AddAPIModal.jsx` — Added the "Failure Threshold" field (below Timeout).
- `database/schema.sql` + `database/migrations/009_add_failure_threshold.sql` — `failure_threshold` column (default 2, idempotent).
- `backend/package.json` — Version bump to 1.8.0

**Behaviour:** default 2 preserves existing behaviour for all endpoints. The retry mechanism is unchanged (fixed single retry).

**Migration:** `009_add_failure_threshold.sql` is idempotent (`ADD COLUMN IF NOT EXISTS`); the column already exists in the current production DB from the earlier v1.6.0 work, so this is a no-op there.

---

## [1.7.0] - 2026-07-21

### Removed

#### Per-API Retry / Backoff / Failure-Threshold Configuration (v1.6.0 feature)

Removed the per-API retry configuration introduced in v1.6.0. It was added to tolerate transient packet loss on the directly-exposed Highinbox PMTA endpoint, but that problem is now solved at the network layer — Highinbox is monitored through a Cloudflare-proxied subdomain (`highinbox-status.pabbly.com`), so the monitor reaches a nearby Cloudflare edge instead of the lossy Germany→India path. The extra Admin form fields were no longer needed and added confusion.

**Reverted to the original hardcoded behavior:** `FAILURE_THRESHOLD = 2`, `CONNECTION_RETRY_COUNT = 1`, `CONNECTION_RETRY_DELAY_MS = 1000` (single retry on connection-level failure). All endpoints behave as they did before v1.6.0.

**Files Changed:**
- `backend/src/services/monitorService.js` — Restored hardcoded constants and the original single-retry `pingAPI`; reverted `handleStatusChange` to the hardcoded threshold. **The overlap guard (skip re-pinging an in-flight check) was intentionally kept.**
- `backend/src/controllers/adminController.js` — Removed the 3 retry fields from create/update validation, persistence, and the read SELECTs.
- `frontend/src/components/admin/AddAPIModal.jsx` — Removed the Retry Count / Retry Delay / Failure Threshold form fields.
- `database/schema.sql` — Removed the 3 columns from the base schema; deleted migration `008_add_monitoring_retry_config.sql`.
- `backend/package.json` — Version bump to 1.7.0

**Note:** The `retry_count`, `retry_delay_ms`, and `failure_threshold` columns are left in the existing production database (now unused/harmless); no destructive drop-migration was run.

---

## [1.6.1] - 2026-07-18

### Fixed

#### Rate Limiter Trust Proxy Configuration

Fixed `express-rate-limit` throwing `ERR_ERL_UNEXPECTED_X_FORWARDED_FOR` on every proxied request. The backend runs behind a local nginx reverse proxy (which sets `X-Forwarded-For`), but Express `trust proxy` was left at its default (`false`), so the limiter could not derive the real client IP.

**Files Changed:**
- `backend/src/server.js` — Added `app.set('trust proxy', 'loopback')`
- `backend/package.json` — Version bump to 1.6.1

**Why `'loopback'`:** nginx is the only proxy and connects from localhost. Trusting only loopback (rather than a hop count like `1`) means a direct connection to the app port carrying a spoofed `X-Forwarded-For` is ignored, so the rate limiter keys on the true client IP and cannot be bypassed.

---

## [1.6.0] - 2026-07-17

### Added

#### Per-API Retry, Backoff & Failure Threshold Configuration

Made the monitor tolerant of transient network packet loss by adding per-API, admin-configurable retry, backoff, and failure-threshold settings. Previously these were global hardcoded constants (`FAILURE_THRESHOLD`, `CONNECTION_RETRY_COUNT`, `CONNECTION_RETRY_DELAY_MS`) in `monitorService.js`; they are now stored per-API in the database and editable directly from the Add/Edit API form.

This fixes intermittent false "down" alerts for directly-exposed endpoints (e.g. Highinbox PMTA Server) that sit on lossy network paths. Packet capture proved these failures were caused by dropped TCP SYN packets on the network route — the connection never established even though the target server was healthy — rather than by the server itself. Endpoints behind Cloudflare were unaffected.

**New Files:**
- `database/migrations/008_add_monitoring_retry_config.sql` — Migration adding `retry_count`, `retry_delay_ms`, and `failure_threshold` columns to the `apis` table

**Modified Files:**
- `backend/src/services/monitorService.js` — Removed the hardcoded constants; reads all three values per-API from the row; rewrote `pingAPI()` with a real retry loop and exponential backoff; per-API failure threshold in `handleStatusChange()`; added an in-memory overlap guard that skips APIs whose previous check is still in flight
- `backend/src/controllers/adminController.js` — Validate and persist the 3 new fields on create/update; added them to the `getAllAPIs` and `getAPIById` SELECTs so the Edit form loads current values
- `frontend/src/components/admin/AddAPIModal.jsx` — Added "Retry Count", "Retry Delay (ms)", and "Failure Threshold" fields to the Add/Edit API form
- `database/schema.sql` — Added the 3 columns to the base `apis` table for fresh installs
- `backend/package.json` — Version bump to 1.6.0

**How it works:**
- Retries **only** on connection-level failures (DNS/TCP/TLS/timeout — no HTTP response). HTTP status mismatches (500/502/wrong code) surface immediately with no retry, since those are real application problems.
- Exponential backoff between retries: `retry_delay_ms`, then ×2, ×4, … before each subsequent attempt.
- The check reports `success` if **any** attempt succeeds, and `failure` only if the initial attempt plus all retries fail.
- Per-API `failure_threshold` — N consecutive failed checks before an incident is raised. Transient loss now recovers on retry → success → counter resets → no false alert. A genuine outage still fails all retries for `failure_threshold` consecutive checks → incident raised.
- Overlap guard prevents duplicate pings / duplicate `ping_logs` when a check runs longer than the monitoring interval.

**Configuration (per-API, in the Admin UI):**
| Field | Range | Default | Meaning |
|-------|-------|---------|---------|
| Retry Count | 0–5 | 1 | Additional retries on connection failure |
| Retry Delay (ms) | 100–30000 | 1000 | Base backoff delay, doubles each retry |
| Failure Threshold | 1–10 | 2 | Consecutive fails before marking DOWN |

**Backward Compatibility:** The defaults (`retry_count=1`, `retry_delay_ms=1000`, `failure_threshold=2`) exactly match the previous hardcoded constants, so all existing endpoints behave identically until individually tuned.

**Note:** Keep `(retry_count × timeout_duration + sum of backoffs)` below the API's interval so a check does not overlap the next monitoring cycle. The failure counter and overlap guard are in-memory and reset on server restart.

**Migration Required:**
```bash
docker exec -i postgres psql -U postgres -d status_monitor < database/migrations/008_add_monitoring_retry_config.sql
```

---

## [1.5.2] - 2026-04-04

### Security

#### Fix Sensitive Data Exposure in API Endpoints

Fixed multiple security vulnerabilities where API endpoints were leaking sensitive configuration data including SMTP credentials, webhook URLs, and internal email addresses.

**Vulnerabilities Fixed:**

1. **Public Status API Leaking All Settings (Critical)** — `GET /api/public/status` returned the full `system_settings` row via `SELECT *`, exposing SMTP password, webhook URLs, notification emails, and other secrets to unauthenticated users.

2. **Admin Settings API Leaking SMTP Password (Critical)** — `GET /api/admin/settings` returned `smtp_pass` in plaintext. Now masked with `••••••••••••••••` (matching the existing `getEmailSettings` behavior).

3. **Dashboard Stats API Leaking All Settings (Critical)** — `GET /api/admin/dashboard-stats` also used `SELECT *` on `system_settings`, exposing the same sensitive data.

4. **`SELECT *` Replaced with Explicit Columns (High)** — All `SELECT *` queries across admin endpoints replaced with explicit column lists to prevent future data leaks if new sensitive columns are added.

5. **SVG Upload XSS (Medium)** — Uploaded SVG files are now sanitized to strip `<script>` tags, `on*` event handlers, and `javascript:` hrefs.

6. **SSRF via API URL (Low)** — API URL validation now blocks internal/private network addresses (`localhost`, `127.0.0.1`, `10.x.x.x`, `172.16-31.x.x`, `192.168.x.x`, `169.254.x.x`).

**Files Changed:**
- `backend/src/controllers/publicController.js` — `getOverallStatus()` now selects only branding fields from settings
- `backend/src/controllers/adminController.js` — Masked `smtp_pass` in `getSettings()`, replaced all `SELECT *` with explicit columns, added `isInternalUrl()` validation for API URLs, added SVG sanitization on logo upload
- `backend/src/config/upload.js` — Added `sanitizeSVG()` function to strip dangerous SVG content
- `backend/package.json` — Version bump to 1.5.2

---

## [1.5.1] - 2026-03-03

### Fixed

#### Hourly Aggregation Stats Mismatch with Drill-Down View

Fixed a timezone handling bug where the 7-day ping history hourly bars showed incorrect success/failure counts (e.g., "Failed: 0") while the minute-level drill-down for the same hour showed the correct stats (e.g., "Failed: 5").

**Root Cause:**
The `AT TIME ZONE` conversion on the `TIMESTAMP` column (`pinged_at`) was incorrect. Using a single `AT TIME ZONE` declared the UTC timestamp as the user's local timezone instead of converting it. Additionally, `DATE_TRUNC('hour')` operated on UTC timestamptz values, splitting non-whole-hour offset timezones (like IST UTC+5:30) at the :30 minute mark instead of aligning with local hour boundaries.

**Files Changed:**
- `backend/src/config/database.js` — Added explicit `SET timezone = 'UTC'` on all pool connections for consistent TIMESTAMP handling
- `backend/src/controllers/publicController.js` — Fixed `getAggregatedPingLogs()` to use double `AT TIME ZONE` pattern for correct local hour/day bucketing; fixed `getDrillDownPingLogs()` to explicitly convert timestamps to UTC for comparison

**Fix Details:**
- Changed `DATE_TRUNC($1, pinged_at AT TIME ZONE $3)` → `DATE_TRUNC($1, (pinged_at AT TIME ZONE 'UTC') AT TIME ZONE $3)` ensuring hour/day boundaries align with the user's local clock
- Changed drill-down comparison from `pinged_at >= $2::timestamptz` → `pinged_at >= ($2::timestamptz AT TIME ZONE 'UTC')` ensuring the drill-down fetches the exact same pings the aggregation counted
- Aggregated stats and drill-down stats now always match for the same time period

---

## [1.5.0] - 2026-02-27

### Added

#### Google SSO Authentication

Replaced password-based login with Google SSO for secure, passwordless authentication.

**New Files:**
- `database/migrations/006_google_sso.sql` — Migration adding Google SSO columns, domain restrictions, and user tracking

**Modified Files:**
- `backend/src/controllers/authController.js` — Google SSO login, domain validation, user management with `added_by` tracking
- `backend/src/routes/auth.js` — Updated auth routes for Google SSO
- `backend/src/server.js` — Auto-seed first admin from `ADMIN_EMAIL` env var on startup
- `backend/.env.example` — Added `GOOGLE_CLIENT_ID` and `ADMIN_EMAIL` config
- `frontend/src/pages/Login.jsx` — Google Sign-In button replacing email/password form
- `frontend/src/pages/Settings.jsx` — Domain management UI, user tracking ("Added By" column)
- `frontend/src/services/authService.js` — Google login integration
- `frontend/.env.example` — Added `VITE_GOOGLE_CLIENT_ID`
- `database/schema.sql` — Added `google_id`, `profile_picture`, `is_active`, `added_by`, `allowed_domains` columns

**Features:**
- Google OAuth2 token verification via `google-auth-library`
- Domain-based access control (restrict login to specific email domains)
- Tag-based domain input with validation in Settings UI
- User pre-registration (admin adds user email, user logs in via Google SSO)
- "Added By" tracking — shows who added each user in the users table
- Auto-seed default admin from `ADMIN_EMAIL` env var (runs only on first setup when no users exist)
- `is_active` flag for disabling users without deletion

**First-Time Setup:**
1. Set `ADMIN_EMAIL` and `GOOGLE_CLIENT_ID` in `backend/.env`
2. Set `VITE_GOOGLE_CLIENT_ID` in `frontend/.env`
3. Run schema.sql — the backend auto-creates the admin user on first startup

**Migration Required (existing databases):**
```bash
psql -U postgres -d status_monitor < database/migrations/006_google_sso.sql
```

---

## [1.4.0] - 2026-02-19

### Added

#### Direct Google Chat Webhook Notifications

Added direct Google Chat webhook integration for incident notifications. Sends alerts directly to a Google Chat space as an independent notification channel.

**New Files:**
- `backend/src/services/googleChatService.js` — Google Chat webhook delivery service
- `database/migrations/004_add_google_chat_webhook.sql` — Migration for existing databases

**Modified Files:**
- `backend/src/services/incidentService.js` — Integrated Google Chat notifications on incident create/resolve
- `backend/src/controllers/adminController.js` — Google Chat settings management and test endpoint
- `backend/src/routes/admin.js` — Added `/admin/google-chat-test` route
- `frontend/src/pages/Settings.jsx` — Added Google Chat configuration tab
- `frontend/src/services/adminService.js` — Added `testGoogleChat` API function
- `database/schema.sql` — Added `google_chat_webhook_url` and `google_chat_webhook_enabled` columns

**Features:**
- Fire-and-forget async delivery (does not block incident processing)
- 30-second timeout with AbortController
- Delivery logging to `webhook_logs` table with `gchat_` prefixed event types
- Test notification button in Settings to verify webhook configuration

**Migration Required:**
```bash
docker exec -i postgres psql -U postgres -d status_monitor < database/migrations/004_add_google_chat_webhook.sql
```

---

#### Admin Timezone Support

Added configurable timezone for admin notifications (Google Chat, email, webhook) and dashboard display. The public status page continues to use the visitor's browser timezone.

**New Files:**
- `backend/src/utils/timezone.js` — Backend timezone formatting utility
- `database/migrations/005_add_admin_timezone.sql` — Migration for existing databases

**Modified Files:**
- `backend/src/services/emailService.js` — Uses admin timezone for email timestamps
- `backend/src/services/webhookService.js` — Uses admin timezone for webhook timestamps
- `backend/src/services/googleChatService.js` — Uses admin timezone for Google Chat timestamps
- `frontend/src/contexts/TimezoneContext.jsx` — Enhanced with `initialTimezone` prop
- `frontend/src/pages/AdminDashboard.jsx` — Timezone-aware display
- `frontend/src/pages/Settings.jsx` — Added Timezone configuration tab with search
- `frontend/src/utils/timezone.js` — Enhanced timezone abbreviation handling
- `database/schema.sql` — Added `admin_timezone` column

**Migration Required:**
```bash
docker exec -i postgres psql -U postgres -d status_monitor < database/migrations/005_add_admin_timezone.sql
```

---

## [1.3.4] - 2026-02-17

### Fixed

#### Timeout Handling & Connection Retry

Optimized timeout handling and added connection retry mechanism to further reduce false downtime alerts.

**Files Changed:**
- `backend/src/services/monitorService.js` - Relaxed undici timeouts, added `attemptPing()` with retry logic
- `backend/package.json` - Version bump to 1.3.4

**Changes:**

1. Optimized timeout handling to let dashboard-configured API timeout settings take precedence, preventing premature request termination by the underlying HTTP client.

2. Added automatic retry mechanism for transient connection failures (DNS, TCP, TLS), reducing false downtime alerts caused by temporary network disruptions.

---

## [1.3.3] - 2026-02-13

### Added

#### Consecutive Failure Threshold

Added a consecutive failure threshold to prevent false downtime alerts from single network blips.

**Files Changed:**
- `backend/src/services/monitorService.js` - Added `FAILURE_THRESHOLD` constant and rewrote `handleStatusChange()` with consecutive failure counting
- `backend/package.json` - Version bump to 1.3.3

**How it works:**
- Requires 2 consecutive failures before marking an API as down and triggering incidents/alerts/webhooks
- A single network blip (fetch failed, timeout) no longer creates a false alert
- Counter resets to 0 on any successful ping
- All ping results are still recorded in `ping_logs` regardless of threshold

**Note:** The failure counter is stored in memory and resets on server restart. Worst case after restart: 2 minutes to detect a truly down service.

---

## [1.3.2] - 2026-02-13

### Fixed

#### Intermittent "fetch failed" Errors

Fixed random "fetch failed" errors (Status Code: N/A) caused by undici connection pooling issues.

**Files Changed:**
- `backend/src/services/monitorService.js` - Replaced shared Agent with fresh-per-cycle Agent, added missing timeouts, enhanced error logging
- `backend/package.json` - Version bump to 1.3.2

**Root Cause:**
The shared undici Agent with `keepAliveTimeout: 1` (1ms) was too aggressive, causing race conditions. Additionally, critical timeout parameters (`headersTimeout`, `bodyTimeout`) were missing, leading to intermittent connection failures.

**Solution:**
- Create a fresh Agent per monitoring cycle (destroyed after each cycle)
- Added `headersTimeout` (30s) and `bodyTimeout` (30s) configuration
- Reduced `connections` from 10 to 1 with `pipelining: 0` for minimal pooling
- Enhanced error logging to capture error codes (`ECONNRESET`, `ETIMEDOUT`, etc.) for better debugging

---

## [1.3.1] - 2025-01-15

### Fixed

#### Cloudflare 520/525 Connection Errors

Fixed intermittent 520 and 525 errors when monitoring APIs behind Cloudflare by disabling HTTP connection reuse.

**Files Changed:**
- `backend/src/services/monitorService.js` - Added custom undici Agent with connection reuse disabled
- `backend/package.json` - Added `undici` dependency

**Root Cause:**
Node.js native `fetch()` reuses TCP connections by default (HTTP keep-alive). When monitoring APIs behind Cloudflare:
- Stale connections caused **520 errors** (Cloudflare closed the connection, but client tried to reuse it)
- Expired SSL sessions caused **525 errors** (SSL handshake failed on reused connection)

**Solution:**
```javascript
import { Agent } from 'undici';

const httpAgent = new Agent({
  keepAliveTimeout: 1,
  keepAliveMaxTimeout: 1,
  connections: 10,
  pipelining: 1,
});

// Use dispatcher option in fetch
fetch(url, { dispatcher: httpAgent });
```

**Benefits:**
- Eliminates random 520/525 errors for Cloudflare-proxied endpoints
- Each monitoring request uses a fresh TCP connection
- Minimal latency impact (~50-100ms) which is negligible for 1-minute intervals

---

## [1.3.0] - 2025-01-14

### Added

#### HTTP Status Code in Webhook Notifications

Added `status_code` field to webhook payloads and incident tracking.

**Files Changed:**
- `database/schema.sql` - Added `status_code` column to incidents table
- `database/migrations/003_add_incident_status_code.sql` - Migration for existing databases
- `backend/src/services/monitorService.js` - Pass status code to incident handlers
- `backend/src/services/incidentService.js` - Store and pass status code
- `backend/src/services/webhookService.js` - Include status code in webhook payload

**Before:**
```json
{
  "event_type": "api_down",
  "incident": {
    "id": 1,
    "title": "My API is down",
    "status": "ongoing"
  }
}
```

**After:**
```json
{
  "event_type": "api_down",
  "incident": {
    "id": 1,
    "title": "My API is down",
    "status": "ongoing",
    "status_code": 503
  }
}
```

**Behavior:**
| Event | `status_code` Value |
|-------|---------------------|
| `api_down` | The error code that caused the failure (e.g., 500, 503, 404) |
| `api_up` | The recovery code (e.g., 200) confirming the API is healthy |

**Benefits:**
- Webhook consumers can now identify the exact HTTP error that caused the incident
- Recovery webhooks confirm the API is returning the expected status code
- Better integration with automation tools and alerting systems
- Improved incident reporting and debugging capabilities

**Migration Required:**
```bash
docker exec -i postgres psql -U postgres -d status_monitor < database/migrations/003_add_incident_status_code.sql
```

---

#### Enhanced Email Notification Templates

Redesigned email notifications with improved formatting, status code information, and professional layout optimized for email clients.

**Files Changed:**
- `backend/src/services/emailService.js` - Completely redesigned both downtime and recovery email templates
- `backend/src/services/incidentService.js` - Pass status code to email functions

**Before (Downtime Alert):**
```
Subject: 🔴 ALERT: Pabbly Chatflow is DOWN

API Downtime Alert
An API endpoint you're monitoring has gone down:
API Name: Pabbly Chatflow
URL: https://chatflow.pabbly.com/api/status
...
```

**After (Downtime Alert):**
```
Subject: 🔴 ALERT: Pabbly Chatflow is Down

┌────────────────────────────────────────┐
│  🔴 API DOWNTIME ALERT                 │
│  (Light red header with border)        │
└────────────────────────────────────────┘

Service:           Pabbly Chatflow
Status:            [Ongoing]
Incident ID:       #3
Started:           1/13/2025, 4:55:00 PM

─────────────────────────────────────────

ENDPOINT DETAILS
URL:               https://chatflow.pabbly.com/api/status
Status Code:       502
Error:             Unexpected status code: 502 (expected 200)

┌────────────────────────────────────────┐
│ ACTION REQUIRED:                       │
│ Investigate the issue immediately.     │
│ Check server logs, upstream services,  │
│ and infrastructure status.             │
└────────────────────────────────────────┘

[View Status Page]
```

**Before (Recovery Notification):**
```
Subject: 🟢 RESOLVED: Pabbly Chatflow is back online

Good news! The API endpoint has recovered...
```

**After (Recovery Notification):**
```
Subject: 🟢 RESOLVED: Pabbly Chatflow is Back Online

┌────────────────────────────────────────┐
│  🟢 SERVICE RECOVERED                  │
│  (Light green header with border)      │
└────────────────────────────────────────┘

Service:           Pabbly Chatflow
Incident ID:       #3
Started:           1/13/2025, 4:55:00 PM
Resolved:          1/13/2025, 5:00:00 PM
Downtime:          [5 minute(s)]

─────────────────────────────────────────

ENDPOINT DETAILS
URL:               https://chatflow.pabbly.com/api/status
Original Error:    HTTP 502
Current Status:    HTTP 200 (Healthy)

[View Status Page]
```

**Key Improvements:**
- **Email-optimized layout:** Uses HTML tables instead of flexbox for cross-client compatibility
- **Professional subject lines:**
  - Downtime: `🔴 ALERT: [Service Name] is Down`
  - Recovery: `🟢 RESOLVED: [Service Name] is Back Online`
- **Compact headers:** Reduced padding (16px) with lighter background colors for better aesthetics
- **Status code tracking:** Displays both error codes (500, 503, etc.) and recovery codes (200)
- **Clean information hierarchy:** Removed redundant "Status: Resolved" badge in recovery emails
- **Inline styles:** All CSS is inline for maximum email client compatibility
- **Responsive design:** Works on both desktop and mobile email clients
- **Action buttons:** Clear "View Status Page" CTA linking to frontend
- **Visual indicators:** Color-coded headers (red for alerts, green for recovery)

**Email Client Compatibility:**
- Gmail (Web & Mobile)
- Outlook (Desktop & Web)
- Apple Mail
- Yahoo Mail
- Thunderbird
- All major email clients

**Benefits:**
- Clear, grammatically correct subject lines without incident numbers
- Emoji indicators (🔴/🟢) at the start of subject for quick visual recognition
- HTTP status codes included for both downtime and recovery events
- Structured table-based layout that renders consistently across email clients
- Professional appearance with appropriate spacing and color scheme
- Quick access to status page via button link
- Downtime duration prominently displayed in recovery emails

---

### Changed

#### Reduced Console Logging for Better Performance

Removed verbose logging to improve performance and reduce log storage.

**Files Changed:**
- `backend/src/config/database.js` - Removed query execution logs
- `backend/src/server.js` - Removed HTTP request logging middleware

**Before:**
```
Executed query { text: 'SELECT * FROM apis...', duration: 5, rows: 10 }
2026-01-13T11:59:19.515Z - GET /api/admin/dashboard-stats
2026-01-13T11:59:19.524Z - GET /api/public/status
✅ Connected to PostgreSQL database
✅ Connected to PostgreSQL database
✅ Connected to PostgreSQL database
```

**After:**
```
(clean console - only important logs like API UP/DOWN events)
```

**What Was Removed:**
| Log Type | Reason for Removal |
|----------|-------------------|
| `Executed query {...}` | Logged every database query - extremely verbose |
| `GET /api/...` request logs | Logged every HTTP request - noisy |
| `✅ Connected to PostgreSQL` | Logged on every pool connection - repetitive |

**What Was Kept:**
| Log Type | Reason for Keeping |
|----------|-------------------|
| `🔴 API DOWN: ...` | Critical - alerts when API goes down |
| `🟢 API UP: ...` | Critical - confirms API recovery |
| `📋 Created incident #...` | Important - tracks incident creation |
| `❌ Database pool error` | Critical - prevents silent failures |

**Benefits:**
- Reduced log storage consumption
- Easier to find important events in logs
- Minimal performance improvement (reduced I/O operations)
- Cleaner development console output

---

### Fixed

- Service recovery email was not getting sent
- Layout for Public and Private services toggle enhanced
- Font size improved for Group header on mobile devices
- Mobile layout for Groups improved

---

## [1.2.0] - 2025-01-01

### Added

#### API Groups Feature
Organize monitored services into collapsible categories for better organization.

- Create custom groups to categorize APIs
- Drag-and-drop APIs between groups
- Collapsible group sections on status page
- Default "Ungrouped" category for uncategorized APIs
- Group display order customization

**Files Changed:**
- `database/schema.sql` - Added `api_groups` table
- `database/migrations/002_add_api_groups.sql` - Migration for existing databases
- `backend/src/routes/admin.js` - Group CRUD endpoints
- `frontend/src/components/` - Group management UI components

---

## [1.1.0] - 2024-12-30

### Added

- SMTP email notifications for downtime alerts and recovery
- Webhook notifications for status changes
- Test webhook functionality
- Public/Private API visibility toggle
- 90-day uptime tracking with calendar drill-down
- Mobile-optimized admin dashboard
- Custom logo upload
- Settings page with SMTP configuration

---

## [1.0.0] - 2024-12-15

### Added

- Real-time API monitoring with configurable intervals
- Public status page
- Admin dashboard with authentication
- Incident management and tracking
- Uptime statistics and response time charts
- PostgreSQL database backend
- JWT-based authentication
