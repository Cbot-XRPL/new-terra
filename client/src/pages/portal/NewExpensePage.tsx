import { type FormEvent, useEffect, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { ApiError, api } from '../../lib/api';
import { pendingCount, queueOrPostExpense } from '../../lib/offlineQueue';

interface Vendor { id: string; name: string }
interface Category { id: string; name: string; parent: { id: string; name: string } | null }
interface ProjectRef { id: string; name: string }

function todayISODate(): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export default function NewExpensePage() {
  const navigate = useNavigate();

  const [vendors, setVendors] = useState<Vendor[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [projects, setProjects] = useState<ProjectRef[]>([]);

  const [vendorId, setVendorId] = useState('');
  const [newVendorName, setNewVendorName] = useState('');
  const [creatingVendor, setCreatingVendor] = useState(false);

  const [categoryId, setCategoryId] = useState('');
  const [projectId, setProjectId] = useState('');

  const [amount, setAmount] = useState('');
  const [date, setDate] = useState(todayISODate());
  const [description, setDescription] = useState('');
  const [notes, setNotes] = useState('');
  const [reimbursable, setReimbursable] = useState(false);

  const [receiptFile, setReceiptFile] = useState<File | null>(null);
  const [receiptPreview, setReceiptPreview] = useState<string | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [queueInfo, setQueueInfo] = useState<{ pending: number; lastQueued: number | null }>({
    pending: 0,
    lastQueued: null,
  });

  useEffect(() => {
    pendingCount().then((n) => setQueueInfo((cur) => ({ ...cur, pending: n }))).catch(() => undefined);
  }, []);

  // Revoke any active blob URL on unmount so a user who picked a photo
  // and then navigated away doesn't leak the object URL forever.
  useEffect(() => () => {
    if (receiptPreview) URL.revokeObjectURL(receiptPreview);
  }, [receiptPreview]);

  useEffect(() => {
    Promise.all([
      api<{ vendors: Vendor[] }>('/api/finance/vendors'),
      api<{ categories: Category[] }>('/api/finance/categories'),
      api<{ projects: ProjectRef[] }>('/api/projects').catch(() => ({ projects: [] })),
    ])
      .then(([v, c, p]) => {
        setVendors(v.vendors);
        setCategories(c.categories);
        setProjects(p.projects ?? []);
      })
      .catch((err) => setError(err instanceof ApiError ? err.message : 'Failed to load form data'));
  }, []);

  function pickReceipt(file: File | null) {
    setReceiptFile(file);
    if (receiptPreview) URL.revokeObjectURL(receiptPreview);
    setReceiptPreview(file ? URL.createObjectURL(file) : null);
  }

  // Hits the server-side OCR endpoint with the currently picked receipt
  // and prefills amount + description from whatever Tesseract finds.
  // Best-effort — admin can edit anything before saving.
  const [scanning, setScanning] = useState(false);
  const [ocrInfo, setOcrInfo] = useState<string | null>(null);
  async function scanReceipt() {
    if (!receiptFile) return;
    setScanning(true);
    setOcrInfo(null);
    setError(null);
    try {
      const apiBase = import.meta.env.VITE_API_URL ?? '';
      const token = localStorage.getItem('nt_token');
      const form = new FormData();
      form.append('receipt', receiptFile);
      const res = await fetch(`${apiBase}/api/finance/expenses/_ocr/scan`, {
        method: 'POST',
        headers: token ? { Authorization: `Bearer ${token}` } : {},
        body: form,
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) {
        setError(data?.error ?? 'Receipt scan failed');
        return;
      }
      const ex = data.extraction as {
        vendorGuess: string | null;
        totalCents: number | null;
        dateGuess: string | null;
      };
      const filled: string[] = [];
      if (ex.totalCents != null && !amount) {
        setAmount((ex.totalCents / 100).toFixed(2));
        filled.push(`amount $${(ex.totalCents / 100).toFixed(2)}`);
      }
      if (ex.vendorGuess && !description) {
        setDescription(ex.vendorGuess);
        filled.push(`description "${ex.vendorGuess}"`);
      }
      if (ex.dateGuess) {
        setDate(ex.dateGuess);
        filled.push(`date ${ex.dateGuess}`);
      }
      setOcrInfo(filled.length > 0
        ? `Filled ${filled.join(', ')} — edit anything before saving.`
        : 'OCR ran but couldn\'t guess fields. Fill in manually.');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Scan failed');
    } finally {
      setScanning(false);
    }
  }

  async function quickCreateVendor() {
    if (!newVendorName.trim()) return;
    setCreatingVendor(true);
    setError(null);
    try {
      const { vendor } = await api<{ vendor: Vendor }>('/api/finance/vendors', {
        method: 'POST',
        body: JSON.stringify({ name: newVendorName.trim() }),
      });
      setVendors((v) => [...v, vendor].sort((a, b) => a.name.localeCompare(b.name)));
      setVendorId(vendor.id);
      setNewVendorName('');
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to create vendor');
    } finally {
      setCreatingVendor(false);
    }
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    const cents = Math.round(Number(amount) * 100);
    if (!Number.isFinite(cents) || cents < 0) {
      setError('Enter a valid amount');
      return;
    }
    setSubmitting(true);
    try {
      const form = new FormData();
      if (vendorId) form.append('vendorId', vendorId);
      if (categoryId) form.append('categoryId', categoryId);
      if (projectId) form.append('projectId', projectId);
      form.append('amountCents', String(cents));
      form.append('date', new Date(date).toISOString());
      if (description) form.append('description', description);
      if (notes) form.append('notes', notes);
      form.append('reimbursable', String(reimbursable));
      if (receiptFile) form.append('receipt', receiptFile);

      const result = await queueOrPostExpense(form);
      if (result.ok && result.sent) {
        navigate(`/portal/finance/expenses/${(result.expense as { id: string }).id}`);
      } else if (result.ok && !result.sent) {
        // Queued offline. Show feedback + reset the form so the next receipt
        // can go in immediately. Replay happens automatically on reconnect.
        const pending = await pendingCount();
        setQueueInfo({ pending, lastQueued: result.queuedAt });
        setReceiptFile(null);
        if (receiptPreview) URL.revokeObjectURL(receiptPreview);
        setReceiptPreview(null);
        setAmount('');
        setDescription('');
      } else if (!result.ok) {
        setError(result.error);
      }
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to save expense');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="dashboard">
      <header>
        <Link to="/portal/finance" className="muted">← Finance</Link>
        <h1>Add receipt</h1>
        <p className="muted">
          Snap a photo, fill in the basics. Tag the project so it shows up in job costing.
        </p>
      </header>

      {error && <div className="form-error">{error}</div>}
      {ocrInfo && <div className="form-success">{ocrInfo}</div>}

      {queueInfo.pending > 0 && (
        <div className="form-success">
          {queueInfo.pending} receipt{queueInfo.pending === 1 ? '' : 's'} waiting to upload — will
          send automatically when you're back online.
        </div>
      )}
      {queueInfo.lastQueued && (
        <div className="form-success">
          Saved offline. We'll upload it as soon as you're connected.
        </div>
      )}

      <section className="card">
        <form onSubmit={submit}>
          <div className="form-row">
            <div>
              <label htmlFor="x-amount">Amount (USD)</label>
              <input
                id="x-amount"
                type="number"
                step="0.01"
                min="0"
                inputMode="decimal"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                required
                autoFocus
              />
            </div>
            <div>
              <label htmlFor="x-date">Date</label>
              <input
                id="x-date"
                type="date"
                value={date}
                onChange={(e) => setDate(e.target.value)}
                required
              />
            </div>
          </div>

          <div className="form-row">
            <div>
              <label htmlFor="x-vendor">Vendor</label>
              <select id="x-vendor" value={vendorId} onChange={(e) => setVendorId(e.target.value)}>
                <option value="">Select…</option>
                {vendors.map((v) => (
                  <option key={v.id} value={v.id}>{v.name}</option>
                ))}
              </select>
              <div style={{ display: 'flex', gap: '0.5rem', marginTop: '0.25rem' }}>
                <input
                  type="text"
                  placeholder="Or add new vendor…"
                  value={newVendorName}
                  onChange={(e) => setNewVendorName(e.target.value)}
                  style={{ marginBottom: 0 }}
                />
                <button
                  type="button"
                  className="button-ghost button-small"
                  onClick={quickCreateVendor}
                  disabled={creatingVendor || !newVendorName.trim()}
                >
                  {creatingVendor ? 'Adding…' : 'Add'}
                </button>
              </div>
            </div>
            <div>
              <label htmlFor="x-category">Category</label>
              <select id="x-category" value={categoryId} onChange={(e) => setCategoryId(e.target.value)}>
                <option value="">Uncategorised</option>
                {categories.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.parent ? `${c.parent.name} › ` : ''}{c.name}
                  </option>
                ))}
              </select>
              {categories.length === 0 && (
                <p className="muted" style={{ fontSize: '0.8rem' }}>
                  No categories yet — accounting can add them under the finance section.
                </p>
              )}
            </div>
          </div>

          <label htmlFor="x-project">Project (optional)</label>
          <select id="x-project" value={projectId} onChange={(e) => setProjectId(e.target.value)}>
            <option value="">— not tied to a project —</option>
            {projects.map((p) => (
              <option key={p.id} value={p.id}>{p.name}</option>
            ))}
          </select>

          <label htmlFor="x-desc">Description</label>
          <input
            id="x-desc"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="e.g. 8 sheets 3/4 plywood"
          />

          <label htmlFor="x-notes">Notes</label>
          <textarea
            id="x-notes"
            rows={2}
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
          />

          <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            <input
              type="checkbox"
              checked={reimbursable}
              onChange={(e) => setReimbursable(e.target.checked)}
              style={{ width: 'auto' }}
            />
            <span>Reimbursable — paid out of pocket</span>
          </label>

          <h3 style={{ marginTop: '1rem' }}>Receipt</h3>
          <div style={{ display: 'flex', gap: '1rem', alignItems: 'flex-start', flexWrap: 'wrap' }}>
            {receiptPreview && (
              <img
                src={receiptPreview}
                alt="receipt preview"
                style={{ maxWidth: 200, maxHeight: 240, borderRadius: 8, border: '1px solid var(--border)' }}
              />
            )}
            <div>
              <input
                ref={fileInput}
                type="file"
                accept="image/*"
                capture="environment"
                style={{ display: 'none' }}
                onChange={(e) => pickReceipt(e.target.files?.[0] ?? null)}
              />
              <button
                type="button"
                className="button-ghost"
                onClick={() => fileInput.current?.click()}
              >
                {receiptFile ? 'Change photo' : 'Upload / take photo'}
              </button>
              {receiptFile && (
                <button
                  type="button"
                  className="button-ghost button-small"
                  onClick={scanReceipt}
                  disabled={scanning}
                  style={{ marginLeft: '0.5rem' }}
                  title="Run OCR to fill amount + description"
                >
                  {scanning ? 'Scanning…' : 'Scan to prefill'}
                </button>
              )}
              {receiptFile && (
                <button
                  type="button"
                  className="button-ghost button-small"
                  onClick={() => pickReceipt(null)}
                  style={{ marginLeft: '0.5rem' }}
                >
                  Remove
                </button>
              )}
              <p className="muted" style={{ fontSize: '0.8rem', maxWidth: 320 }}>
                Optional. We resize to 1600px and generate a 320px thumbnail. Up to 10 MB.
              </p>
            </div>
          </div>

          <div style={{ display: 'flex', gap: '0.5rem', marginTop: '1rem' }}>
            <button type="submit" disabled={submitting || !amount}>
              {submitting ? 'Saving…' : 'Save expense'}
            </button>
            <Link to="/portal/finance" className="button-ghost button">
              Cancel
            </Link>
          </div>
        </form>
      </section>
    </div>
  );
}
