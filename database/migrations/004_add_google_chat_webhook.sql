-- ============================================================================
-- Migration 004: Add Google Chat Webhook Settings
-- ============================================================================
-- Description: Adds google_chat_webhook_url and google_chat_webhook_enabled
--              columns to system_settings for direct Google Chat notifications
-- Date: 2026-02-18
-- ============================================================================

ALTER TABLE system_settings
ADD COLUMN IF NOT EXISTS google_chat_webhook_url TEXT,
ADD COLUMN IF NOT EXISTS google_chat_webhook_enabled BOOLEAN DEFAULT FALSE;

-- ============================================================================
-- Migration completed successfully
-- ============================================================================
