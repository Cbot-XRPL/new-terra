// Google OAuth 2.0 helpers shared by /api/auth/google (sign-in) and
// /api/integrations/google-drive (Drive connection). Both flows go
// through the same OAuth client; they only differ in which scopes
// they request and what they do with the resulting tokens.
//
// We use direct fetch instead of the `googleapis` package to keep the
// dep tree small — the OAuth surface is just two endpoints.

import jwt from 'jsonwebtoken';
import { env } from '../env.js';

const AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const USERINFO_URL = 'https://openidconnect.googleapis.com/v1/userinfo';

export const SIGN_IN_SCOPES = ['openid', 'email', 'profile'].join(' ');

// drive.readonly is sufficient for "AI moves files INTO our site" —
// we don't write back to the user's Drive. If we later want write
// access, swap to 'https://www.googleapis.com/auth/drive'.
export const DRIVE_SCOPES = [
  'openid',
  'email',
  'profile',
  'https://www.googleapis.com/auth/drive.readonly',
].join(' ');

export type StateKind = 'login' | 'drive';

export interface OauthState {
  kind: StateKind;
  // For drive flow: the userId that initiated the connect (must be
  // re-validated on callback so somebody can't trick another admin's
  // session into linking a Drive that isn't theirs).
  userId?: string;
  nonce: string;
  // ISO timestamp the state was minted — used to bound replay window.
  iat: number;
}

const STATE_MAX_AGE_MS = 10 * 60 * 1000; // 10 minutes

export function signState(payload: Omit<OauthState, 'nonce' | 'iat'>): string {
  const full: OauthState = {
    ...payload,
    nonce: Math.random().toString(36).slice(2),
    iat: Date.now(),
  };
  // Reuse JWT_SECRET — separate signing key would be nice but we
  // already trust this secret site-wide.
  return jwt.sign(full, env.jwtSecret);
}

export function verifyState(state: string, expectedKind: StateKind): OauthState {
  const decoded = jwt.verify(state, env.jwtSecret) as OauthState;
  if (decoded.kind !== expectedKind) {
    throw new Error('OAuth state kind mismatch');
  }
  if (Date.now() - decoded.iat > STATE_MAX_AGE_MS) {
    throw new Error('OAuth state expired');
  }
  return decoded;
}

export interface AuthorizeUrlInput {
  redirectUri: string;
  scope: string;
  state: string;
  // For Drive we want a refresh token (offline access). Sign-in
  // doesn't need one — we re-prompt on each login.
  offlineAccess?: boolean;
}

export function buildAuthorizeUrl(input: AuthorizeUrlInput): string {
  const params = new URLSearchParams({
    client_id: env.google.clientId,
    redirect_uri: input.redirectUri,
    response_type: 'code',
    scope: input.scope,
    state: input.state,
    include_granted_scopes: 'true',
  });
  if (input.offlineAccess) {
    params.set('access_type', 'offline');
    // `prompt=consent` forces Google to re-emit a refresh token even
    // if the user previously consented. Without this, returning users
    // get an access token but no refresh token, which breaks the
    // long-lived connection.
    params.set('prompt', 'consent');
  }
  return `${AUTH_URL}?${params.toString()}`;
}

export interface TokenResponse {
  access_token: string;
  expires_in: number;
  refresh_token?: string;
  scope: string;
  token_type: 'Bearer';
  id_token?: string;
}

export async function exchangeCode(input: {
  code: string;
  redirectUri: string;
}): Promise<TokenResponse> {
  const body = new URLSearchParams({
    code: input.code,
    client_id: env.google.clientId,
    client_secret: env.google.clientSecret,
    redirect_uri: input.redirectUri,
    grant_type: 'authorization_code',
  });
  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Google token exchange failed: ${res.status} ${text}`);
  }
  return (await res.json()) as TokenResponse;
}

export async function refreshAccessToken(refreshToken: string): Promise<TokenResponse> {
  const body = new URLSearchParams({
    refresh_token: refreshToken,
    client_id: env.google.clientId,
    client_secret: env.google.clientSecret,
    grant_type: 'refresh_token',
  });
  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Google token refresh failed: ${res.status} ${text}`);
  }
  return (await res.json()) as TokenResponse;
}

export interface GoogleUserInfo {
  // 'sub' is Google's stable per-user id — same across token refreshes
  // and email changes. Use it as the join key, not the email.
  sub: string;
  email: string;
  email_verified: boolean;
  name?: string;
  given_name?: string;
  family_name?: string;
  picture?: string;
}

export async function fetchUserInfo(accessToken: string): Promise<GoogleUserInfo> {
  const res = await fetch(USERINFO_URL, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Google userinfo failed: ${res.status} ${text}`);
  }
  return (await res.json()) as GoogleUserInfo;
}

// Compute the redirect URIs from APP_URL so dev and prod don't need
// separate env vars. APP_URL is usually the client URL; the OAuth
// callback hits the API server directly. In production both share the
// same host (https://app.newterraconstruction.com), so APP_URL works.
export function loginRedirectUri(): string {
  return new URL('/api/auth/google/callback', env.appUrl).toString();
}

export function driveRedirectUri(): string {
  return new URL('/api/integrations/google-drive/callback', env.appUrl).toString();
}

export function isConfigured(): boolean {
  return !!(env.google.clientId && env.google.clientSecret);
}
