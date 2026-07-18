-- ============================================================================
-- Migration 008: Add Per-API Monitoring Retry Configuration
-- ============================================================================
-- Description: Adds per-API retry/backoff/failure-threshold columns to the apis
--              table so the monitor can tolerate transient connection-level
--              packet loss. Values are editable from the Admin UI. Defaults
--              preserve today's behaviour exactly (retry once, 1s base delay,
--              2 consecutive failures before an incident).
-- Date: 2026-07-17
-- ============================================================================

-- Additional retries on connection-level failure (DNS/TCP/TLS/timeout)
ALTER TABLE apis
ADD COLUMN IF NOT EXISTS retry_count INTEGER DEFAULT 1;

-- Base backoff delay in ms; doubles each retry (baseDelay, baseDelay*2, ...)
ALTER TABLE apis
ADD COLUMN IF NOT EXISTS retry_delay_ms INTEGER DEFAULT 1000;

-- Consecutive failed checks before an incident is raised
ALTER TABLE apis
ADD COLUMN IF NOT EXISTS failure_threshold INTEGER DEFAULT 2;

-- Backfill any pre-existing rows that somehow have NULLs (defensive; Postgres
-- already applies the DEFAULT to existing rows on ADD COLUMN).
UPDATE apis SET retry_count = 1        WHERE retry_count IS NULL;
UPDATE apis SET retry_delay_ms = 1000  WHERE retry_delay_ms IS NULL;
UPDATE apis SET failure_threshold = 2  WHERE failure_threshold IS NULL;

-- Documentation
COMMENT ON COLUMN apis.retry_count       IS 'Additional retries on connection-level failure (0-5)';
COMMENT ON COLUMN apis.retry_delay_ms    IS 'Base backoff delay in ms, doubles each retry (100-30000)';
COMMENT ON COLUMN apis.failure_threshold IS 'Consecutive failed checks before an incident (1-10)';

-- ============================================================================
-- Migration completed successfully
-- ============================================================================
