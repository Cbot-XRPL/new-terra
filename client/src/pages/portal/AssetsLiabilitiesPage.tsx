import { type FormEvent, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { ApiError, api } from '../../lib/api';
import { formatCents, formatDate } from '../../lib/format';

interface Asset {
  id: string;
  name: string;
  category: string | null;
  currentValueCents: number;
  acquiredAt: string | null;
  acquisitionCostCents: number | null;
  notes: string | null;
  archived: boolean;
}

interface Liability {
  id: string;
  name: string;
  category: string | null;
  currentBalanceCents: number;
  notes: string | null;
  archived: boolean;
}

export default function AssetsLiabilitiesPage() {
  const [assets, setAssets] = useState<Asset[]>([]);
  const [liabilities, setLiabilities] = useState<Liability[]>([]);
  const [error, setError] = useState<string | null>(null);

  // New-asset form
  const [aName, setAName] = useState('');
  const [aCategory, setACategory] = useState('Vehicle');
  const [aValue, setAValue] = useState('');
  const [aAcquired, setAAcquired] = useState('');

  // New-liability form
  const [lName, setLName] = useState('');
  const [lCategory, setLCategory] = useState('Loan');
  const [lBalance, setLBalance] = useState('');

  // Submit guards so a fast double-click doesn't create two rows.
  const [savingAsset, setSavingAsset] = useState(false);
  const [savingLiability, setSavingLiability] = useState(false);

  async function load() {
    try {
      const [a, l] = await Promise.all([
        api<{ assets: Asset[] }>('/api/banking/assets'),
        api<{ liabilities: Liability[] }>('/api/banking/liabilities'),
      ]);
      setAssets(a.assets);
      setLiabilities(l.liabilities);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to load');
    }
  }
  useEffect(() => { load(); }, []);

  async function createAsset(e: FormEvent) {
    e.preventDefault();
    if (savingAsset) return;
    setSavingAsset(true);
    try {
      await api('/api/banking/assets', {
        method: 'POST',
        body: JSON.stringify({
          name: aName,
          category: aCategory || null,
          currentValueCents: aValue ? Math.round(Number(aValue) * 100) : 0,
          acquiredAt: aAcquired ? new Date(aAcquired).toISOString() : null,
        }),
      });
      setAName(''); setAValue(''); setAAcquired('');
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Create failed');
    } finally {
      setSavingAsset(false);
    }
  }

  async function createLiability(e: FormEvent) {
    e.preventDefault();
    if (savingLiability) return;
    setSavingLiability(true);
    try {
      await api('/api/banking/liabilities', {
        method: 'POST',
        body: JSON.stringify({
          name: lName,
          category: lCategory || null,
          currentBalanceCents: lBalance ? Math.round(Number(lBalance) * 100) : 0,
        }),
      });
      setLName(''); setLBalance('');
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Create failed');
    } finally {
      setSavingLiability(false);
    }
  }

  async function patchAssetValue(asset: Asset) {
    const raw = prompt(`Set current value for ${asset.name}:`, (asset.currentValueCents / 100).toFixed(2));
    if (raw == null) return;
    const cents = Math.round(Number(raw) * 100);
    if (!Number.isFinite(cents) || cents < 0) { setError('Invalid amount'); return; }
    try {
      await api(`/api/banking/assets/${asset.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ currentValueCents: cents }),
      });
      await load();
    } catch (err) { setError(err instanceof ApiError ? err.message : 'Update failed'); }
  }
  async function patchLiabilityBalance(l: Liability) {
    const raw = prompt(`Set current balance for ${l.name}:`, (l.currentBalanceCents / 100).toFixed(2));
    if (raw == null) return;
    const cents = Math.round(Number(raw) * 100);
    if (!Number.isFinite(cents) || cents < 0) { setError('Invalid amount'); return; }
    try {
      await api(`/api/banking/liabilities/${l.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ currentBalanceCents: cents }),
      });
      await load();
    } catch (err) { setError(err instanceof ApiError ? err.message : 'Update failed'); }
  }

  async function deleteAsset(a: Asset) {
    if (!confirm(`Delete ${a.name}?`)) return;
    try {
      await api(`/api/banking/assets/${a.id}`, { method: 'DELETE' });
      await load();
    } catch (err) { setError(err instanceof ApiError ? err.message : 'Delete failed'); }
  }
  async function deleteLiability(l: Liability) {
    if (!confirm(`Delete ${l.name}?`)) return;
    try {
      await api(`/api/banking/liabilities/${l.id}`, { method: 'DELETE' });
      await load();
    } catch (err) { setError(err instanceof ApiError ? err.message : 'Delete failed'); }
  }

  const assetTotal = assets.filter((a) => !a.archived).reduce((s, a) => s + a.currentValueCents, 0);
  const liabilityTotal = liabilities.filter((l) => !l.archived).reduce((s, l) => s + l.currentBalanceCents, 0);

  return (
    <div className="dashboard">
      <header>
        <h1>Other assets &amp; liabilities</h1>
        <p className="muted">
          Non-cash assets (vehicles, tools, equipment) and standalone liabilities (loans, leases).
          These roll up to the balance-sheet alongside bank balances. Click any value to edit it.
          {' '}<Link to="/portal/banking">← back to banking</Link>
        </p>
      </header>

      {error && <div className="form-error">{error}</div>}

      <div className="form-row" style={{ alignItems: 'flex-start' }}>
        <section className="card" style={{ flex: 1 }}>
          <div className="row-between">
            <h2>Assets</h2>
            <span className="muted">total {formatCents(assetTotal)}</span>
          </div>
          <form onSubmit={createAsset}>
            <div className="form-row">
              <div>
                <label>Name</label>
                <input value={aName} onChange={(e) => setAName(e.target.value)} required placeholder="2019 Ford F-150" />
              </div>
              <div>
                <label>Category</label>
                <input value={aCategory} onChange={(e) => setACategory(e.target.value)} list="asset-cats" />
                <datalist id="asset-cats">
                  <option value="Vehicle" />
                  <option value="Tools" />
                  <option value="Equipment" />
                  <option value="Real estate" />
                  <option value="Other" />
                </datalist>
              </div>
              <div>
                <label>Current value (USD)</label>
                <input type="number" step="0.01" min="0" value={aValue} onChange={(e) => setAValue(e.target.value)} required />
              </div>
              <div>
                <label>Acquired</label>
                <input type="date" value={aAcquired} onChange={(e) => setAAcquired(e.target.value)} />
              </div>
            </div>
            <button type="submit" disabled={savingAsset || !aName || !aValue}>
              {savingAsset ? 'Saving…' : '+ Add asset'}
            </button>
          </form>

          <table className="table" style={{ marginTop: '0.75rem' }}>
            <thead>
              <tr>
                <th>Name</th>
                <th>Category</th>
                <th>Acquired</th>
                <th style={{ textAlign: 'right' }}>Value</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {assets.filter((a) => !a.archived).map((a) => (
                <tr key={a.id}>
                  <td><strong>{a.name}</strong></td>
                  <td>{a.category ?? <span className="muted">—</span>}</td>
                  <td>{a.acquiredAt ? formatDate(a.acquiredAt) : <span className="muted">—</span>}</td>
                  <td
                    style={{ textAlign: 'right', cursor: 'pointer' }}
                    onClick={() => patchAssetValue(a)}
                    title="Click to edit"
                  >
                    {formatCents(a.currentValueCents)}
                  </td>
                  <td>
                    <button type="button" className="button-ghost button-small" onClick={() => deleteAsset(a)}>
                      Delete
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {assets.length === 0 && <p className="muted">No assets yet.</p>}
        </section>

        <section className="card" style={{ flex: 1 }}>
          <div className="row-between">
            <h2>Liabilities</h2>
            <span className="muted">total {formatCents(liabilityTotal)}</span>
          </div>
          <form onSubmit={createLiability}>
            <div className="form-row">
              <div>
                <label>Name</label>
                <input value={lName} onChange={(e) => setLName(e.target.value)} required placeholder="Equipment loan — Bobcat" />
              </div>
              <div>
                <label>Category</label>
                <input value={lCategory} onChange={(e) => setLCategory(e.target.value)} list="liability-cats" />
                <datalist id="liability-cats">
                  <option value="Loan" />
                  <option value="Equipment lease" />
                  <option value="Tax payable" />
                  <option value="Other" />
                </datalist>
              </div>
              <div>
                <label>Current balance (USD)</label>
                <input type="number" step="0.01" min="0" value={lBalance} onChange={(e) => setLBalance(e.target.value)} required />
              </div>
            </div>
            <button type="submit" disabled={savingLiability || !lName || !lBalance}>
              {savingLiability ? 'Saving…' : '+ Add liability'}
            </button>
          </form>

          <table className="table" style={{ marginTop: '0.75rem' }}>
            <thead>
              <tr>
                <th>Name</th>
                <th>Category</th>
                <th style={{ textAlign: 'right' }}>Balance</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {liabilities.filter((l) => !l.archived).map((l) => (
                <tr key={l.id}>
                  <td><strong>{l.name}</strong></td>
                  <td>{l.category ?? <span className="muted">—</span>}</td>
                  <td
                    style={{ textAlign: 'right', cursor: 'pointer', color: 'var(--accent)' }}
                    onClick={() => patchLiabilityBalance(l)}
                    title="Click to edit"
                  >
                    {formatCents(l.currentBalanceCents)}
                  </td>
                  <td>
                    <button type="button" className="button-ghost button-small" onClick={() => deleteLiability(l)}>
                      Delete
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {liabilities.length === 0 && <p className="muted">No liabilities yet.</p>}
        </section>
      </div>
    </div>
  );
}
