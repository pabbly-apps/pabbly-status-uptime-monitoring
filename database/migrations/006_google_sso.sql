-- ============================================================================
-- Migration 006: Google SSO Support
-- ============================================================================
-- Description: Adds Google SSO columns (google_id, profile_picture, is_active)
--              to admin_user, makes password_hash nullable, and adds
--              allowed_domains to system_settings for domain restrictions.
-- Date: 2026-02-26
-- ============================================================================

-- Add google_id column for storing Google's unique sub identifier
ALTER TABLE admin_user
ADD COLUMN IF NOT EXISTS google_id VARCHAR(255) UNIQUE;

-- Add profile picture URL from Google
ALTER TABLE admin_user
ADD COLUMN IF NOT EXISTS profile_picture TEXT;

-- Add is_active column to enable/disable users without deleting
ALTER TABLE admin_user
ADD COLUMN IF NOT EXISTS is_active BOOLEAN DEFAULT TRUE;

-- Make password_hash nullable (Google SSO users won't have one)
ALTER TABLE admin_user
ALTER COLUMN password_hash DROP NOT NULL;

-- Index on google_id for fast lookups during SSO login
CREATE INDEX IF NOT EXISTS idx_admin_google_id ON admin_user(google_id);

-- Add added_by column to track who added each user
ALTER TABLE admin_user
ADD COLUMN IF NOT EXISTS added_by INTEGER REFERENCES admin_user(id) ON DELETE SET NULL;

-- Add allowed_domains column to system_settings
-- Comma-separated list of domains, '*' means all domains allowed
ALTER TABLE system_settings
ADD COLUMN IF NOT EXISTS allowed_domains TEXT DEFAULT '*';

-- ============================================================================
-- Migration completed successfully
-- ============================================================================
