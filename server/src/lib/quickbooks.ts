// QuickBooks Online integration. Add-on, not a dependency:
//
// - When the QB env vars are unset OR no QbConnection row is active, every
//   exported function returns a synthetic-success result tagged with
//   `stub: true`. Receipt entry, expense lists, and the rest of the app
//   are unaffected.
// - When a connection exists, we use the access token directly via fetch
//   (no SDK dep) and refresh as needed.
//
// The tokens are stored in plaintext on QbConnection. Migrate to KMS-
// encrypted columns before going to production.

import crypto from 'node:crypto';
import { prisma } from '../db.js';
import type { QbConnection } from '@prisma/client';
import { decryptString, encryptString } from './crypto.js';

const REQUIRED = ['QB_CLIENT_ID', 'QB_CLIENT_SECRET', 'QB_REDIRECT_URI'] as const;
const SANDBOX_API = 'https://sandbox-quickbooks.api.intuit.com/v3';
const PROD_API = 'https://quickbooks.api.intuit.com/v3';
const TOKEN_URL = 'https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer';
const AUTHORIZE_URL = 'https://appcenter.intuit.com/connect/oauth2';

export function isQbConfigured(): boolean {
  return REQUIRED.every((k) => !!process.env[k]);
}

function apiBase(): string {
  return process.env.QB_ENVIRONMENT === 'production' ? PROD_API : SANDBOX_API;
}

/** Returns the most-recently-updated stored connection, or null. */
export async function getActiveConnection(): Promise<QbConnection | null> {
  return prisma.qbConnection.findFirst({ orderBy: { updatedAt: 'desc' } });
}

/** Build the Intuit authorize URL with a state nonce stored against the
 *  caller. The caller is responsible for stashing the nonce server-side
 *  (we use the userId for the smoke test; production should bind it to a
 *  short-lived signed cookie). */
export function buildAuthorizeUrl(state: string): string {
  if (!isQbConfigured()) {
    throw new Error('QuickBooks credentials are not configured');
  }
  const params = new URLSearchParams({
    client_id: process.env.QB_CLIENT_ID!,
    response_type: 'code',
    scope: 'com.intuit.quickbooks.accounting',
    redirect_uri: process.env.QB_REDIRECT_URI!,
    state,
  });
  return `${AUTHORIZE_URL}?${params.toString()}`;
}

interface TokenResponse {
  access_token: string;
  refresh_token: string;
  expires_in: number;
  x_refresh_token_expires_in: number;
  token_type: string;
  scope?: string;
}

async function postToToken(body: URLSearchParams): Promise<TokenResponse> {
  const auth = Buffer.from(
    `${process.env.QB_CLIENT_ID}:${process.env.QB_CLIENT_SECRET}`,
  ).toString('base64');
  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: {
      Authorization: `Basic ${auth}`,
      'Content-Type': 'application/x-www-form-urlencoded',
      Accept: 'application/json',
    },
    body,
  });
  const text = await res.text();
  if (!res.ok) {
    throw new Error(`Intuit token endpoint ${res.status}: ${text}`);
  }
  return JSON.parse(text) as TokenResponse;
}

/** Exchange an authorization code for tokens; persist a QbConnection. */
export async function exchangeCode(input: {
  code: string;
  realmId: string;
  connectedById?: string;
}): Promise<QbConnection> {
  if (!isQbConfigured()) {
    throw new Error('QuickBooks credentials are not configured');
  }
  const body = new URLSearchParams({
    grant_type: 'authorization_code',
    code: input.code,
    redirect_uri: process.env.QB_REDIRECT_URI!,
  });
  const tokens = await postToToken(body);
  const now = Date.now();

  // Replace any prior connection for this realm so we always have one
  // active record per QuickBooks company.
  return prisma.qbConnection.upsert({
    where: { realmId: input.realmId },
    create: {
      realmId: input.realmId,
      accessToken: encryptString(tokens.access_token),
      refreshToken: encryptString(tokens.refresh_token),
      accessTokenExpiresAt: new Date(now + tokens.expires_in * 1000),
      refreshTokenExpiresAt: new Date(now + tokens.x_refresh_token_expires_in * 1000),
      scope: tokens.scope ?? null,
      connectedById: input.connectedById ?? null,
    },
    update: {
      accessToken: encryptString(tokens.access_token),
      refreshToken: encryptString(tokens.refresh_token),
      accessTokenExpiresAt: new Date(now + tokens.expires_in * 1000),
      refreshTokenExpiresAt: new Date(now + tokens.x_refresh_token_expires_in * 1000),
      scope: tokens.scope ?? null,
      connectedById: input.connectedById ?? null,
      lastError: null,
    },
  });
}

async function refreshIfNeeded(connection: QbConnection): Promise<QbConnection> {
  // Refresh proactively once we're inside the last minute of validity.
  if (connection.accessTokenExpiresAt.getTime() - Date.now() > 60_000) {
    return connection;
  }
  if (!isQbConfigured()) {
    throw new Error('QuickBooks credentials are not configured');
  }
  const body = new URLSearchParams({
    grant_type: 'refresh_token',
    refresh_token: decryptString(connection.refreshToken),
  });
  const tokens = await postToToken(body);
  const now = Date.now();
  return prisma.qbConnection.update({
    where: { id: connection.id },
    data: {
      accessToken: encryptString(tokens.access_token),
      refreshToken: encryptString(tokens.refresh_token),
      accessTokenExpiresAt: new Date(now + tokens.expires_in * 1000),
      refreshTokenExpiresAt: new Date(now + tokens.x_refresh_token_expires_in * 1000),
    },
  });
}

async function qbFetch<T>(
  connection: QbConnection,
  pathAndQuery: string,
  init: RequestInit = {},
): Promise<T> {
  const fresh = await refreshIfNeeded(connection);
  const url = `${apiBase()}/company/${fresh.realmId}${pathAndQuery}`;
  const res = await fetch(url, {
    ...init,
    headers: {
      Authorization: `Bearer ${decryptString(fresh.accessToken)}`,
      Accept: 'application/json',
      'Content-Type': 'application/json',
      ...(init.headers ?? {}),
    },
  });
  const text = await res.text();
  if (!res.ok) {
    throw new Error(`QuickBooks ${pathAndQuery} ${res.status}: ${text.slice(0, 500)}`);
  }
  return text ? (JSON.parse(text) as T) : ({} as T);
}

export interface PushResult {
  ok: true;
  qbId: string;
  stub: boolean;
}

export interface PushFailure {
  ok: false;
  error: string;
}

/** Create or look up a QB Vendor. Stub mode returns a synthetic id so the
 *  rest of the sync flow stays exercised without a live connection. */
export async function pushVendor(input: { name: string }): Promise<PushResult | PushFailure> {
  const connection = await getActiveConnection();
  if (!isQbConfigured() || !connection) {
    return {
      ok: true,
      qbId: `stub-vendor-${crypto.randomBytes(6).toString('hex')}`,
      stub: true,
    };
  }
  try {
    const created = await qbFetch<{ Vendor: { Id: string } }>(
      connection,
      '/vendor?minorversion=70',
      {
        method: 'POST',
        body: JSON.stringify({ DisplayName: input.name }),
      },
    );
    return { ok: true, qbId: created.Vendor.Id, stub: false };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : 'unknown error' };
  }
}

export interface PushExpenseInput {
  amountCents: number;
  date: Date;
  description?: string | null;
  vendorQbId?: string | null;
  // Account / category mapping. When null we let QB pick a default Expenses
  // account on the receiving side; production should always map this.
  accountQbId?: string | null;
  // Free-text memo with our internal id so it's reconcilable from QB.
  memo?: string | null;
}

export async function pushExpense(input: PushExpenseInput): Promise<PushResult | PushFailure> {
  const connection = await getActiveConnection();
  if (!isQbConfigured() || !connection) {
    return {
      ok: true,
      qbId: `stub-purchase-${crypto.randomBytes(6).toString('hex')}`,
      stub: true,
    };
  }
  try {
    const dollars = (input.amountCents / 100).toFixed(2);
    // We push as a Purchase with PaymentType=Cash because that round-trips
    // most cleanly without picking a bank account on the QB side. PMs paid
    // out of pocket can be flipped to PaymentType=CreditCard later.
    const payload: Record<string, unknown> = {
      AccountRef: { value: input.accountQbId ?? '7' }, // 7 is QB's default Expenses
      PaymentType: 'Cash',
      TxnDate: input.date.toISOString().slice(0, 10),
      TotalAmt: Number(dollars),
      Line: [
        {
          Amount: Number(dollars),
          DetailType: 'AccountBasedExpenseLineDetail',
          AccountBasedExpenseLineDetail: {
            AccountRef: { value: input.accountQbId ?? '7' },
          },
          Description: input.description ?? '',
        },
      ],
      ...(input.vendorQbId ? { EntityRef: { value: input.vendorQbId, type: 'Vendor' } } : {}),
      ...(input.memo ? { PrivateNote: input.memo } : {}),
    };
    const created = await qbFetch<{ Purchase: { Id: string } }>(
      connection,
      '/purchase?minorversion=70',
      { method: 'POST', body: JSON.stringify(payload) },
    );
    return { ok: true, qbId: created.Purchase.Id, stub: false };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : 'unknown error' };
  }
}

export interface QbPurchaseSummary {
  Id: string;
  TxnDate?: string;
  TotalAmt?: number;
  EntityRef?: { name?: string; value?: string };
  PrivateNote?: string;
}

/** Pulls recent purchases from QB so the reconciliation panel can show
 *  the QB-side state alongside our local rows. Stub mode returns []. */
export async function fetchRecentPurchases(limit = 25): Promise<QbPurchaseSummary[]> {
  const connection = await getActiveConnection();
  if (!isQbConfigured() || !connection) return [];
  const query = encodeURIComponent(
    `select Id, TxnDate, TotalAmt, EntityRef, PrivateNote from Purchase order by MetaData.CreateTime desc maxresults ${limit}`,
  );
  const data = await qbFetch<{ QueryResponse: { Purchase?: QbPurchaseSummary[] } }>(
    connection,
    `/query?query=${query}&minorversion=70`,
  );
  return data.QueryResponse.Purchase ?? [];
}
