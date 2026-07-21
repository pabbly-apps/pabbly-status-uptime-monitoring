-- ============================================================================
-- Migration 009: Add Per-API Failure Threshold
-- ============================================================================
-- Description: Re-introduces a single per-API column, failure_threshold, so the
--              number of consecutive failed checks before an incident is raised
--              can be tuned per endpoint from the Admin UI. Idempotent and
--              non-destructive; the default (2) preserves existing behaviour.
--              (Retry count / delay are intentionally NOT re-added.)
-- Date: 2026-07-21
-- ============================================================================

ALTER TABLE apis
ADD COLUMN IF NOT EXISTS failure_threshold INTEGER DEFAULT 2;

-- Backfill any rows that somehow have NULL (defensive; Postgres applies the
-- DEFAULT to existing rows automatically on ADD COLUMN).
UPDATE apis SET failure_threshold = 2 WHERE failure_threshold IS NULL;

COMMENT ON COLUMN apis.failure_threshold IS 'Consecutive failed checks before an incident is raised (1-10, default 2)';

-- ============================================================================
-- Migration completed successfully
-- ============================================================================
