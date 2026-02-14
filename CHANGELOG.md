# Changelog

All notable changes to Pabbly Status Monitor will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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
