import { useEffect, useState } from 'react';
import { ApiError, api } from '../lib/api';
import { formatCents } from '../lib/format';

interface PayLine {
  id: string;
  description: string;
  displayTrade: string | null;
  quantity: string;
  unit: string | null;
  unitPriceCents: number;
  totalCents: number;
  estimate: { id: string; number: string };
}

interface ContractorPay {
  contractor: { id: string; name: string; email: string; tradeType: string | null };
  committedCents: number;
  paidCents: number;
  lines: PayLine[];
}

interface Props {
  projectId: string;
}

// PM-side contractor pay rollup. Sums every estimate line attached to a
// sub across the estimates feeding this project so a PM can see "I owe
// Joe Drywall $4,200 across two scopes" at a glance. 403 on the endpoint
// when the viewer doesn't have rights — we hide the card silently in that
// case so customers / un-assigned users don't see a placeholder.
export default function ContractorPayCard({ projectId }: Props) {
  const [data, setData] = useState<ContractorPay[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [forbidden, setForbidden] = useState(false);
  const [openId, setOpenId] = useState<string | null>(null);

  useEffect(() => {
    let abort = false;
    api<{ contractors: ContractorPay[] }>(`/api/projects/${projectId}/contractor-pay`)
      .then((r) => {
        if (!abort) setData(r.contractors);
      })
      .catch((err) => {
        if (abort) return;
        if (err instanceof ApiError && err.status === 403) {
          setForbidden(true);
          return;
        }
        setError(err instanceof ApiError ? err.message : 'Failed to load contractor pay');
      });
    return () => {
      abort = true;
    };
  }, [projectId]);

  if (forbidden) return null;
  if (!data && !error) return null;

  const totalCommitted = (data ?? []).reduce((s, c) => s + c.committedCents, 0);
  const totalPaid = (data ?? []).reduce((s, c) => s + c.paidCents, 0);

  return (
    <section className="card">
      <h2>Contractor pay</h2>
      <p className="muted" style={{ fontSize: '0.85rem' }}>
        Committed amounts come from this project's estimate(s). Paid /
        allocated amounts come from approved or paid pay requests.
        Internal — never visible to the customer.
      </p>
      {error && <div className="form-error">{error}</div>}
      {data && data.length === 0 && (
        <p className="muted">No contractor lines on this project's estimate yet.</p>
      )}
      {data && data.length > 0 && (
        <>
          <table className="table">
            <thead>
              <tr>
                <th>Contractor</th>
                <th>Trade</th>
                <th>Lines</th>
                <th style={{ textAlign: 'right' }}>Committed</th>
                <th style={{ textAlign: 'right' }}>Paid / approved</th>
                <th style={{ textAlign: 'right' }}>Remaining</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {data.map((c) => {
                const remaining = c.committedCents - c.paidCents;
                return (
                  <tr key={c.contractor.id}>
                    <td>
                      <strong>{c.contractor.name}</strong>
                      <div className="muted" style={{ fontSize: '0.75rem' }}>{c.contractor.email}</div>
                    </td>
                    <td>{c.contractor.tradeType ?? <span className="muted">—</span>}</td>
                    <td>{c.lines.length}</td>
                    <td style={{ textAlign: 'right' }}>
                      <strong>{formatCents(c.committedCents)}</strong>
                    </td>
                    <td style={{ textAlign: 'right' }}>
                      {formatCents(c.paidCents)}
                    </td>
                    <td style={{ textAlign: 'right', color: remaining < 0 ? 'var(--error)' : undefined }}>
                      {formatCents(remaining)}
                    </td>
                    <td>
                      {c.lines.length > 0 ? (
                        <button
                          type="button"
                          className="button-ghost button-small"
                          onClick={() => setOpenId(openId === c.contractor.id ? null : c.contractor.id)}
                        >
                          {openId === c.contractor.id ? 'Hide' : 'Lines'}
                        </button>
                      ) : (
                        <span className="muted" style={{ fontSize: '0.75rem' }}>paid only</span>
                      )}
                    </td>
                  </tr>
                );
              })}
              <tr>
                <td colSpan={3} style={{ textAlign: 'right' }}><em>Total</em></td>
                <td style={{ textAlign: 'right' }}><strong>{formatCents(totalCommitted)}</strong></td>
                <td style={{ textAlign: 'right' }}><strong>{formatCents(totalPaid)}</strong></td>
                <td style={{ textAlign: 'right' }}><strong>{formatCents(totalCommitted - totalPaid)}</strong></td>
                <td></td>
              </tr>
            </tbody>
          </table>
          {data.map((c) =>
            openId === c.contractor.id ? (
              <div
                key={c.contractor.id}
                style={{ marginTop: '0.75rem', padding: '0.75rem', background: 'var(--surface)', borderRadius: 8 }}
              >
                <h3 style={{ marginTop: 0, fontSize: '0.95rem' }}>
                  {c.contractor.name} — {c.lines.length} line{c.lines.length === 1 ? '' : 's'}
                </h3>
                <table className="table" style={{ marginTop: '0.5rem' }}>
                  <thead>
                    <tr>
                      <th>Estimate</th>
                      <th>Trade label (customer sees)</th>
                      <th>Description (internal)</th>
                      <th>Qty</th>
                      <th style={{ textAlign: 'right' }}>Total</th>
                    </tr>
                  </thead>
                  <tbody>
                    {c.lines.map((l) => (
                      <tr key={l.id}>
                        <td>{l.estimate.number}</td>
                        <td>{l.displayTrade ?? c.contractor.tradeType ?? 'Labor'}</td>
                        <td className="muted">{l.description}</td>
                        <td>
                          {l.quantity}
                          {l.unit ? ` ${l.unit}` : ''}
                        </td>
                        <td style={{ textAlign: 'right' }}>{formatCents(l.totalCents)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : null,
          )}
        </>
      )}
    </section>
  );
}
