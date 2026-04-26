import { type FormEvent, useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { ApiError, api } from '../../lib/api';
import { formatCents } from '../../lib/format';

interface CustomerOption { id: string; name: string; email: string }
interface LeadOption { id: string; name: string; email: string | null }

interface TemplateLine {
  id: string;
  description: string;
  defaultQuantity: string; // Prisma Decimal arrives as string
  unit: string | null;
  unitPriceCents: number;
  category: string | null;
  notes: string | null;
  position: number;
}
interface Template {
  id: string;
  name: string;
  description: string | null;
  category: string | null;
  active: boolean;
  lines: TemplateLine[];
}

// Working line shape (numbers, not Decimal strings) for the in-form table.
interface WorkingLine {
  description: string;
  quantity: number;
  unit: string;
  unitPriceCents: number;
  category: string;
  notes: string;
  position: number;
}

function blankLine(position: number): WorkingLine {
  return { description: '', quantity: 1, unit: '', unitPriceCents: 0, category: '', notes: '', position };
}

function fromTemplate(t: Template): WorkingLine[] {
  return t.lines.map((l, idx) => ({
    description: l.description,
    quantity: Number(l.defaultQuantity),
    unit: l.unit ?? '',
    unitPriceCents: l.unitPriceCents,
    category: l.category ?? '',
    notes: l.notes ?? '',
    position: idx,
  }));
}

export default function NewEstimatePage() {
  const navigate = useNavigate();

  const [templates, setTemplates] = useState<Template[]>([]);
  const [customers, setCustomers] = useState<CustomerOption[]>([]);
  const [leads, setLeads] = useState<LeadOption[]>([]);
  const [error, setError] = useState<string | null>(null);

  const [templateId, setTemplateId] = useState('');
  const [customerId, setCustomerId] = useState('');
  const [leadId, setLeadId] = useState('');
  const [title, setTitle] = useState('');
  const [scope, setScope] = useState('');
  const [notes, setNotes] = useState('');
  const [termsText, setTermsText] = useState(
    'Materials and labor as described above. Estimate valid 30 days. 50% deposit due at signing; balance due on completion.',
  );
  const [taxRatePct, setTaxRatePct] = useState('0');
  const [validUntil, setValidUntil] = useState('');
  const [lines, setLines] = useState<WorkingLine[]>([blankLine(0)]);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    Promise.all([
      api<{ templates: Template[] }>('/api/estimate-templates'),
      api<{ users: CustomerOption[] }>('/api/portal/customers'),
      api<{ leads: LeadOption[] }>('/api/leads?pageSize=200').catch(() => ({ leads: [] as LeadOption[] })),
    ])
      .then(([t, c, l]) => {
        setTemplates(t.templates);
        setCustomers(c.users);
        setLeads(l.leads ?? []);
      })
      .catch((err) => setError(err instanceof ApiError ? err.message : 'Failed to load form data'));
  }, []);

  // Apply a template — replaces lines and prefills title if blank.
  function applyTemplate(id: string) {
    setTemplateId(id);
    if (!id) return;
    const t = templates.find((x) => x.id === id);
    if (!t) return;
    if (!title) setTitle(t.name);
    setLines(fromTemplate(t));
  }

  function patchLine(idx: number, patch: Partial<WorkingLine>) {
    setLines((cur) => cur.map((l, i) => (i === idx ? { ...l, ...patch } : l)));
  }
  function addLine() {
    setLines((cur) => [...cur, blankLine(cur.length)]);
  }
  function removeLine(idx: number) {
    setLines((cur) => cur.filter((_, i) => i !== idx).map((l, i) => ({ ...l, position: i })));
  }

  // Live totals — keep all math in cents to dodge float drift.
  const subtotal = useMemo(
    () => lines.reduce((s, l) => s + Math.round(l.quantity * l.unitPriceCents), 0),
    [lines],
  );
  const taxBps = useMemo(() => {
    const n = Number(taxRatePct);
    if (!Number.isFinite(n) || n < 0) return 0;
    return Math.round(n * 100); // 7.5% → 750
  }, [taxRatePct]);
  const tax = Math.round((subtotal * taxBps) / 10_000);
  const total = subtotal + tax;

  // Group line totals by category for the by-category subtotal display.
  const byCategory = useMemo(() => {
    const map = new Map<string, number>();
    for (const l of lines) {
      const key = l.category || 'Uncategorised';
      const lineTotal = Math.round(l.quantity * l.unitPriceCents);
      map.set(key, (map.get(key) ?? 0) + lineTotal);
    }
    return [...map.entries()];
  }, [lines]);

  async function submit(e: FormEvent, send: boolean) {
    e.preventDefault();
    if (!customerId && !leadId) {
      setError('Pick a customer or a lead');
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      const payload = {
        templateId: templateId || null,
        customerId: customerId || null,
        leadId: leadId || null,
        title,
        scope: scope || undefined,
        notes: notes || undefined,
        termsText: termsText || undefined,
        taxRateBps: taxBps,
        validUntil: validUntil ? new Date(validUntil).toISOString() : null,
        lines: lines.map((l, idx) => ({
          description: l.description,
          quantity: l.quantity,
          unit: l.unit || undefined,
          unitPriceCents: l.unitPriceCents,
          category: l.category || undefined,
          notes: l.notes || undefined,
          position: idx,
        })),
      };
      const created = await api<{ estimate: { id: string } }>('/api/estimates', {
        method: 'POST',
        body: JSON.stringify(payload),
      });
      if (send) {
        await api(`/api/estimates/${created.estimate.id}/send`, { method: 'POST' });
      }
      navigate(`/portal/estimates/${created.estimate.id}`);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to save estimate');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="dashboard">
      <header>
        <Link to="/portal/estimates" className="muted">← Estimates</Link>
        <h1>New estimate</h1>
        <p className="muted">
          Pick a template to seed line items, then fill in quantities and prices.
          Saves as a draft until you send it to the customer.
        </p>
      </header>

      {error && <div className="form-error">{error}</div>}

      <section className="card">
        <div className="form-row">
          <div>
            <label>Template (optional)</label>
            <select value={templateId} onChange={(e) => applyTemplate(e.target.value)}>
              <option value="">Start blank</option>
              {templates.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.category ? `${t.category} › ` : ''}{t.name}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label>Title</label>
            <input value={title} onChange={(e) => setTitle(e.target.value)} required />
          </div>
        </div>

        <div className="form-row">
          <div>
            <label>Customer</label>
            <select value={customerId} onChange={(e) => { setCustomerId(e.target.value); if (e.target.value) setLeadId(''); }}>
              <option value="">— or use a lead below —</option>
              {customers.map((c) => (
                <option key={c.id} value={c.id}>{c.name} ({c.email})</option>
              ))}
            </select>
          </div>
          <div>
            <label>Lead (estimating before they're a customer)</label>
            <select value={leadId} onChange={(e) => { setLeadId(e.target.value); if (e.target.value) setCustomerId(''); }}>
              <option value="">— or use a customer above —</option>
              {leads.map((l) => (
                <option key={l.id} value={l.id}>{l.name}{l.email ? ` (${l.email})` : ''}</option>
              ))}
            </select>
          </div>
        </div>

        <label>Scope (visible to the customer)</label>
        <textarea rows={3} value={scope} onChange={(e) => setScope(e.target.value)} />

        <div className="form-row">
          <div>
            <label>Tax rate (%)</label>
            <input
              type="number"
              step="0.01"
              min="0"
              max="100"
              value={taxRatePct}
              onChange={(e) => setTaxRatePct(e.target.value)}
            />
          </div>
          <div>
            <label>Valid until (optional)</label>
            <input type="date" value={validUntil} onChange={(e) => setValidUntil(e.target.value)} />
          </div>
        </div>
      </section>

      <section className="card">
        <div className="row-between">
          <h2>Line items</h2>
          <button type="button" className="button-ghost button-small" onClick={addLine}>
            + Add line
          </button>
        </div>

        <table className="table estimate-lines">
          <thead>
            <tr>
              <th style={{ width: '32%' }}>Description</th>
              <th>Qty</th>
              <th>Unit</th>
              <th>Price</th>
              <th>Category</th>
              <th>Total</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {lines.map((l, idx) => {
              const total = Math.round(l.quantity * l.unitPriceCents);
              return (
                <tr key={idx}>
                  <td>
                    <input
                      value={l.description}
                      onChange={(e) => patchLine(idx, { description: e.target.value })}
                      placeholder="e.g. 2x6x12 PT lumber"
                      style={{ marginBottom: 0 }}
                    />
                  </td>
                  <td>
                    <input
                      type="number"
                      step="0.001"
                      min="0"
                      value={l.quantity}
                      onChange={(e) => patchLine(idx, { quantity: Number(e.target.value) })}
                      style={{ marginBottom: 0, width: 80 }}
                    />
                  </td>
                  <td>
                    <input
                      value={l.unit}
                      onChange={(e) => patchLine(idx, { unit: e.target.value })}
                      placeholder="ea, lf, hr"
                      style={{ marginBottom: 0, width: 70 }}
                    />
                  </td>
                  <td>
                    <input
                      type="number"
                      step="0.01"
                      min="0"
                      value={(l.unitPriceCents / 100).toFixed(2)}
                      onChange={(e) =>
                        patchLine(idx, { unitPriceCents: Math.round(Number(e.target.value) * 100) })
                      }
                      style={{ marginBottom: 0, width: 100 }}
                    />
                  </td>
                  <td>
                    <input
                      value={l.category}
                      onChange={(e) => patchLine(idx, { category: e.target.value })}
                      placeholder="Materials"
                      style={{ marginBottom: 0, width: 120 }}
                    />
                  </td>
                  <td><strong>{formatCents(total)}</strong></td>
                  <td>
                    <button
                      type="button"
                      className="button-ghost button-small"
                      onClick={() => removeLine(idx)}
                      title="Remove"
                    >
                      ×
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>

        <div className="form-row" style={{ marginTop: '1rem' }}>
          <div>
            <h3 style={{ marginTop: 0 }}>Subtotal by category</h3>
            <table className="table">
              <tbody>
                {byCategory.map(([cat, amt]) => (
                  <tr key={cat}>
                    <td>{cat}</td>
                    <td>{formatCents(amt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div>
            <h3 style={{ marginTop: 0 }}>Totals</h3>
            <dl className="kv">
              <dt>Subtotal</dt>
              <dd>{formatCents(subtotal)}</dd>
              <dt>Tax ({(taxBps / 100).toFixed(2)}%)</dt>
              <dd>{formatCents(tax)}</dd>
              <dt><strong>Total</strong></dt>
              <dd><strong>{formatCents(total)}</strong></dd>
            </dl>
          </div>
        </div>
      </section>

      <section className="card">
        <h2>Internal notes</h2>
        <textarea rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} />

        <h2 style={{ marginTop: '1rem' }}>Terms (visible to customer)</h2>
        <textarea rows={4} value={termsText} onChange={(e) => setTermsText(e.target.value)} />

        <div style={{ display: 'flex', gap: '0.5rem', marginTop: '1rem' }}>
          <button type="button" className="button-ghost" onClick={(e) => submit(e, false)} disabled={submitting}>
            {submitting ? 'Saving…' : 'Save as draft'}
          </button>
          <button type="button" onClick={(e) => submit(e, true)} disabled={submitting || !customerId}>
            {submitting ? 'Sending…' : 'Save & send to customer'}
          </button>
        </div>
        {!customerId && (
          <p className="muted" style={{ fontSize: '0.85rem', marginTop: '0.5rem' }}>
            Pick a customer (not just a lead) to send. Lead-only estimates can be saved as drafts.
          </p>
        )}
      </section>
    </div>
  );
}
