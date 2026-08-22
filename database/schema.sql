-- ============================================================================
-- Status Monitor Database Schema
-- ============================================================================
-- This schema creates all tables with their final structure.
-- No migrations needed - this is the complete, production-ready schema.
-- ============================================================================

-- ============================================================================
-- 1. ADMIN USER TABLE
-- ============================================================================
-- Stores admin user credentials and profile information
CREATE TABLE IF NOT EXISTS admin_user (
  id SERIAL PRIMARY KEY,
  email VARCHAR(255) UNIQUE NOT NULL,
  password_hash TEXT,
  full_name VARCHAR(255),
  google_id VARCHAR(255) UNIQUE,
  profile_picture TEXT,
  added_by INTEGER REFERENCES admin_user(id) ON DELETE SET NULL,
  is_active BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  last_login TIMESTAMP
);

-- Index for faster email lookups during login
CREATE INDEX IF NOT EXISTS idx_admin_email ON admin_user(email);

-- Index for Google SSO lookups
CREATE INDEX IF NOT EXISTS idx_admin_google_id ON admin_user(google_id);


-- ============================================================================
-- 2. SYSTEM SETTINGS TABLE
-- ============================================================================
-- Single-row table for global application settings
CREATE TABLE IF NOT EXISTS system_settings (
  id INTEGER PRIMARY KEY DEFAULT 1,
  page_title VARCHAR(255) DEFAULT 'System Status',
  logo_url TEXT,
  brand_color VARCHAR(7) DEFAULT '#3b82f6',
  custom_message TEXT,
  notification_email VARCHAR(255),
  notifications_enabled BOOLEAN DEFAULT FALSE,
  webhook_url TEXT,
  webhook_enabled BOOLEAN DEFAULT FALSE,
  webhook_secret TEXT, -- HMAC-SHA256 secret for signing outgoing webhooks
  google_chat_webhook_url TEXT,
  google_chat_webhook_enabled BOOLEAN DEFAULT FALSE,
  admin_timezone VARCHAR(50) DEFAULT 'UTC',
  data_retention_days INTEGER DEFAULT 90,

  -- Google SSO Domain Restriction ('*' for all, or comma-separated domains like 'pabbly.com,example.com')
  allowed_domains TEXT DEFAULT '*',

  -- SMTP Email Settings
  smtp_host TEXT,
  smtp_port INTEGER DEFAULT 587,
  smtp_user TEXT,
  smtp_pass TEXT,
  smtp_from TEXT,
  smtp_recipients TEXT,

  -- Critical Phone Alarm (Home Assistant push gateway)
  ha_base_url TEXT,
  ha_token TEXT, -- AES-256-GCM encrypted when ENCRYPTION_KEY is set
  ha_notify_targets TEXT, -- comma-separated, e.g. mobile_app_pixel_8,mobile_app_iphone_15
  critical_alert_enabled BOOLEAN DEFAULT FALSE,
  critical_alert_repeat_seconds INTEGER DEFAULT 30,
  critical_alert_max_minutes INTEGER DEFAULT 15,

  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,

  -- Ensure only one row exists
  CONSTRAINT single_row CHECK (id = 1)
);

-- Insert default settings row
INSERT INTO system_settings (id, page_title, brand_color, notifications_enabled, webhook_enabled, google_chat_webhook_enabled, admin_timezone, data_retention_days, smtp_port, allowed_domains)
VALUES (1, 'System Status', '#3b82f6', FALSE, FALSE, FALSE, 'UTC', 90, 587, '*')
ON CONFLICT (id) DO NOTHING;


-- ============================================================================
-- 3. API GROUPS TABLE
-- ============================================================================
-- Stores API groups for organizing monitored services
CREATE TABLE IF NOT EXISTS api_groups (
  id SERIAL PRIMARY KEY,
  name VARCHAR(255) NOT NULL UNIQUE,
  description TEXT,
  display_order INTEGER DEFAULT 0,
  is_collapsed BOOLEAN DEFAULT FALSE,
  is_default BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_api_groups_display_order ON api_groups(display_order);
CREATE INDEX IF NOT EXISTS idx_api_groups_name ON api_groups(name);
CREATE INDEX IF NOT EXISTS idx_api_groups_is_default ON api_groups(is_default);

-- Insert default group with fixed ID
-- Using ON CONFLICT DO NOTHING on id to allow safe re-runs
INSERT INTO api_groups (id, name, description, display_order, is_collapsed, is_default)
VALUES (1, 'Ungrouped', 'APIs without a specific group', 999, FALSE, TRUE)
ON CONFLICT (id) DO NOTHING;

-- Set the sequence to start from 2 to avoid conflicts with the default group
SELECT setval('api_groups_id_seq', (SELECT GREATEST(2, MAX(id) + 1) FROM api_groups), false);


-- ============================================================================
-- 4. APIS TABLE
-- ============================================================================
-- Stores all APIs/services being monitored
CREATE TABLE IF NOT EXISTS apis (
  id SERIAL PRIMARY KEY,
  name VARCHAR(255) NOT NULL,
  url TEXT NOT NULL,
  monitoring_interval INTEGER DEFAULT 60, -- seconds
  expected_status_code INTEGER DEFAULT 200,
  timeout_duration INTEGER DEFAULT 30000, -- milliseconds
  failure_threshold INTEGER DEFAULT 2, -- consecutive failed checks before an incident
  is_active BOOLEAN DEFAULT TRUE,
  is_public BOOLEAN DEFAULT TRUE, -- visible on public status page
  is_critical BOOLEAN DEFAULT FALSE, -- downtime triggers a repeating loud phone alarm
  alert_targets TEXT, -- comma-separated HA notify targets; NULL/empty = global list
  display_order INTEGER DEFAULT 0, -- for custom ordering on status page
  group_id INTEGER REFERENCES api_groups(id) ON DELETE SET NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_apis_is_active ON apis(is_active);
CREATE INDEX IF NOT EXISTS idx_apis_name ON apis(name);
CREATE INDEX IF NOT EXISTS idx_apis_display_order ON apis(display_order);
CREATE INDEX IF NOT EXISTS idx_apis_is_public ON apis(is_public);
CREATE INDEX IF NOT EXISTS idx_apis_is_critical ON apis(is_critical);
CREATE INDEX IF NOT EXISTS idx_apis_group_id ON apis(group_id);

-- Column comments for documentation
COMMENT ON COLUMN apis.is_public IS 'Whether the API is visible on public status page (true) or only to logged-in admins (false)';
COMMENT ON COLUMN apis.display_order IS 'Order in which APIs appear on the status page (lower numbers first)';
COMMENT ON COLUMN apis.group_id IS 'Foreign key to api_groups table for organizing APIs into groups';
COMMENT ON COLUMN apis.failure_threshold IS 'Consecutive failed checks before an incident is raised (1-10, default 2)';


-- ============================================================================
-- 5. PING LOGS TABLE
-- ============================================================================
-- Stores all ping/health check results
CREATE TABLE IF NOT EXISTS ping_logs (
  id SERIAL PRIMARY KEY,
  api_id INTEGER REFERENCES apis(id) ON DELETE CASCADE,
  status VARCHAR(20) NOT NULL, -- 'success', 'failure', 'timeout'
  status_code INTEGER,
  response_time INTEGER, -- milliseconds
  error_message TEXT,
  response_body TEXT, -- Full response body when ping fails (truncated to 50KB max)
  response_headers JSONB, -- HTTP response headers as JSON when ping fails
  pinged_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Indexes for efficient querying
CREATE INDEX IF NOT EXISTS idx_ping_logs_api_id ON ping_logs(api_id);
CREATE INDEX IF NOT EXISTS idx_ping_logs_pinged_at ON ping_logs(pinged_at);
CREATE INDEX IF NOT EXISTS idx_ping_logs_api_pinged ON ping_logs(api_id, pinged_at DESC);

-- Column comments for documentation
COMMENT ON COLUMN ping_logs.response_body IS 'Full response body text when ping fails (truncated to 50KB max)';
COMMENT ON COLUMN ping_logs.response_headers IS 'HTTP response headers as JSON when ping fails';


-- ============================================================================
-- 6. INCIDENTS TABLE
-- ============================================================================
-- Tracks downtime incidents for each API
CREATE TABLE IF NOT EXISTS incidents (
  id SERIAL PRIMARY KEY,
  api_id INTEGER REFERENCES apis(id) ON DELETE CASCADE,
  title VARCHAR(255) NOT NULL,
  description TEXT,
  status VARCHAR(50) DEFAULT 'ongoing', -- 'ongoing', 'identified', 'monitoring', 'resolved'
  status_code INTEGER, -- HTTP status code that caused the incident (null for timeouts/connection failures)
  started_at TIMESTAMP NOT NULL,
  resolved_at TIMESTAMP,

  -- Critical Phone Alarm state (see migration 010).
  -- Kept in Postgres, not memory, so a pm2 restart cannot kill a live alarm.
  acknowledged_at TIMESTAMP,
  acknowledged_by VARCHAR(255), -- phone-tap | dashboard | auto-resolved | expired
  ack_token VARCHAR(64), -- authorises the public ack endpoint
  alarm_next_send_at TIMESTAMP, -- NULL means no alarm is active
  alarm_attempts INTEGER DEFAULT 0,
  alarm_stopped_reason VARCHAR(32), -- acknowledged | resolved | expired | disabled | all_silenced | no_targets
  silenced_devices JSONB DEFAULT '[]'::jsonb, -- devices that muted locally; repeater skips them
  alerted_devices JSONB DEFAULT '[]'::jsonb, -- devices this alarm actually reached; cleared from exactly these
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_incidents_api_id ON incidents(api_id);
CREATE INDEX IF NOT EXISTS idx_incidents_status ON incidents(status);
CREATE INDEX IF NOT EXISTS idx_incidents_started_at ON incidents(started_at DESC);
CREATE INDEX IF NOT EXISTS idx_incidents_alarm_next_send_at
  ON incidents(alarm_next_send_at)
  WHERE alarm_next_send_at IS NOT NULL;

-- Column comments for documentation
COMMENT ON COLUMN incidents.status IS 'Current incident status: ongoing, identified, monitoring, or resolved';


-- ============================================================================
-- 7. UPTIME SUMMARIES TABLE
-- ============================================================================
-- Pre-calculated uptime statistics for different time periods
CREATE TABLE IF NOT EXISTS uptime_summaries (
  id SERIAL PRIMARY KEY,
  api_id INTEGER REFERENCES apis(id) ON DELETE CASCADE,
  period VARCHAR(20) NOT NULL, -- '24h', '7d', '30d', '90d'
  uptime_percentage DECIMAL(5,2),
  total_pings INTEGER,
  successful_pings INTEGER,
  failed_pings INTEGER,
  avg_response_time INTEGER,
  calculated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,

  -- Ensure only one summary per API per period
  UNIQUE(api_id, period)
);

-- Index for fast lookups
CREATE INDEX IF NOT EXISTS idx_uptime_summaries_api_period ON uptime_summaries(api_id, period);


-- ============================================================================
-- 8. WEBHOOK LOGS TABLE
-- ============================================================================
-- Audit trail for all webhook deliveries
CREATE TABLE IF NOT EXISTS webhook_logs (
  id SERIAL PRIMARY KEY,
  webhook_url TEXT NOT NULL,
  event_type VARCHAR(50) NOT NULL, -- 'api_down', 'api_up'
  api_id INTEGER REFERENCES apis(id) ON DELETE CASCADE,
  incident_id INTEGER REFERENCES incidents(id) ON DELETE SET NULL,
  payload JSONB NOT NULL,
  status_code INTEGER,
  success BOOLEAN NOT NULL,
  error_message TEXT,
  response_time INTEGER, -- milliseconds
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Indexes for common queries
CREATE INDEX IF NOT EXISTS idx_webhook_logs_api_id ON webhook_logs(api_id);
CREATE INDEX IF NOT EXISTS idx_webhook_logs_created_at ON webhook_logs(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_webhook_logs_success ON webhook_logs(success);
CREATE INDEX IF NOT EXISTS idx_webhook_logs_event_type ON webhook_logs(event_type);


-- ============================================================================
-- SEED DATA
-- ============================================================================
-- Initial data for first-time setup
-- ============================================================================

-- ============================================================================
-- DEFAULT ADMIN USER
-- ============================================================================
-- The first admin user is automatically created on server startup
-- from the ADMIN_EMAIL environment variable (set in backend/.env).
-- No manual SQL editing is needed.
-- ============================================================================


-- ============================================================================
-- SAMPLE APIS (Optional - for testing)
-- ============================================================================
-- These are sample APIs to demonstrate the monitoring functionality
-- You can delete these and add your own APIs through the admin dashboard

INSERT INTO apis (name, url, expected_status_code, is_active) VALUES
  ('Google Homepage', 'https://www.google.com', 200, TRUE),
  ('GitHub API', 'https://api.github.com', 200, TRUE),
  ('JSONPlaceholder API', 'https://jsonplaceholder.typicode.com/posts/1', 200, TRUE)
ON CONFLICT DO NOTHING;


-- ============================================================================
-- DATABASE SETUP COMPLETE
-- ============================================================================
-- Your Status Monitor database is now ready to use!
--
-- Next steps:
-- 1. Set ADMIN_EMAIL in backend/.env to your Google account email
-- 2. Start the backend server: cd backend && npm run dev
-- 3. Start the frontend: cd frontend && npm run dev
-- 4. Login at http://localhost:5173/admin/login using Google SSO
-- ============================================================================
