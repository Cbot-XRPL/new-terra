// Plaid bank-feed connector for the Banking page. Mints a Link token
// from the server, opens the Plaid Link modal, then exchanges the public
// token. After connection, surfaces a connection list with sync + remove.
//
// When the server reports Plaid isn't configured (no PLAID_CLIENT_ID),
// renders a hint pointing to the Admin → Integrations checklist instead
// of an unusable Connect button.

import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { usePlaidLink } from 'react-plaid-link';
import { ApiError, api } from '../../lib/api';

interface PlaidConnection {
  id: string;
  institutionName: string | null;
  institutionId: string | null;
  accounts: Array<{ accountId: string; mask: string | null; name: string }> | null;
  lastSyncAt: string | null;
  lastSyncCount: number | null;
  lastError: string | null;
  createdAt: string;
}

interface StatusResponse {
  configured: boolean;
  connections: PlaidConnection[];
}

interface InnerProps {
  linkToken: string;
  onSuccess: (publicToken: string, metadata: { institution_id?: string; institution_name?: string }) => void;
}

function PlaidLinkButton({ linkToken, onSuccess }: InnerProps) {
  const { open, ready } = usePlaidLink({
    token: linkToken,
    onSuccess: (public_token, metadata) => {
      onSuccess(public_token, {
        institution_id: metadata.institution?.institution_id,
        institution_name: metadata.institution?.name,
      });
    },
  });
  return (
    <button type="button" disabled={!ready} onClick={() => open()}>
      Connect bank
    </button>
  );
}

export default function PlaidConnect() {
  const [status, setStatus] = useState<StatusResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [linkToken, setLinkToken] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function load() {
    try {
      const data = await api<StatusResponse>('/api/integrations/plaid/status');
      setStatus(data);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to load Plaid status');
    }
  }

  useEffect(() => {
    load();
  }, []);

  async function startLink() {
    setError(null);
    setBusy(true);
    try {
      const { linkToken } = await api<{ linkToken: string }>('/api/integrations/plaid/link-token', {
        method: 'POST',
      });
      setLinkToken(linkToken);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to start Plaid Link');
    } finally {
      setBusy(false);
    }
  }

  async function onLinkSuccess(
    publicToken: string,
    metadata: { institution_id?: string; institution_name?: string },
  ) {
    setError(null);
    try {
      await api('/api/integrations/plaid/exchange', {
        method: 'POST',
        body: JSON.stringify({
          publicToken,
          institutionId: metadata.institution_id,
          institutionName: metadata.institution_name,
        }),
      });
      setLinkToken(null);
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Plaid exchange failed');
    }
  }

  async function syncOne(c: PlaidConnection) {
    setError(null);
    try {
      await api(`/api/integrations/plaid/${c.id}/sync`, { method: 'POST' });
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Sync failed');
    }
  }

  async function removeOne(c: PlaidConnection) {
    if (!confirm(`Disconnect ${c.institutionName ?? 'this bank'}? Imported transactions stay.`)) return;
    setError(null);
    try {
      await api(`/api/integrations/plaid/${c.id}`, { method: 'DELETE' });
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Disconnect failed');
    }
  }

  if (!status) {
    return (
      <section className="card">
        <h2>Bank feeds (Plaid)</h2>
        <p className="muted">Loading…</p>
      </section>
    );
  }

  return (
    <section className="card">
      <div className="row-between">
        <div>
          <h2 style={{ margin: 0 }}>Bank feeds (Plaid)</h2>
          <p className="muted" style={{ fontSize: '0.85rem', margin: '0.25rem 0 0' }}>
            Pull transactions automatically from your bank — same flow QuickBooks uses. CSV import below stays available as a fallback.
          </p>
        </div>
        {status.configured &&
          (linkToken ? (
            <PlaidLinkButton linkToken={linkToken} onSuccess={onLinkSuccess} />
          ) : (
            <button type="button" onClick={startLink} disabled={busy}>
              {busy ? 'Loading…' : '+ Connect bank'}
            </button>
          ))}
      </div>

      {error && <div className="form-error" style={{ marginTop: '0.5rem' }}>{error}</div>}

      {!status.configured && (
        <p className="muted" style={{ marginTop: '0.75rem', fontSize: '0.9rem' }}>
          Plaid isn't configured on the server yet. Set <code>PLAID_CLIENT_ID</code> and{' '}
          <code>PLAID_SECRET</code> in <code>.env</code>, then restart the server.{' '}
          <Link to="/portal/admin/integrations">Open the Integrations checklist →</Link>
        </p>
      )}

      {status.connections.length > 0 && (
        <table className="table" style={{ marginTop: '0.75rem' }}>
          <thead>
            <tr>
              <th>Institution</th>
              <th>Accounts</th>
              <th>Last sync</th>
              <th>Status</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {status.connections.map((c) => (
              <tr key={c.id}>
                <td>
                  <strong>{c.institutionName ?? '(unnamed)'}</strong>
                  <div className="muted" style={{ fontSize: '0.75rem' }}>
                    Linked {new Date(c.createdAt).toLocaleDateString()}
                  </div>
                </td>
                <td>
                  {c.accounts && c.accounts.length > 0 ? (
                    c.accounts.map((a) => (
                      <div key={a.accountId} style={{ fontSize: '0.85rem' }}>
                        {a.name}
                        {a.mask && ` ··${a.mask}`}
                      </div>
                    ))
                  ) : (
                    <span className="muted">—</span>
                  )}
                </td>
                <td>
                  {c.lastSyncAt ? (
                    <>
                      {new Date(c.lastSyncAt).toLocaleString()}
                      {c.lastSyncCount != null && (
                        <div className="muted" style={{ fontSize: '0.75rem' }}>
                          {c.lastSyncCount} txn{c.lastSyncCount === 1 ? '' : 's'}
                        </div>
                      )}
                    </>
                  ) : (
                    <span className="muted">never</span>
                  )}
                </td>
                <td>
                  {c.lastError ? (
                    <span className="badge badge-overdue" title={c.lastError}>
                      error
                    </span>
                  ) : (
                    <span className="badge badge-paid">ok</span>
                  )}
                </td>
                <td style={{ textAlign: 'right' }}>
                  <button
                    type="button"
                    className="button-ghost button-small"
                    onClick={() => syncOne(c)}
                  >
                    Sync now
                  </button>
                  <button
                    type="button"
                    className="button-ghost button-small"
                    style={{ marginLeft: '0.4rem' }}
                    onClick={() => removeOne(c)}
                  >
                    Disconnect
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}
