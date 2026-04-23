-- Add webhook_secret column for HMAC signature on outgoing webhooks
ALTER TABLE system_settings ADD COLUMN IF NOT EXISTS webhook_secret TEXT;
