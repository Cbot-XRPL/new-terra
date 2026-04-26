import { describe, expect, it, beforeAll } from 'vitest';
import { decryptString, encryptString, isEncrypted } from './crypto.js';

beforeAll(() => {
  // Ensure we have a key available for the round-trip tests; vitest does not
  // auto-load .env. The default falls back to JWT_SECRET hashing, which is
  // also covered below.
  process.env.JWT_SECRET = process.env.JWT_SECRET ?? 'test-jwt-secret-vitest-only';
});

describe('crypto.encryptString / decryptString', () => {
  it('round-trips ASCII text', () => {
    const enc = encryptString('hello world');
    expect(enc).toMatch(/^gcm:/);
    expect(isEncrypted(enc)).toBe(true);
    expect(decryptString(enc)).toBe('hello world');
  });

  it('round-trips Unicode + multi-line text', () => {
    const plaintext = 'line 1\nline 2 — with em-dash\nline 3 émoji 🚀';
    expect(decryptString(encryptString(plaintext))).toBe(plaintext);
  });

  it('produces different ciphertexts for the same plaintext (random IV)', () => {
    const a = encryptString('same');
    const b = encryptString('same');
    expect(a).not.toBe(b);
    expect(decryptString(a)).toBe('same');
    expect(decryptString(b)).toBe('same');
  });

  it('passes through legacy plaintext rows unchanged (migration safety)', () => {
    expect(decryptString('this-is-not-encrypted')).toBe('this-is-not-encrypted');
    expect(isEncrypted('this-is-not-encrypted')).toBe(false);
  });

  it('rejects truncated ciphertext', () => {
    const enc = encryptString('hello');
    const truncated = enc.slice(0, enc.length - 10);
    expect(() => decryptString(truncated)).toThrow();
  });
});
