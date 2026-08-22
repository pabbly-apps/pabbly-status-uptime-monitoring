-- ============================================================================
-- Migration 010: Critical Phone Alarm
-- ============================================================================
-- Description: Adds an opt-in "critical" flag per API. When a critical API goes
--              down, a loud phone alarm is pushed via Home Assistant (iOS
--              Critical Alerts + Android alarm_stream_max) and repeated every
--              N seconds until each responder silences it on their own phone,
--              the service recovers, or a maximum duration elapses.
--
--              Each API can route to a specific set of phones, so one project's
--              outage never wakes another project's team. There is deliberately
--              no fallback to "alert everyone": if an API's routed devices are
--              all gone, it alarms nobody and logs an error, and the admin is
--              warned at save time before that state can be reached.
--
--              Idempotent and non-destructive. is_critical and
--              critical_alert_enabled both default to FALSE, so existing
--              deployments behave exactly as before until explicitly opted in.
-- Date: 2026-08-22
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. APIs: opt-in flag and per-API routing
-- ---------------------------------------------------------------------------
ALTER TABLE apis
ADD COLUMN IF NOT EXISTS is_critical BOOLEAN DEFAULT FALSE,
ADD COLUMN IF NOT EXISTS alert_targets TEXT;

UPDATE apis SET is_critical = FALSE WHERE is_critical IS NULL;

COMMENT ON COLUMN apis.is_critical IS 'When true, downtime triggers a repeating loud phone alarm';
COMMENT ON COLUMN apis.alert_targets IS 'Comma-separated HA notify targets to alarm for this API; NULL/empty falls back to the global list';

CREATE INDEX IF NOT EXISTS idx_apis_is_critical ON apis(is_critical);

-- ---------------------------------------------------------------------------
-- 2. Incidents: alarm scheduling and per-device response state
-- ---------------------------------------------------------------------------
-- Stored in Postgres (not memory) so a pm2 restart cannot silently kill a
-- live alarm — the exact failure mode this feature exists to prevent.
ALTER TABLE incidents
ADD COLUMN IF NOT EXISTS acknowledged_at TIMESTAMP,
ADD COLUMN IF NOT EXISTS acknowledged_by VARCHAR(255),
ADD COLUMN IF NOT EXISTS ack_token VARCHAR(64),
ADD COLUMN IF NOT EXISTS alarm_next_send_at TIMESTAMP,
ADD COLUMN IF NOT EXISTS alarm_attempts INTEGER DEFAULT 0,
ADD COLUMN IF NOT EXISTS alarm_stopped_reason VARCHAR(32),
ADD COLUMN IF NOT EXISTS silenced_devices JSONB DEFAULT '[]'::jsonb,
ADD COLUMN IF NOT EXISTS alerted_devices JSONB DEFAULT '[]'::jsonb;

UPDATE incidents SET alarm_attempts = 0 WHERE alarm_attempts IS NULL;
UPDATE incidents SET silenced_devices = '[]'::jsonb WHERE silenced_devices IS NULL;
UPDATE incidents SET alerted_devices = '[]'::jsonb WHERE alerted_devices IS NULL;

COMMENT ON COLUMN incidents.acknowledged_at IS 'When the alarm stopped being someone''s to answer';
COMMENT ON COLUMN incidents.acknowledged_by IS 'How it ended: phone-tap, auto-resolved, or expired';
COMMENT ON COLUMN incidents.ack_token IS 'Random single-purpose token authorising the public responder endpoint';
COMMENT ON COLUMN incidents.alarm_next_send_at IS 'Next scheduled alarm push; NULL means no alarm is active';
COMMENT ON COLUMN incidents.alarm_attempts IS 'Number of alarm pushes sent so far for this incident';
COMMENT ON COLUMN incidents.alarm_stopped_reason IS 'Why the alarm stopped: resolved, expired, disabled, all_silenced, or no_targets';
COMMENT ON COLUMN incidents.silenced_devices IS 'Devices that muted this alarm locally; the repeater skips them';
COMMENT ON COLUMN incidents.alerted_devices IS 'Devices this alarm actually reached; notifications are cleared from exactly these';

-- Partial index: the repeater polls this every few seconds, and only ever
-- cares about the handful of rows with an armed alarm.
CREATE INDEX IF NOT EXISTS idx_incidents_alarm_next_send_at
  ON incidents(alarm_next_send_at)
  WHERE alarm_next_send_at IS NOT NULL;

-- ---------------------------------------------------------------------------
-- 3. Home Assistant push gateway settings (global)
-- ---------------------------------------------------------------------------
ALTER TABLE system_settings
ADD COLUMN IF NOT EXISTS ha_base_url TEXT,
ADD COLUMN IF NOT EXISTS ha_token TEXT,
ADD COLUMN IF NOT EXISTS ha_notify_targets TEXT,
ADD COLUMN IF NOT EXISTS critical_alert_enabled BOOLEAN DEFAULT FALSE,
ADD COLUMN IF NOT EXISTS critical_alert_repeat_seconds INTEGER DEFAULT 30,
ADD COLUMN IF NOT EXISTS critical_alert_max_minutes INTEGER DEFAULT 15;

UPDATE system_settings SET critical_alert_enabled = FALSE WHERE critical_alert_enabled IS NULL;
UPDATE system_settings SET critical_alert_repeat_seconds = 30 WHERE critical_alert_repeat_seconds IS NULL;
UPDATE system_settings SET critical_alert_max_minutes = 15 WHERE critical_alert_max_minutes IS NULL;

COMMENT ON COLUMN system_settings.ha_base_url IS 'Home Assistant base URL, e.g. https://ha.example.com';
COMMENT ON COLUMN system_settings.ha_token IS 'HA long-lived access token (AES-256-GCM encrypted when ENCRYPTION_KEY is set)';
COMMENT ON COLUMN system_settings.ha_notify_targets IS 'Comma-separated HA notify services, optionally labelled: mobile_app_pixel:Ravi (Pixel)';
COMMENT ON COLUMN system_settings.critical_alert_repeat_seconds IS 'Seconds between repeat alarm pushes (10-300)';
COMMENT ON COLUMN system_settings.critical_alert_max_minutes IS 'Give up repeating after this many minutes (1-120)';

-- ============================================================================
-- Migration completed successfully
-- ============================================================================
