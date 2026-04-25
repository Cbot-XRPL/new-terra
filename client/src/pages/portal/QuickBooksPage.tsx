import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { ApiError, api } from '../../lib/api';
import { formatCents, formatDate, formatDateTime } from '../../lib/format';

interface Status {
  configured: boolean;
  connected: boolean;
  stubMode: boolean;
  realmId: string | null;
  connectedAt: string | null;
  accessTokenExpiresAt: string | null;
  refreshTokenExpiresAt: string | null;
  lastError: string | null;
  counts: { queued: number; errored: number; synced: number; localOnly: number };
}

type SyncStatus = 'LOCAL_ONLY' | 'QUEUED' | 'SYNCED' | 'ERROR';

interface ExpenseRow {
  id: string;
  amountCents: number;
  date: string;
  description: string | null;
  syncStatus: SyncStatus;
  qbExpenseId: string | null;
  lastSyncAttemptAt: string | null;
  lastSyncError: string | null;
  vendor: { id: string; name: string } | null;
  project: { id: string; name: string } | null;
}

interface QbPurchase {
  Id: string;
  TxnDate?: string;
  TotalAmt?: number;
  EntityRef?: { name?: string; value?: string };
  PrivateNote?: string;
}

const SECTIONS: Array<{ key: SyncStatus; label: string; helper: string }> = [
  { key: 'QUEUED', label: 'Queued', helper: 'Ready to push on the next sync run.' },
  { key: 'ERROR', label: 'Errored', helper: 'Failed last time — review and retry.' },
  { key: 'SYNCED', label: 'Synced', helper: 'Already pushed to QuickBooks.' },
  { key: 'LOCAL_ONLY', label: 'Local only', helper: 'Not queued for sync. Mark "Queue for sync" to include.' },
];

export default function QuickBooksPage() {
  const [params] = useSearchParams();
  const justConnectedRealm = params.get('connected');

  const [status, setStatus] = useState<Status | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [bannerMsg, setBannerMsg] = useState<string | null>(
    justConnectedRealm ? `Connected to QuickBooks (realm ${justConnectedRealm}).` : null,
  );

  const [byStatus, setByStatus] = useState<Record<SyncStatus, ExpenseRow[]>>({
    QUEUED: [], ERROR: [], SYNCED: [], LOCAL_ONLY: [],
  });

  const [recentQb, setRecentQb] = useState<QbPurchase[] | null>(null);
  const [loadingQb, setLoadingQb] = useState(false);

  async function loadAll() {
    try {
      const [statusRes, queued, errored, synced, local] = await Promise.all([
        api<Status>('/api/integrations/quickbooks/status'),
        api<{ expenses: ExpenseRow[] }>('/api/finance/expenses?syncStatus=QUEUED&pageSize=100'),
        api<{ expenses: ExpenseRow[] }>('/api/finance/expenses?syncStatus=ERROR&pageSize=100'),
        api<{ expenses: ExpenseRow[] }>('/api/finance/expenses?syncStatus=SYNCED&pageSize=25'),
        api<{ expenses: ExpenseRow[] }>('/api/finance/expenses?syncStatus=LOCAL_ONLY&pageSize=25'),
      ]);
      setStatus(statusRes);
      setByStatus({
        QUEUED: queued.expenses,
        ERROR: errored.expenses,
        SYNCED: synced.expenses,
        LOCAL_ONLY: local.expenses,
      });
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to load');
    }
  }

  useEffect(() => { loadAll(); }, []);

  async function startConnect() {
    setError(null);
    try {
      const { url } = await api<{ url: string }>('/api/integrations/quickbooks/authorize', { method: 'POST' });
      // Use a popup so the user comes back to the same SPA state. The
      // /callback redirect lands on /portal/finance/qb?connected=...
      window.open(url, 'qb_connect', 'width=720,height=820');
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not start connect');
    }
  }

  async function disconnect() {
    if (!confirm('Disconnect QuickBooks? Synced rows keep their qbExpenseId; new pushes will use stub mode until reconnected.')) return;
    try {
      await api('/api/integrations/quickbooks/disconnect', { method: 'POST' });
      setBannerMsg('Disconnected.');
      await loadAll();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Disconnect failed');
    }
  }

  async function queueOne(id: string) {
    try {
      await api(`/api/integrations/quickbooks/expenses/${id}/queue`, { method: 'POST' });
      await loadAll();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Queue failed');
    }
  }

  async function syncOne(id: string) {
    setBusy(true);
    setError(null);
    try {
      await api(`/api/integrations/quickbooks/sync/expense/${id}`, { method: 'POST' });
      await loadAll();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Sync failed');
    } finally {
      setBusy(false);
    }
  }

  async function syncAll() {
    setBusy(true);
    setError(null);
    try {
      const res = await api<{ considered: number; succeeded: number; failed: number }>(
        '/api/integrations/quickbooks/sync/queued',
        { method: 'POST' },
      );
      setBannerMsg(
        `Sync run: considered ${res.considered}, succeeded ${res.succeeded}, failed ${res.failed}.`,
      );
      await loadAll();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Sync failed');
    } finally {
      setBusy(false);
    }
  }

  async function loadRecentQb() {
    setLoadingQb(true);
    try {
      const { purchases } = await api<{ purchases: QbPurchase[] }>(
        '/api/integrations/quickbooks/recent-purchases',
      );
      setRecentQb(purchases);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to fetch QB activity');
    } finally {
      setLoadingQb(false);
    }
  }

  if (!status) {
    return (
      <div className="dashboard">
        {error ? <div className="form-error">{error}</div> : <p className="muted">Loading…</p>}
      </div>
    );
  }

  return (
    <div className="dashboard">
      <header>
        <Link to="/portal/finance" className="muted">← Finance</Link>
        <h1>QuickBooks</h1>
        <p className="muted">
          Push expenses + vendors to QuickBooks Online. Local-only entries stay in this app
          forever — you opt in per-expense by queueing or syncing.
        </p>
      </header>

      {bannerMsg && <div className="form-success">{bannerMsg}</div>}
      {error && <div className="form-error">{error}</div>}

      <section className="card">
        <h2>Connection</h2>
        {!status.configured && (
          <p className="muted">
            QuickBooks credentials are not set on this server.
            The app runs in <strong>stub mode</strong>: queue + sync still work end-to-end and produce
            synthetic <code>stub-purchase-…</code> ids, so you can rehearse the flow before
            wiring real credentials. Set <code>QB_CLIENT_ID</code>, <code>QB_CLIENT_SECRET</code>,
            and <code>QB_REDIRECT_URI</code> on the server, then come back to connect.
          </p>
        )}

        {status.configured && !status.connected && (
          <>
            <p className="muted">No active connection.</p>
            <button onClick={startConnect}>Connect QuickBooks</button>
          </>
        )}

        {status.connected && (
          <>
            <dl className="kv">
              <dt>Realm</dt>
              <dd><code>{status.realmId}</code></dd>
              <dt>Connected</dt>
              <dd>{status.connectedAt && formatDateTime(status.connectedAt)}</dd>
              <dt>Access token expires</dt>
              <dd>{status.accessTokenExpiresAt && formatDateTime(status.accessTokenExpiresAt)}</dd>
              <dt>Refresh expires</dt>
              <dd>{status.refreshTokenExpiresAt && formatDateTime(status.refreshTokenExpiresAt)}</dd>
              {status.lastError && (
                <>
                  <dt>Last error</dt>
                  <dd className="form-error" style={{ margin: 0 }}>{status.lastError}</dd>
                </>
              )}
            </dl>
            <div style={{ display: 'flex', gap: '0.5rem', marginTop: '1rem', flexWrap: 'wrap' }}>
              <button onClick={syncAll} disabled={busy}>
                {busy ? 'Syncing…' : `Sync queued (${status.counts.queued + status.counts.errored})`}
              </button>
              <button className="button-ghost" onClick={loadRecentQb} disabled={loadingQb}>
                {loadingQb ? 'Loading…' : 'Fetch recent QB purchases'}
              </button>
              <button className="button-ghost" onClick={disconnect}>
                Disconnect
              </button>
            </div>
          </>
        )}

        <div className="invoice-stats" style={{ marginTop: '1.25rem' }}>
          <div>
            <div className="stat-label">Local only</div>
            <div className="stat-value">{status.counts.localOnly}</div>
          </div>
          <div>
            <div className="stat-label">Queued</div>
            <div className="stat-value">{status.counts.queued}</div>
          </div>
          <div>
            <div className="stat-label">Errored</div>
            <div className="stat-value">{status.counts.errored}</div>
          </div>
          <div>
            <div className="stat-label">Synced</div>
            <div className="stat-value">{status.counts.synced}</div>
          </div>
        </div>
      </section>

      {SECTIONS.map((s) => {
        const rows = byStatus[s.key];
        if (rows.length === 0) return null;
        return (
          <section className="card" key={s.key}>
            <h2>{s.label}</h2>
            <p className="muted" style={{ fontSize: '0.85rem', marginBottom: '0.75rem' }}>{s.helper}</p>
            <table className="table">
              <thead>
                <tr>
                  <th>Date</th>
                  <th>Vendor</th>
                  <th>Project</th>
                  <th>Amount</th>
                  {s.key !== 'SYNCED' && <th>Last error / attempt</th>}
                  {s.key === 'SYNCED' && <th>QB id</th>}
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {rows.map((e) => (
                  <tr key={e.id}>
                    <td>{formatDate(e.date)}</td>
                    <td>{e.vendor?.name ?? <span className="muted">—</span>}</td>
                    <td>
                      {e.project ? (
                        <Link to={`/portal/projects/${e.project.id}`}>{e.project.name}</Link>
                      ) : (
                        <span className="muted">—</span>
                      )}
                    </td>
                    <td>{formatCents(e.amountCents)}</td>
                    {s.key !== 'SYNCED' && (
                      <td className="muted" style={{ fontSize: '0.8rem' }}>
                        {e.lastSyncError ?? (e.lastSyncAttemptAt ? formatDateTime(e.lastSyncAttemptAt) : '—')}
                      </td>
                    )}
                    {s.key === 'SYNCED' && (
                      <td><code style={{ fontSize: '0.75rem' }}>{e.qbExpenseId}</code></td>
                    )}
                    <td style={{ display: 'flex', gap: '0.4rem' }}>
                      {s.key !== 'SYNCED' && (
                        <button
                          type="button"
                          className="button-small"
                          onClick={() => syncOne(e.id)}
                          disabled={busy}
                        >
                          {s.key === 'ERROR' ? 'Retry' : 'Sync now'}
                        </button>
                      )}
                      {s.key === 'LOCAL_ONLY' && (
                        <button
                          type="button"
                          className="button-ghost button-small"
                          onClick={() => queueOne(e.id)}
                        >
                          Queue
                        </button>
                      )}
                      <Link
                        to={`/portal/finance/expenses/${e.id}`}
                        className="button-ghost button-small button"
                      >
                        Open
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
        );
      })}

      {recentQb && (
        <section className="card">
          <h2>Recent QuickBooks purchases</h2>
          <p className="muted" style={{ fontSize: '0.85rem' }}>
            Read-only view of what QuickBooks shows on its side. Match the <code>nt-expense-id:</code>
            tag in the memo to find the local row.
          </p>
          {recentQb.length ? (
            <table className="table">
              <thead>
                <tr><th>QB id</th><th>Date</th><th>Vendor</th><th>Amount</th><th>Note</th></tr>
              </thead>
              <tbody>
                {recentQb.map((p) => (
                  <tr key={p.Id}>
                    <td><code>{p.Id}</code></td>
                    <td>{p.TxnDate ?? <span className="muted">—</span>}</td>
                    <td>{p.EntityRef?.name ?? <span className="muted">—</span>}</td>
                    <td>{p.TotalAmt != null ? formatCents(Math.round(p.TotalAmt * 100)) : '—'}</td>
                    <td className="muted" style={{ fontSize: '0.8rem' }}>{p.PrivateNote ?? '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <p className="muted">
              No purchases visible from QuickBooks.
              {status.stubMode && ' (Stub mode always returns an empty list.)'}
            </p>
          )}
        </section>
      )}
    </div>
  );
}
