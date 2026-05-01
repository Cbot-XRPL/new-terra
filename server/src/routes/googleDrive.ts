// Per-user Google Drive OAuth connection. Admin clicks "Connect" in
// settings → we redirect them through Google's consent screen with
// drive.readonly + offline_access → callback exchanges the code, stores
// access + refresh tokens, and bounces them back to the admin page.
//
// Once connected, the AI tools (added separately) can read files from
// the user's Drive on their behalf using the stored refresh token.

import { Router } from 'express';
import { Role } from '@prisma/client';
import { prisma } from '../db.js';
import { requireAuth, requireRole } from '../middleware/auth.js';
import { env } from '../env.js';
import { audit } from '../lib/audit.js';
import {
  DRIVE_SCOPES,
  buildAuthorizeUrl,
  driveRedirectUri,
  exchangeCode,
  fetchUserInfo,
  isConfigured as isGoogleConfigured,
  signState,
  verifyState,
} from '../lib/googleOauth.js';

const router = Router();

// All endpoints require the caller to be an authenticated admin.
router.use(requireAuth, requireRole(Role.ADMIN));

router.get('/status', async (req, res, next) => {
  try {
    if (!isGoogleConfigured()) {
      return res.json({ configured: false, connected: false });
    }
    const conn = await (prisma as any).googleDriveConnection.findUnique({
      where: { userId: req.user!.sub },
      select: { googleEmail: true, googleName: true, createdAt: true, updatedAt: true },
    });
    res.json({
      configured: true,
      connected: !!conn,
      connection: conn,
    });
  } catch (err) {
    next(err);
  }
});

router.get('/connect', (req, res) => {
  if (!isGoogleConfigured()) {
    return res.status(503).json({ error: 'Google integration is not configured.' });
  }
  const state = signState({ kind: 'drive', userId: req.user!.sub });
  const url = buildAuthorizeUrl({
    redirectUri: driveRedirectUri(),
    scope: DRIVE_SCOPES,
    state,
    offlineAccess: true,
  });
  res.json({ url });
});

// Note: callback is the only endpoint here that bypasses requireAuth
// because Google's redirect arrives without our session cookie. We
// instead trust the signed `state` JWT (kind=drive, userId=...) — the
// state's userId tells us whose connection to write.
router.get('/callback', async (req, res, next) => {
  try {
    const code = typeof req.query.code === 'string' ? req.query.code : null;
    const state = typeof req.query.state === 'string' ? req.query.state : null;
    if (!code || !state) {
      return res.redirect(`${env.appUrl}/portal/admin?drive_error=missing_params`);
    }
    let stateData;
    try {
      stateData = verifyState(state, 'drive');
    } catch {
      return res.redirect(`${env.appUrl}/portal/admin?drive_error=bad_state`);
    }
    if (!stateData.userId) {
      return res.redirect(`${env.appUrl}/portal/admin?drive_error=missing_user`);
    }
    const me = await prisma.user.findUnique({ where: { id: stateData.userId } });
    if (!me || me.role !== Role.ADMIN) {
      return res.redirect(`${env.appUrl}/portal/admin?drive_error=forbidden`);
    }

    const tokens = await exchangeCode({ code, redirectUri: driveRedirectUri() });
    if (!tokens.refresh_token) {
      // Shouldn't happen because we pass prompt=consent, but if Google
      // doesn't return a refresh token we can't store a reusable
      // connection. Bail with a clear error.
      return res.redirect(
        `${env.appUrl}/portal/admin?drive_error=no_refresh_token`,
      );
    }
    const profile = await fetchUserInfo(tokens.access_token);
    const expiresAt = new Date(Date.now() + tokens.expires_in * 1000);

    await (prisma as any).googleDriveConnection.upsert({
      where: { userId: me.id },
      create: {
        userId: me.id,
        googleEmail: profile.email,
        googleName: profile.name ?? null,
        accessToken: tokens.access_token,
        refreshToken: tokens.refresh_token,
        expiresAt,
        scope: tokens.scope,
      },
      update: {
        googleEmail: profile.email,
        googleName: profile.name ?? null,
        accessToken: tokens.access_token,
        refreshToken: tokens.refresh_token,
        expiresAt,
        scope: tokens.scope,
      },
    });

    await audit(req, {
      action: 'integrations.googleDrive.connect',
      resourceType: 'User',
      resourceId: me.id,
      meta: { googleEmail: profile.email },
    });

    return res.redirect(`${env.appUrl}/portal/admin?drive_connected=1`);
  } catch (err) {
    next(err);
  }
});

router.delete('/', async (req, res, next) => {
  try {
    await (prisma as any).googleDriveConnection.deleteMany({
      where: { userId: req.user!.sub },
    });
    await audit(req, {
      action: 'integrations.googleDrive.disconnect',
      resourceType: 'User',
      resourceId: req.user!.sub,
    });
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

export default router;
