import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { ApiError, api } from '../../lib/api';
import { formatDateTime } from '../../lib/format';

type ContractStatus = 'DRAFT' | 'SENT' | 'VIEWED' | 'SIGNED' | 'DECLINED' | 'VOID';

interface FlowResponse {
  byStatus: Array<{ status: ContractStatus; count: number }>;
  byRep: Array<{ id: string; name: string; status: ContractStatus; count: number }>;
  stale: Array<{
    id: string;
    templateNameSnapshot: string;
    sentAt: string | null;
    customer: { id: string; name: string };
    createdBy: { id: string; name: string };
  }>;
}

export default function SalesFlow() {
  const [data, setData] = useState<FlowResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api<FlowResponse>('/api/contracts/admin/flow')
      .then(setData)
      .catch((err) => setError(err instanceof ApiError ? err.message : 'Failed to load'));
  }, []);

  // Pivot byRep into a name -> { status: count, total } map for the table.
  const repTable = (() => {
    if (!data) return [];
    const map = new Map<string, { name: string; counts: Record<string, number>; total: number }>();
    for (const row of data.byRep) {
      const entry = map.get(row.id) ?? { name: row.name, counts: {}, total: 0 };
      entry.counts[row.status] = row.count;
      entry.total += row.count;
      map.set(row.id, entry);
    }
    return [...map.values()].sort((a, b) => b.total - a.total);
  })();

  return (
    <section className="card">
      <h2>Sales flow</h2>
      {error && <div className="form-error">{error}</div>}
      {!data ? (
        <p className="muted">Loading…</p>
      ) : (
        <>
          <div className="invoice-stats">
            {(['DRAFT', 'SENT', 'VIEWED', 'SIGNED', 'DECLINED'] as ContractStatus[]).map((s) => {
              const count = data.byStatus.find((x) => x.status === s)?.count ?? 0;
              return (
                <div key={s}>
                  <div className="stat-label">{s.toLowerCase()}</div>
                  <div className="stat-value">{count}</div>
                </div>
              );
            })}
          </div>

          <h3 style={{ marginTop: '1.5rem' }}>By rep</h3>
          {repTable.length ? (
            <table className="table">
              <thead>
                <tr>
                  <th>Rep</th>
                  <th>Drafts</th>
                  <th>Sent</th>
                  <th>Viewed</th>
                  <th>Signed</th>
                  <th>Declined</th>
                  <th>Total</th>
                </tr>
              </thead>
              <tbody>
                {repTable.map((r) => (
                  <tr key={r.name}>
                    <td><strong>{r.name}</strong></td>
                    <td>{r.counts.DRAFT ?? 0}</td>
                    <td>{r.counts.SENT ?? 0}</td>
                    <td>{r.counts.VIEWED ?? 0}</td>
                    <td>{r.counts.SIGNED ?? 0}</td>
                    <td>{r.counts.DECLINED ?? 0}</td>
                    <td>{r.total}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <p className="muted">No contracts yet.</p>
          )}

          <h3 style={{ marginTop: '1.5rem' }}>Stale (sent &gt; 7 days, no response)</h3>
          {data.stale.length ? (
            <ul className="list">
              {data.stale.map((c) => (
                <li key={c.id}>
                  <Link to={`/portal/contracts/${c.id}`}>
                    <strong>{c.templateNameSnapshot}</strong>
                  </Link>
                  <div className="muted">
                    {c.customer.name} · sent by {c.createdBy.name} · {formatDateTime(c.sentAt)}
                  </div>
                </li>
              ))}
            </ul>
          ) : (
            <p className="muted">Nothing stale — nice work.</p>
          )}
        </>
      )}
    </section>
  );
}
