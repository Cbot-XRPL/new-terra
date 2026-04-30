import { type FormEvent, useEffect, useMemo, useRef, useState } from 'react';
import { ApiError, api } from '../../lib/api';
import { useAuth } from '../../auth/AuthContext';
import { formatCents, formatDate } from '../../lib/format';

const API_BASE = import.meta.env.VITE_API_URL ?? '';

interface ProjectOption {
  id: string;
  name: string;
}

interface ExpenseCategoryOption {
  id: string;
  name: string;
}

interface ExpenseRow {
  id: string;
  amountCents: number;
  date: string;
  description: string | null;
  receiptUrl: string | null;
  receiptThumbnailUrl: string | null;
  tradeType: string | null;
  project: { id: string; name: string } | null;
  category: { id: string; name: string } | null;
}

const TRADES = [
  'Framing',
  'Demolition',
  'Concrete',
  'Roofing',
  'Siding',
  'Electrical',
  'Plumbing',
  'HVAC',
  'Drywall',
  'Insulation',
  'Painting',
  'Flooring',
  'Tile',
  'Cabinets',
  'Countertops',
  'Decks',
  'Fencing',
  'Hardscape',
  'Landscape',
  'Excavation',
  'General',
  'Other',
];

export default function JobReceiptsPage() {
  const { user } = useAuth();
  const [projects, setProjects] = useState<ProjectOption[]>([]);
  const [categories, setCategories] = useState<ExpenseCategoryOption[]>([]);
  const [recent, setRecent] = useState<ExpenseRow[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  // Form state
  const [projectId, setProjectId] = useState('');
  const [kind, setKind] = useState<'Materials' | 'Labor'>('Materials');
  const [tradeType, setTradeType] = useState('');
  const [description, setDescription] = useState('');
  const [amount, setAmount] = useState('');
  const [date, setDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [file, setFile] = useState<File | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const fileRef = useRef<HTMLInputElement | null>(null);

  // Map kind → categoryId of the matching ExpenseCategory. The seed
  // creates "Labor" + "Materials" rows; if admin renamed them we fall
  // back to a case-insensitive name match.
  const categoryIdFor = useMemo(() => {
    return (k: 'Labor' | 'Materials') => {
      const c = categories.find((c) => c.name.toLowerCase() === k.toLowerCase());
      return c?.id ?? null;
    };
  }, [categories]);

  async function load() {
    try {
      const [p, c, r] = await Promise.all([
        api<{ projects: ProjectOption[] }>('/api/projects'),
        api<{ categories: ExpenseCategoryOption[] }>('/api/finance/categories'),
        api<{ expenses: ExpenseRow[] }>('/api/finance/expenses?pageSize=25&mine=true'),
      ]);
      setProjects(p.projects);
      setCategories(c.categories);
      // Filter to receipt-bearing rows on the client — the API doesn't
      // have a hasReceipt filter and adding one is a separate change.
      setRecent(r.expenses.filter((e) => !!e.receiptUrl));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to load form data');
    }
  }
  useEffect(() => {
    load();
  }, []);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setSuccess(null);

    if (!file) {
      setError('Snap a photo of the receipt — required.');
      return;
    }
    if (!projectId) {
      setError('Pick the project this receipt is for.');
      return;
    }
    if (!tradeType) {
      setError('Pick the trade.');
      return;
    }
    if (!description.trim()) {
      setError('Add a description so the bookkeeper knows what it was for.');
      return;
    }
    const amountCents = Math.round(Number(amount) * 100);
    if (!Number.isFinite(amountCents) || amountCents <= 0) {
      setError('Enter a dollar amount greater than zero.');
      return;
    }

    setSubmitting(true);
    try {
      const form = new FormData();
      form.append('receipt', file);
      form.append('projectId', projectId);
      const catId = categoryIdFor(kind);
      if (catId) form.append('categoryId', catId);
      form.append('tradeType', tradeType);
      form.append('description', description.trim());
      form.append('amountCents', String(amountCents));
      form.append('date', new Date(date).toISOString());

      const token = sessionStorage.getItem('nt_token') ?? localStorage.getItem('nt_token');
      const res = await fetch(`${API_BASE}/api/finance/expenses`, {
        method: 'POST',
        headers: token ? { Authorization: `Bearer ${token}` } : {},
        body: form,
      });
      if (!res.ok) {
        const data = await res.json().catch(() => null);
        throw new ApiError(res.status, data?.error ?? res.statusText, data);
      }

      setSuccess(`Receipt logged for ${projects.find((p) => p.id === projectId)?.name ?? 'project'}.`);
      setDescription('');
      setAmount('');
      setTradeType('');
      setFile(null);
      if (fileRef.current) fileRef.current.value = '';
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Save failed');
    } finally {
      setSubmitting(false);
    }
  }

  if (!user) return null;

  return (
    <div className="dashboard">
      <header>
        <h1>Job receipts</h1>
        <p className="muted">
          Snap a receipt at the supply house or after a cash payout — it gets
          logged to the project's budget so the bookkeeper doesn't have to chase
          paper.
        </p>
      </header>

      {error && <div className="form-error">{error}</div>}
      {success && <div className="form-success">{success}</div>}

      <section className="card">
        <h2>New receipt</h2>
        <p className="muted" style={{ fontSize: '0.85rem' }}>
          For contractor pay, use <strong>Sub bills</strong> instead — approving
          a bill auto-creates its own expense, so logging it again here would
          double-count.
        </p>
        <form onSubmit={submit}>
          <label>Photo of the receipt *</label>
          <input
            ref={fileRef}
            type="file"
            accept="image/*"
            capture="environment"
            onChange={(e) => setFile(e.target.files?.[0] ?? null)}
            required
          />
          {file && (
            <div className="muted" style={{ fontSize: '0.8rem', marginTop: '0.25rem' }}>
              {file.name} · {(file.size / 1024).toFixed(0)} KB
            </div>
          )}

          <div className="form-row" style={{ marginTop: '1rem' }}>
            <div>
              <label htmlFor="r-project">Project *</label>
              <select
                id="r-project"
                value={projectId}
                onChange={(e) => setProjectId(e.target.value)}
                required
              >
                <option value="">Pick a project…</option>
                {projects.map((p) => (
                  <option key={p.id} value={p.id}>{p.name}</option>
                ))}
              </select>
            </div>
            <div>
              <label htmlFor="r-trade">Trade *</label>
              <select
                id="r-trade"
                value={tradeType}
                onChange={(e) => setTradeType(e.target.value)}
                required
              >
                <option value="">Pick a trade…</option>
                {TRADES.map((t) => (
                  <option key={t} value={t}>{t}</option>
                ))}
              </select>
            </div>
          </div>

          <div className="form-row">
            <div>
              <label>Type *</label>
              <div style={{ display: 'flex', gap: '0.5rem', marginTop: '0.25rem' }}>
                <button
                  type="button"
                  className={kind === 'Materials' ? 'button' : 'button button-ghost'}
                  onClick={() => setKind('Materials')}
                  style={{ flex: 1 }}
                >
                  Material
                </button>
                <button
                  type="button"
                  className={kind === 'Labor' ? 'button' : 'button button-ghost'}
                  onClick={() => setKind('Labor')}
                  style={{ flex: 1 }}
                >
                  Labor
                </button>
              </div>
            </div>
            <div>
              <label htmlFor="r-amount">Amount (USD) *</label>
              <input
                id="r-amount"
                type="number"
                step="0.01"
                min="0.01"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                required
              />
            </div>
          </div>

          <div className="form-row">
            <div>
              <label htmlFor="r-date">Date *</label>
              <input
                id="r-date"
                type="date"
                value={date}
                onChange={(e) => setDate(e.target.value)}
                required
              />
            </div>
          </div>

          <label htmlFor="r-desc">Description *</label>
          <textarea
            id="r-desc"
            rows={2}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="e.g. PT lumber + fasteners for back-deck framing"
            required
          />

          <button type="submit" disabled={submitting}>
            {submitting ? 'Uploading…' : 'Log receipt'}
          </button>
        </form>
      </section>

      <section className="card">
        <h2>Recent receipts ({recent.length})</h2>
        {recent.length === 0 ? (
          <p className="muted">No receipts logged yet.</p>
        ) : (
          <table className="table">
            <thead>
              <tr>
                <th>Photo</th>
                <th>Date</th>
                <th>Project</th>
                <th>Trade</th>
                <th>Type</th>
                <th>Description</th>
                <th style={{ textAlign: 'right' }}>Amount</th>
              </tr>
            </thead>
            <tbody>
              {recent.map((r) => (
                <tr key={r.id}>
                  <td>
                    {r.receiptThumbnailUrl ? (
                      <a href={r.receiptUrl ?? '#'} target="_blank" rel="noreferrer">
                        <img
                          src={r.receiptThumbnailUrl}
                          alt="receipt"
                          style={{ width: 40, height: 40, objectFit: 'cover', borderRadius: 4 }}
                        />
                      </a>
                    ) : (
                      <span className="muted">—</span>
                    )}
                  </td>
                  <td>{formatDate(r.date)}</td>
                  <td>{r.project?.name ?? <span className="muted">—</span>}</td>
                  <td>{r.tradeType ?? <span className="muted">—</span>}</td>
                  <td>{r.category?.name ?? <span className="muted">—</span>}</td>
                  <td className="muted">{r.description ?? '—'}</td>
                  <td style={{ textAlign: 'right' }}>
                    <strong>{formatCents(r.amountCents)}</strong>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </div>
  );
}
