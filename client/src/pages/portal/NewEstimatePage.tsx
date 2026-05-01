import { type FormEvent, useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { ApiError, api } from '../../lib/api';
import { formatCents } from '../../lib/format';
import ProductCombobox from '../../components/ProductCombobox';

interface CustomerOption { id: string; name: string; email: string }
interface LeadOption { id: string; name: string; email: string | null }

interface ProductRef {
  id: string;
  name: string;
  unit: string | null;
  defaultUnitPriceCents: number;
  category: string | null;
  kind: string;
  // Set on auto-generated labor products that mirror a contractor /
  // employee user. Picking such a product on a line auto-fills
  // contractorId so the PM rollup wires up without a second click.
  contractorUserId: string | null;
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
  // Optional sub-contractor attribution. Customer never sees the name
  // (server masks it). PMs get a "who do I owe" rollup off this.
  contractorId: string | null;
  // Per-line trade label override (Demo, Framing, Electrical, …). Falls
  // back to the contractor's baseline tradeType when blank.
  displayTrade: string;
  // Xactimate-style action variant: '', 'REPLACE', 'RR', 'DR', 'CLEAN'.
  // Empty string means "unspecified" — the line renders as just its
  // description without a variant tag.
  action: string;
}

const LINE_ACTION_OPTIONS: Array<{ value: string; label: string }> = [
  { value: '', label: '— Action —' },
  { value: 'REPLACE', label: 'Replace' },
  { value: 'RR', label: 'Remove & Replace' },
  { value: 'DR', label: 'Detach & Reset' },
  { value: 'CLEAN', label: 'Clean only' },
];

interface ContractorOption {
  id: string;
  name: string;
  email: string;
  tradeType: string | null;
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
    contractorId: null,
    displayTrade: '',
    action: '',
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
    contractorId: null,
    displayTrade: '',
    action: '',
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
        contractorId: null,
        displayTrade: '',
        action: '',
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
  const [contractors, setContractors] = useState<ContractorOption[]>([]);
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
  const [markupPct, setMarkupPct] = useState('20');
  const [previewCustomer, setPreviewCustomer] = useState(false);
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
      api<{ users: ContractorOption[] }>('/api/portal/staff/contractors').catch(
        () => ({ users: [] as ContractorOption[] }),
      ),
    ])
      .then(([t, c, l, p, a, ctr]) => {
        setTemplates(t.templates);
        setCustomers(c.users);
        setLeads(l.leads ?? []);
        setProducts(p.products ?? []);
        setAssemblies(a.assemblies ?? []);
        setContractors(ctr.users ?? []);
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
        contractorId: null,
        displayTrade: '',
        action: '',
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
        // Auto-attach the contractor when the picked product is one of
        // the auto-generated labor mirrors. Pre-fill the trade label from
        // the contractor's baseline if it wasn't already set on the line.
        const contractorId = p.contractorUserId ?? l.contractorId;
        const matchedContractor = p.contractorUserId
          ? contractors.find((c) => c.id === p.contractorUserId)
          : null;
        const displayTrade =
          l.displayTrade || matchedContractor?.tradeType || (l.displayTrade ?? '');
        return {
          ...l,
          productId: p.id,
          description: p.name,
          unit: p.unit ?? l.unit,
          unitPriceCents: p.defaultUnitPriceCents,
          category: categoryFromProduct(p),
          contractorId,
          displayTrade,
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
        contractorId: null,
        displayTrade: '',
        action: '',
      })),
    ]);
    setAssemblyPreview(null);
    setCatalogOpen(false);
  }

  // Picker dialog list — filter by name OR category OR unit so a rep can
  // type "framing", "electrical", "lf", etc. and narrow quickly.
  const filteredProducts = useMemo(() => {
    const q = catalogQuery.trim().toLowerCase();
    if (!q) return products;
    return products.filter(
      (p) =>
        p.name.toLowerCase().includes(q) ||
        (p.category?.toLowerCase().includes(q) ?? false) ||
        (p.unit?.toLowerCase().includes(q) ?? false),
    );
  }, [products, catalogQuery]);
  const filteredAssemblies = useMemo(() => {
    const q = catalogQuery.trim().toLowerCase();
    if (!q) return assemblies;
    return assemblies.filter(
      (a) =>
        a.name.toLowerCase().includes(q) ||
        (a.category?.toLowerCase().includes(q) ?? false),
    );
  }, [assemblies, catalogQuery]);

  // Picker dialog sort. Default order matches the API (creation order).
  type PickSortKey = 'name' | 'category' | 'unit' | 'price';
  const [pickSort, setPickSort] = useState<PickSortKey | null>(null);
  const [pickDir, setPickDir] = useState<'asc' | 'desc'>('asc');
  function togglePickSort(k: PickSortKey) {
    if (pickSort === k) setPickDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    else { setPickSort(k); setPickDir('asc'); }
  }
  function pickIndicator(k: PickSortKey) {
    return pickSort === k ? (pickDir === 'asc' ? ' ▲' : ' ▼') : '';
  }
  const sortedFilteredProducts = useMemo(() => {
    if (!pickSort) return filteredProducts;
    const dir = pickDir === 'asc' ? 1 : -1;
    const cmpStr = (a: string, b: string) =>
      a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' });
    return [...filteredProducts].sort((a, b) => {
      switch (pickSort) {
        case 'name':     return dir * cmpStr(a.name, b.name);
        case 'category': return dir * cmpStr(a.category ?? '', b.category ?? '');
        case 'unit':     return dir * cmpStr(a.unit ?? '', b.unit ?? '');
        case 'price':    return dir * (a.defaultUnitPriceCents - b.defaultUnitPriceCents);
        default: return 0;
      }
    });
  }, [filteredProducts, pickSort, pickDir]);

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
  // unitPriceCents on each line is our IN-HOUSE COST. The customer sees
  // unitPriceCents * (1 + markupBps/10_000). We compute both so the rep
  // can see margin while building the estimate.
  const subtotalCost = useMemo(
    () => lines.reduce((s, l) => s + Math.round(l.quantity * l.unitPriceCents), 0),
    [lines],
  );
  const taxBps = useMemo(() => {
    const n = Number(taxRatePct);
    if (!Number.isFinite(n) || n < 0) return 0;
    return Math.round(n * 100);
  }, [taxRatePct]);
  const markupBps = useMemo(() => {
    const n = Number(markupPct);
    if (!Number.isFinite(n) || n < 0) return 0;
    return Math.min(10_000, Math.round(n * 100));
  }, [markupPct]);
  const taxCost = Math.round((subtotalCost * taxBps) / 10_000);
  const totalCost = subtotalCost + taxCost;

  const subtotalCustomer = Math.round(subtotalCost * (1 + markupBps / 10_000));
  const taxCustomer = Math.round((subtotalCustomer * taxBps) / 10_000);
  const totalCustomer = subtotalCustomer + taxCustomer;
  const grossMargin = totalCustomer - totalCost;

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
        markupBps,
        validUntil: validUntil ? new Date(validUntil).toISOString() : null,
        lines: lines.map((l, idx) => ({
          description: l.description,
          quantity: l.quantity,
          unit: l.unit || undefined,
          unitPriceCents: l.unitPriceCents,
          category: l.category || undefined,
          notes: l.notes || undefined,
          position: idx,
          contractorId: l.contractorId || null,
          displayTrade: l.displayTrade.trim() || null,
          action: l.action || null,
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
      {previewCustomer && (
        <div
          className="form-success"
          style={{
            background: 'var(--accent)',
            color: '#fff',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: '0.75rem',
          }}
        >
          <span>
            Customer preview · prices show with {(markupBps / 100).toFixed(1)}% markup
          </span>
          <button
            type="button"
            className="button-ghost button-small"
            onClick={() => setPreviewCustomer(false)}
            style={{ color: '#fff', borderColor: '#fff' }}
          >
            Exit preview
          </button>
        </div>
      )}

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
                <thead>
                  <tr>
                    <th className="sortable" onClick={() => togglePickSort('name')}>Name{pickIndicator('name')}</th>
                    <th className="sortable" onClick={() => togglePickSort('category')}>Category{pickIndicator('category')}</th>
                    <th className="sortable" onClick={() => togglePickSort('unit')}>Unit{pickIndicator('unit')}</th>
                    <th className="sortable" onClick={() => togglePickSort('price')}>Price{pickIndicator('price')}</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {sortedFilteredProducts.map((p) => (
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
                  {sortedFilteredProducts.length === 0 && (
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
              // Display price + total honour the preview toggle: in
              // preview the rep sees what the customer will see (after
              // markup); in build mode they see in-house cost.
              const factor = previewCustomer ? 1 + markupBps / 10_000 : 1;
              const displayUnit = Math.round(l.unitPriceCents * factor);
              const total = Math.round(l.quantity * displayUnit);
              const isCustom = l.productId === null;
              return (
                <tr key={idx}>
                  <td>
                    <ProductCombobox
                      products={products}
                      selectedId={l.productId}
                      onSelect={(pid) => pickItem(idx, pid)}
                    />
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
                    {/* Contractor attribution — optional, only useful on
                        labor lines. The customer never sees the
                        contractor's name (server masks it); they see the
                        per-line trade label below. */}
                    {contractors.length > 0 && (
                      <div style={{ display: 'flex', gap: 4, marginTop: 6, flexWrap: 'wrap' }}>
                        <select
                          value={l.contractorId ?? ''}
                          onChange={(e) => {
                            const id = e.target.value || null;
                            const c = contractors.find((c) => c.id === id);
                            patchLine(idx, {
                              contractorId: id,
                              // Pre-fill the trade label from the contractor's
                              // baseline only if the rep hasn't typed one yet.
                              displayTrade: l.displayTrade || c?.tradeType || '',
                              // A line with a contractor is implicitly Labor.
                              category: id ? 'Labor' : l.category,
                            });
                          }}
                          style={{ marginBottom: 0, flex: '1 1 140px', minWidth: 0 }}
                          title="Pay this line to a contractor (hidden from customer)"
                        >
                          <option value="">No contractor</option>
                          {contractors.map((c) => (
                            <option key={c.id} value={c.id}>
                              {c.name}{c.tradeType ? ` · ${c.tradeType}` : ''}
                            </option>
                          ))}
                        </select>
                        {l.contractorId && (
                          <input
                            value={l.displayTrade}
                            onChange={(e) => patchLine(idx, { displayTrade: e.target.value })}
                            placeholder="Customer sees…"
                            title="Trade label shown to the customer (e.g. Demo, Framing). Leave blank to use the contractor's baseline."
                            style={{ marginBottom: 0, flex: '1 1 100px', minWidth: 0 }}
                          />
                        )}
                      </div>
                    )}
                    {/* Action variant lives on every line, contractor or
                        not — Xactimate-style "what's happening to this
                        thing" tag. Empty == unspecified. */}
                    <div style={{ marginTop: 4 }}>
                      <select
                        value={l.action}
                        onChange={(e) => patchLine(idx, { action: e.target.value })}
                        title="Action variant — Replace, Remove & Replace, Detach & Reset, Clean only"
                        style={{ marginBottom: 0, width: '100%' }}
                      >
                        {LINE_ACTION_OPTIONS.map((o) => (
                          <option key={o.value} value={o.value}>{o.label}</option>
                        ))}
                      </select>
                    </div>
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
                    {previewCustomer ? (
                      // Preview mode is read-only — show the marked-up
                      // price the customer would see, no editing.
                      <span title="Customer-facing price (after markup)">
                        {formatCents(displayUnit)}
                      </span>
                    ) : (
                      <input
                        type="number"
                        step="0.01"
                        min="0"
                        value={(l.unitPriceCents / 100).toFixed(2)}
                        onChange={(e) =>
                          patchLine(idx, { unitPriceCents: Math.round(Number(e.target.value) * 100) })
                        }
                        style={{ marginBottom: 0, width: 100 }}
                        title="In-house cost per unit"
                      />
                    )}
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
            <div style={{ marginBottom: '0.75rem' }}>
              <label htmlFor="e-markup">Markup % (applied at customer view)</label>
              <input
                id="e-markup"
                type="number"
                step="0.5"
                min="0"
                max="100"
                value={markupPct}
                onChange={(e) => setMarkupPct(e.target.value)}
                style={{ width: 100 }}
              />
            </div>
            <dl className="kv">
              <dt className="muted">In-house subtotal</dt>
              <dd className="muted">{formatCents(subtotalCost)}</dd>
              <dt className="muted">In-house tax</dt>
              <dd className="muted">{formatCents(taxCost)}</dd>
              <dt className="muted">In-house total</dt>
              <dd className="muted">{formatCents(totalCost)}</dd>
              <dt>Customer subtotal</dt>
              <dd>{formatCents(subtotalCustomer)}</dd>
              <dt>Tax ({(taxBps / 100).toFixed(2)}%)</dt>
              <dd>{formatCents(taxCustomer)}</dd>
              <dt><strong>Customer total</strong></dt>
              <dd><strong>{formatCents(totalCustomer)}</strong></dd>
              <dt style={{ color: 'var(--success)' }}>Gross margin</dt>
              <dd style={{ color: 'var(--success)' }}>
                <strong>{formatCents(grossMargin)}</strong>
                {totalCustomer > 0 && (
                  <span className="muted" style={{ marginLeft: 6, fontSize: '0.85rem' }}>
                    ({((grossMargin / totalCustomer) * 100).toFixed(1)}%)
                  </span>
                )}
              </dd>
            </dl>
            <button
              type="button"
              className="button-ghost button-small"
              onClick={() => setPreviewCustomer((v) => !v)}
              style={{ marginTop: '0.5rem' }}
            >
              {previewCustomer ? 'Back to build view' : 'Preview customer view'}
            </button>
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
