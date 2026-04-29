import { type FormEvent, useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { ApiError, api } from '../../lib/api';
import { formatCents } from '../../lib/format';

interface CustomerOption { id: string; name: string; email: string }
interface LeadOption { id: string; name: string; email: string | null }

interface ProductRef {
  id: string;
  name: string;
  unit: string | null;
  defaultUnitPriceCents: number;
  category: string | null;
  kind: string;
}
interface AssemblyRef {
  id: string;
  name: string;
  category: string | null;
}
interface AssemblyPreviewLine {
  description: string;
  quantity: number;
  unit: string | null;
  unitPriceCents: number;
  totalCents: number;
  category: string | null;
}

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
// productId === null means a hand-typed "Custom" line; otherwise it's a
// catalog product the rep selected in the Item dropdown. Either way the
// fields below are what gets sent to the server — productId is purely a
// UI affordance.
interface WorkingLine {
  productId: string | null;
  description: string;
  quantity: number;
  unit: string;
  unitPriceCents: number;
  category: 'Labor' | 'Materials';
  notes: string;
  position: number;
}

function blankLine(position: number): WorkingLine {
  return {
    productId: null,
    description: '',
    quantity: 1,
    unit: '',
    unitPriceCents: 0,
    category: 'Materials',
    notes: '',
    position,
  };
}

// Map a catalog product's free-form `kind` to one of our two budget
// buckets. Anything that isn't explicitly labor falls into Materials —
// the bucket the bookkeeper uses for everything that isn't payroll.
function categoryFromProduct(p: { kind: string; category: string | null }): 'Labor' | 'Materials' {
  if (p.kind === 'labor') return 'Labor';
  if (p.category === 'Labor') return 'Labor';
  return 'Materials';
}

function fromTemplate(t: Template): WorkingLine[] {
  return t.lines.map((l, idx) => ({
    productId: null,
    description: l.description,
    quantity: Number(l.defaultQuantity),
    unit: l.unit ?? '',
    unitPriceCents: l.unitPriceCents,
    category: l.category === 'Labor' ? 'Labor' : 'Materials',
    notes: l.notes ?? '',
    position: idx,
  }));
}

export default function NewEstimatePage() {
  const navigate = useNavigate();
  const [params] = useSearchParams();

  // Optional `seed` query param packs description/quantity/unit so the
  // calculators page can hand off a starting line without us needing a
  // dedicated round-trip API.
  const seedLine = useMemo<WorkingLine | null>(() => {
    const raw = params.get('seed');
    if (!raw) return null;
    try {
      const inner = new URLSearchParams(raw);
      const description = inner.get('description') ?? '';
      const quantity = Number(inner.get('quantity') ?? '1');
      const unit = inner.get('unit') ?? '';
      if (!description) return null;
      return {
        productId: null,
        description,
        quantity: Number.isFinite(quantity) && quantity > 0 ? quantity : 1,
        unit,
        unitPriceCents: 0,
        category: 'Materials' as const,
        notes: '',
        position: 0,
      };
    } catch {
      return null;
    }
  }, [params]);

  const [templates, setTemplates] = useState<Template[]>([]);
  const [customers, setCustomers] = useState<CustomerOption[]>([]);
  const [leads, setLeads] = useState<LeadOption[]>([]);
  const [products, setProducts] = useState<ProductRef[]>([]);
  const [assemblies, setAssemblies] = useState<AssemblyRef[]>([]);
  const [error, setError] = useState<string | null>(null);

  // Catalog picker state
  const [catalogOpen, setCatalogOpen] = useState(false);
  const [catalogTab, setCatalogTab] = useState<'products' | 'assemblies'>('products');
  const [catalogQuery, setCatalogQuery] = useState('');
  const [assemblyPreview, setAssemblyPreview] = useState<{
    id: string; name: string; lines: AssemblyPreviewLine[]; totalCents: number; quantity: number;
  } | null>(null);

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
  const [lines, setLines] = useState<WorkingLine[]>(() =>
    seedLine ? [seedLine] : [blankLine(0)],
  );
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    Promise.all([
      api<{ templates: Template[] }>('/api/estimate-templates'),
      api<{ users: CustomerOption[] }>('/api/portal/customers'),
      api<{ leads: LeadOption[] }>('/api/leads?pageSize=200').catch(() => ({ leads: [] as LeadOption[] })),
      api<{ products: ProductRef[] }>('/api/catalog/products').catch(() => ({ products: [] as ProductRef[] })),
      api<{ assemblies: AssemblyRef[] }>('/api/catalog/assemblies').catch(() => ({ assemblies: [] as AssemblyRef[] })),
    ])
      .then(([t, c, l, p, a]) => {
        setTemplates(t.templates);
        setCustomers(c.users);
        setLeads(l.leads ?? []);
        setProducts(p.products ?? []);
        setAssemblies(a.assemblies ?? []);
      })
      .catch((err) => setError(err instanceof ApiError ? err.message : 'Failed to load form data'));
  }, []);

  function addProductLine(p: ProductRef) {
    setLines((cur) => [
      ...cur,
      {
        productId: p.id,
        description: p.name,
        quantity: 1,
        unit: p.unit ?? '',
        unitPriceCents: p.defaultUnitPriceCents,
        category: categoryFromProduct(p),
        notes: '',
        position: cur.length,
      },
    ]);
  }

  // Inline Item-column dropdown picker: switching from Custom → product
  // (or product → product) overwrites the row with the catalog item.
  // Switching back to Custom keeps whatever description is already there.
  function pickItem(idx: number, productId: string | null) {
    setLines((cur) =>
      cur.map((l, i) => {
        if (i !== idx) return l;
        if (!productId) {
          // Going back to Custom — clear the product link but keep what
          // the rep had typed so they don't lose context.
          return { ...l, productId: null };
        }
        const p = products.find((x) => x.id === productId);
        if (!p) return l;
        return {
          ...l,
          productId: p.id,
          description: p.name,
          unit: p.unit ?? l.unit,
          unitPriceCents: p.defaultUnitPriceCents,
          category: categoryFromProduct(p),
        };
      }),
    );
  }

  async function previewAssembly(a: AssemblyRef) {
    try {
      const { lines: pl, totalCents } = await api<{ lines: AssemblyPreviewLine[]; totalCents: number }>(
        `/api/catalog/assemblies/${a.id}/preview`,
      );
      setAssemblyPreview({ id: a.id, name: a.name, lines: pl, totalCents, quantity: 1 });
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to preview');
    }
  }

  function addAssemblyLines() {
    if (!assemblyPreview) return;
    const qty = assemblyPreview.quantity || 1;
    setLines((cur) => [
      ...cur,
      ...assemblyPreview.lines.map((l, idx) => ({
        productId: null,
        description: l.description,
        quantity: l.quantity * qty,
        unit: l.unit ?? '',
        unitPriceCents: l.unitPriceCents,
        category: (l.category === 'Labor' ? 'Labor' : 'Materials') as 'Labor' | 'Materials',
        notes: '',
        position: cur.length + idx,
      })),
    ]);
    setAssemblyPreview(null);
    setCatalogOpen(false);
  }

  const filteredProducts = products.filter((p) =>
    !catalogQuery || p.name.toLowerCase().includes(catalogQuery.toLowerCase()),
  );
  const filteredAssemblies = assemblies.filter((a) =>
    !catalogQuery || a.name.toLowerCase().includes(catalogQuery.toLowerCase()),
  );

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
          <div style={{ display: 'flex', gap: '0.5rem' }}>
            <button type="button" className="button-ghost button-small" onClick={() => setCatalogOpen((v) => !v)}>
              {catalogOpen ? 'Close catalog' : '+ Add from catalog'}
            </button>
            <button type="button" className="button-ghost button-small" onClick={addLine}>
              + Blank line
            </button>
          </div>
        </div>

        {catalogOpen && (
          <div className="card" style={{ marginBottom: '1rem' }}>
            <div className="row-between">
              <div style={{ display: 'flex', gap: '0.5rem' }}>
                <button type="button" className={catalogTab === 'products' ? '' : 'button-ghost'} onClick={() => setCatalogTab('products')}>
                  Products ({filteredProducts.length})
                </button>
                <button type="button" className={catalogTab === 'assemblies' ? '' : 'button-ghost'} onClick={() => setCatalogTab('assemblies')}>
                  Assemblies ({filteredAssemblies.length})
                </button>
              </div>
              <input
                type="search"
                placeholder="Filter…"
                value={catalogQuery}
                onChange={(e) => setCatalogQuery(e.target.value)}
                style={{ marginBottom: 0, minWidth: 200 }}
              />
            </div>

            {catalogTab === 'products' && (
              <table className="table" style={{ marginTop: '0.75rem' }}>
                <thead><tr><th>Name</th><th>Category</th><th>Unit</th><th>Price</th><th></th></tr></thead>
                <tbody>
                  {filteredProducts.map((p) => (
                    <tr key={p.id}>
                      <td>{p.name}</td>
                      <td>{p.category ?? <span className="muted">—</span>}</td>
                      <td>{p.unit ?? '—'}</td>
                      <td>{formatCents(p.defaultUnitPriceCents)}</td>
                      <td>
                        <button type="button" className="button-small" onClick={() => addProductLine(p)}>
                          Add
                        </button>
                      </td>
                    </tr>
                  ))}
                  {filteredProducts.length === 0 && (
                    <tr><td colSpan={5} className="muted">No products. Admin can add them under /portal/catalog.</td></tr>
                  )}
                </tbody>
              </table>
            )}

            {catalogTab === 'assemblies' && (
              <>
                <table className="table" style={{ marginTop: '0.75rem' }}>
                  <thead><tr><th>Name</th><th>Category</th><th></th></tr></thead>
                  <tbody>
                    {filteredAssemblies.map((a) => (
                      <tr key={a.id}>
                        <td>{a.name}</td>
                        <td>{a.category ?? <span className="muted">—</span>}</td>
                        <td>
                          <button type="button" className="button-small" onClick={() => previewAssembly(a)}>
                            Preview
                          </button>
                        </td>
                      </tr>
                    ))}
                    {filteredAssemblies.length === 0 && (
                      <tr><td colSpan={3} className="muted">No assemblies yet.</td></tr>
                    )}
                  </tbody>
                </table>

                {assemblyPreview && (
                  <div style={{ marginTop: '1rem' }}>
                    <h3>{assemblyPreview.name}</h3>
                    <div className="form-row" style={{ gridTemplateColumns: '120px 1fr' }}>
                      <div>
                        <label>Quantity</label>
                        <input
                          type="number"
                          step="0.1"
                          min="0.1"
                          value={assemblyPreview.quantity}
                          onChange={(e) =>
                            setAssemblyPreview({ ...assemblyPreview, quantity: Number(e.target.value) || 1 })
                          }
                        />
                      </div>
                      <div style={{ alignSelf: 'end' }}>
                        <button type="button" onClick={addAssemblyLines}>
                          + Add {assemblyPreview.lines.length} lines ({formatCents(assemblyPreview.totalCents * assemblyPreview.quantity)})
                        </button>
                      </div>
                    </div>
                    <table className="table" style={{ marginTop: '0.5rem' }}>
                      <thead><tr><th>Description</th><th>Qty</th><th>Unit</th><th>Price</th><th>Total</th></tr></thead>
                      <tbody>
                        {assemblyPreview.lines.map((l, i) => (
                          <tr key={i}>
                            <td>{l.description}</td>
                            <td>{(l.quantity * assemblyPreview.quantity).toFixed(2)}</td>
                            <td>{l.unit ?? '—'}</td>
                            <td>{formatCents(l.unitPriceCents)}</td>
                            <td>{formatCents(l.totalCents * assemblyPreview.quantity)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </>
            )}
          </div>
        )}

        <table className="table estimate-lines">
          <thead>
            <tr>
              <th style={{ width: '34%' }}>Item</th>
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
              const isCustom = l.productId === null;
              return (
                <tr key={idx}>
                  <td>
                    <select
                      value={l.productId ?? ''}
                      onChange={(e) => pickItem(idx, e.target.value || null)}
                      style={{ marginBottom: 0 }}
                    >
                      <option value="">Custom — type your own</option>
                      {products.map((p) => (
                        <option key={p.id} value={p.id}>
                          {p.name}
                          {p.category ? ` (${p.category})` : ''}
                        </option>
                      ))}
                    </select>
                    {isCustom ? (
                      <input
                        value={l.description}
                        onChange={(e) => patchLine(idx, { description: e.target.value })}
                        placeholder="Describe the item / service"
                        required
                        style={{ marginTop: 4, marginBottom: 0 }}
                      />
                    ) : (
                      <div className="muted" style={{ fontSize: '0.75rem', marginTop: 4 }}>
                        From catalog · description locked to product name
                      </div>
                    )}
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
                    <select
                      value={l.category}
                      onChange={(e) =>
                        patchLine(idx, { category: e.target.value as 'Labor' | 'Materials' })
                      }
                      style={{ marginBottom: 0, width: 130 }}
                    >
                      <option value="Materials">Materials</option>
                      <option value="Labor">Labor</option>
                    </select>
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
