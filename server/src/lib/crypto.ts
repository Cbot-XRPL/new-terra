// Symmetric encryption for at-rest secrets (currently QuickBooks tokens).
//
// Uses AES-256-GCM. Key comes from QB_ENCRYPTION_KEY (32 random bytes,
// base64-encoded). When the env var isn't set we fall back to deriving from
// JWT_SECRET via SHA-256 — fine for local dev, but production should set
// QB_ENCRYPTION_KEY so token rotation is independent of session signing.
//
// Stored format is `gcm:<iv-b64>:<ciphertext+tag-b64>`. The `gcm:` prefix
// lets us migrate to a new algorithm later by checking the prefix at decrypt
// time instead of guessing.

import crypto from 'node:crypto';

const ALGO = 'aes-256-gcm';
const PREFIX = 'gcm:';
const IV_BYTES = 12; // GCM standard
const TAG_BYTES = 16;

function loadKey(): Buffer {
  const env = process.env.QB_ENCRYPTION_KEY;
  if (env) {
    const buf = Buffer.from(env, 'base64');
    if (buf.length !== 32) {
      throw new Error('QB_ENCRYPTION_KEY must decode to 32 bytes (base64).');
    }
    return buf;
  }
  if (!process.env.JWT_SECRET) {
    throw new Error('Either QB_ENCRYPTION_KEY or JWT_SECRET must be set');
  }
  return crypto.createHash('sha256').update(process.env.JWT_SECRET).digest();
}

export function encryptString(plain: string): string {
  if (plain == null) return plain;
  const key = loadKey();
  const iv = crypto.randomBytes(IV_BYTES);
  const cipher = crypto.createCipheriv(ALGO, key, iv);
  const enc = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${PREFIX}${iv.toString('base64')}:${Buffer.concat([enc, tag]).toString('base64')}`;
}

export function decryptString(stored: string): string {
  if (!stored.startsWith(PREFIX)) {
    // Legacy plaintext value — return as-is so we don't crash on existing
    // rows that pre-date encryption. The next write will encrypt.
    return stored;
  }
  const [, ivB64, payloadB64] = stored.split(':');
  if (!ivB64 || !payloadB64) throw new Error('Malformed encrypted blob');
  const key = loadKey();
  const iv = Buffer.from(ivB64, 'base64');
  const payload = Buffer.from(payloadB64, 'base64');
  const enc = payload.subarray(0, payload.length - TAG_BYTES);
  const tag = payload.subarray(payload.length - TAG_BYTES);
  const decipher = crypto.createDecipheriv(ALGO, key, iv);
  decipher.setAuthTag(tag);
  const dec = Buffer.concat([decipher.update(enc), decipher.final()]);
  return dec.toString('utf8');
}

/** Returns true if the stored value is in the encrypted format. */
export function isEncrypted(stored: string): boolean {
  return typeof stored === 'string' && stored.startsWith(PREFIX);
}
