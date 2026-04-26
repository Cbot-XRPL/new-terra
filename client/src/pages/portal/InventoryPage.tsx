import { type FormEvent, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { ApiError, api } from '../../lib/api';
import { formatCents } from '../../lib/format';

type Reason = 'RESTOCK' | 'USED' | 'COUNT' | 'WRITE_OFF' | 'OTHER';

interface Product {
  id: string;
  name: string;
  sku: string | null;
  unit: string | null;
  category: string | null;
  defaultUnitPriceCents: number;
  trackInventory: boolean;
  onHandQty: number;
  reorderThresholdQty: number;
  vendor: { id: string; name: string } | null;
}

interface Adjustment {
  id: string;
  amountQty: number;
  reason: Reason;
  notes: string | null;
  createdAt: string;
  createdBy: { id: string; name: string };
  project: { id: string; name: string } | null;
}

const REASON_LABEL: Record<Reason, string> = {
  RESTOCK: 'Restock',
  USED: 'Used on a job',
  COUNT: 'Physical count',
  WRITE_OFF: 'Write-off / damaged',
  OTHER: 'Other',
};

export default function InventoryPage() {
  const [products, setProducts] = useState<Product[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [lowOnly, setLowOnly] = useState(false);

  const [openId, setOpenId] = useState<string | null>(null);
  const [history, setHistory] = useState<Adjustment[]>([]);

  // Adjustment form
  const [adjAmount, setAdjAmount] = useState('');
  const [adjDirection, setAdjDirection] = useState<'in' | 'out'>('out');
  const [adjReason, setAdjReason] = useState<Reason>('USED');
  const [adjNotes, setAdjNotes] = useState('');

  async function load() {
    try {
      const r = await api<{ products: Product[] }>(
        `/api/inventory${lowOnly ? '?lowOnly=true' : ''}`,
      );
      setProducts(r.products);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to load');
    }
  }
  useEffect(() => { load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [lowOnly]);

  async function loadHistory(productId: string) {
    try {
      const r = await api<{ adjustments: Adjustment[] }>(`/api/inventory/products/${productId}/history`);
      setHistory(r.adjustments);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to load history');
    }
  }

  async function adjust(p: Product, e: FormEvent) {
    e.preventDefault();
    setError(null);
    const qty = Number(adjAmount);
    if (!Number.isFinite(qty) || qty <= 0) {
      setError('Enter a positive quantity');
      return;
    }
    const signed = adjDirection === 'in' ? qty : -qty;
    try {
      await api(`/api/inventory/products/${p.id}/adjust`, {
        method: 'POST',
        body: JSON.stringify({
          amountQty: signed,
          reason: adjReason,
          notes: adjNotes || null,
        }),
      });
      setAdjAmount('');
      setAdjNotes('');
      await load();
      if (openId === p.id) await loadHistory(p.id);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Adjust failed');
    }
  }

  async function patchThreshold(p: Product) {
    const raw = prompt(`Set reorder threshold for ${p.name} (in ${p.unit ?? 'units'}):`, String(p.reorderThresholdQty));
    if (raw == null) return;
    const qty = Number(raw);
    if (!Number.isFinite(qty) || qty < 0) { setError('Invalid quantity'); return; }
    try {
      await api(`/api/inventory/products/${p.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ reorderThresholdQty: qty }),
      });
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Update failed');
    }
  }

  return (
    <div className="dashboard">
      <header>
        <h1>Inventory</h1>
        <p className="muted">
          Tracked materials + consumables. Enable tracking on a product from the catalog page;
          adjust on-hand qty here as you use / restock. Click any threshold to edit.
          {' '}<Link to="/portal/catalog">← back to catalog</Link>
        </p>
      </header>

      {error && <div className="form-error">{error}</div>}

      <section className="card">
        <div className="row-between">
          <h2>Tracked products</h2>
          <label style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', fontSize: '0.85rem' }}>
            <input
              type="checkbox"
              checked={lowOnly}
              onChange={(e) => setLowOnly(e.target.checked)}
              style={{ width: 'auto' }}
            />
            Low-stock only
          </label>
        </div>

        {products.length ? (
          <table className="table">
            <thead>
              <tr>
                <th>Product</th>
                <th>SKU</th>
                <th>Unit</th>
                <th style={{ textAlign: 'right' }}>On hand</th>
                <th style={{ textAlign: 'right' }}>Reorder ≤</th>
                <th>Vendor</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {products.map((p) => {
                const low = p.reorderThresholdQty > 0 && p.onHandQty <= p.reorderThresholdQty;
                return (
                  <tr key={p.id}>
                    <td><strong>{p.name}</strong>{p.category && <span className="muted"> · {p.category}</span>}</td>
                    <td className="muted">{p.sku ?? '—'}</td>
                    <td className="muted">{p.unit ?? '—'}</td>
                    <td
                      style={{ textAlign: 'right', color: low ? 'var(--accent)' : undefined, fontWeight: 600 }}
                    >
                      {p.onHandQty.toFixed(p.onHandQty % 1 === 0 ? 0 : 2)}
                    </td>
                    <td
                      style={{ textAlign: 'right', cursor: 'pointer' }}
                      onClick={() => patchThreshold(p)}
                      title="Click to edit"
                    >
                      {p.reorderThresholdQty > 0 ? p.reorderThresholdQty : <span className="muted">—</span>}
                    </td>
                    <td>{p.vendor?.name ?? <span className="muted">—</span>}</td>
                    <td>
                      <button
                        type="button"
                        className="button-ghost button-small"
                        onClick={() => {
                          if (openId === p.id) { setOpenId(null); setHistory([]); }
                          else { setOpenId(p.id); loadHistory(p.id); }
                        }}
                      >
                        {openId === p.id ? 'Close' : 'Adjust'}
                      </button>
                    </td>
                  </tr>
                );
              }).flatMap((row, idx) => {
                const p = products[idx];
                if (openId !== p.id) return [row];
                return [
                  row,
                  <tr key={`${p.id}-detail`}>
                    <td colSpan={7} style={{ background: 'var(--surface)' }}>
                      <form onSubmit={(e) => adjust(p, e)} style={{ marginBottom: '0.75rem' }}>
                        <div className="form-row">
                          <div>
                            <label>Direction</label>
                            <select value={adjDirection} onChange={(e) => setAdjDirection(e.target.value as 'in' | 'out')}>
                              <option value="in">In (+)</option>
                              <option value="out">Out (−)</option>
                            </select>
                          </div>
                          <div>
                            <label>Quantity ({p.unit ?? 'units'})</label>
                            <input type="number" step="0.01" min="0" value={adjAmount} onChange={(e) => setAdjAmount(e.target.value)} required />
                          </div>
                          <div>
                            <label>Reason</label>
                            <select value={adjReason} onChange={(e) => setAdjReason(e.target.value as Reason)}>
                              {(Object.keys(REASON_LABEL) as Reason[]).map((r) => (
                                <option key={r} value={r}>{REASON_LABEL[r]}</option>
                              ))}
                            </select>
                          </div>
                          <div style={{ flex: 1 }}>
                            <label>Notes</label>
                            <input value={adjNotes} onChange={(e) => setAdjNotes(e.target.value)} placeholder="Job site, PO #, etc." />
                          </div>
                        </div>
                        <button type="submit">Record adjustment</button>
                      </form>

                      <h4 style={{ margin: '0.5rem 0' }}>Recent adjustments</h4>
                      {history.length ? (
                        <table className="table">
                          <thead>
                            <tr>
                              <th>When</th>
                              <th>By</th>
                              <th style={{ textAlign: 'right' }}>Amount</th>
                              <th>Reason</th>
                              <th>Project</th>
                              <th>Notes</th>
                            </tr>
                          </thead>
                          <tbody>
                            {history.map((a) => (
                              <tr key={a.id}>
                                <td className="muted">{new Date(a.createdAt).toLocaleString()}</td>
                                <td className="muted">{a.createdBy.name}</td>
                                <td style={{ textAlign: 'right', color: a.amountQty < 0 ? 'var(--accent)' : 'var(--paid, #0f9d58)' }}>
                                  {a.amountQty > 0 ? '+' : ''}{a.amountQty.toFixed(a.amountQty % 1 === 0 ? 0 : 2)}
                                </td>
                                <td>{REASON_LABEL[a.reason]}</td>
                                <td className="muted">{a.project?.name ?? '—'}</td>
                                <td className="muted" style={{ maxWidth: 240 }}>{a.notes ?? '—'}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      ) : (
                        <p className="muted">No history yet for this product.</p>
                      )}
                    </td>
                  </tr>,
                ];
              })}
            </tbody>
          </table>
        ) : (
          <p className="muted">
            {lowOnly
              ? 'Nothing low on stock right now.'
              : 'No tracked products. Enable inventory tracking on any product from the catalog page.'}
          </p>
        )}
      </section>

      <section className="card">
        <h2>Tip: turn on tracking from the catalog</h2>
        <p className="muted">
          On <Link to="/portal/catalog">the catalog page</Link>, edit a product → toggle 'Track inventory' →
          enter the current on-hand quantity + (optionally) a reorder threshold. From then on this page
          shows that product, and the low-stock filter highlights anything at or below the threshold so
          you know when to restock.
        </p>
      </section>
    </div>
  );
}

// PRICE export so the page references stay clean if we add a price-based
// rollup in a later commit.
export const _formatCents = formatCents;
