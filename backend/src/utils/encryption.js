import crypto from 'crypto';

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 16;
const AUTH_TAG_LENGTH = 16;
const PREFIX = 'enc:';

function getEncryptionKey() {
  const key = process.env.ENCRYPTION_KEY;
  if (!key) return null;
  // Derive a 32-byte key from whatever the user provides
  return crypto.createHash('sha256').update(key).digest();
}

/**
 * Encrypt a plaintext string. Returns prefixed ciphertext.
 * If ENCRYPTION_KEY is not set, returns plaintext as-is.
 */
export function encrypt(plaintext) {
  if (!plaintext) return plaintext;
  const key = getEncryptionKey();
  if (!key) return plaintext;

  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv);
  let encrypted = cipher.update(plaintext, 'utf8', 'hex');
  encrypted += cipher.final('hex');
  const authTag = cipher.getAuthTag().toString('hex');

  return `${PREFIX}${iv.toString('hex')}:${authTag}:${encrypted}`;
}

/**
 * Decrypt a string. If it doesn't have the enc: prefix, returns as-is (plaintext).
 * On decryption failure (wrong key), returns null.
 */
export function decrypt(ciphertext) {
  if (!ciphertext) return ciphertext;
  if (!ciphertext.startsWith(PREFIX)) return ciphertext; // plaintext, return as-is

  const key = getEncryptionKey();
  if (!key) return null; // encrypted but no key available

  try {
    const parts = ciphertext.slice(PREFIX.length).split(':');
    if (parts.length !== 3) return null;

    const [ivHex, authTagHex, encrypted] = parts;
    const iv = Buffer.from(ivHex, 'hex');
    const authTag = Buffer.from(authTagHex, 'hex');
    const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
    decipher.setAuthTag(authTag);
    let decrypted = decipher.update(encrypted, 'hex', 'utf8');
    decrypted += decipher.final('utf8');
    return decrypted;
  } catch {
    return null;
  }
}
