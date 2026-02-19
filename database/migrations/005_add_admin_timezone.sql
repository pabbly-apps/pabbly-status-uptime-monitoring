-- ============================================================================
-- Migration 005: Add Admin Timezone Setting
-- ============================================================================
-- Description: Adds admin_timezone column to system_settings for controlling
--              how timestamps display on admin pages and in notifications
-- Date: 2026-02-19
-- ============================================================================

ALTER TABLE system_settings
ADD COLUMN IF NOT EXISTS admin_timezone VARCHAR(50) DEFAULT 'UTC';

-- ============================================================================
-- Migration completed successfully
-- ============================================================================
