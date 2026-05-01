import { type FormEvent, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { ApiError, api } from '../../lib/api';
import { useAuth } from '../../auth/AuthContext';
import { formatCents } from '../../lib/format';

interface Product {
  id: string;
  sku: string | null;
  name: string;
  kind: string;
  unit: string | null;
  defaultUnitPriceCents: number;
  // Optional labor + material split. When both 0 the row is "lump"
  // (legacy). When set, totals roll up separately for job-cost and
  // future regional-pricing overlays.
  defaultLaborCents?: number;
  defaultMaterialCents?: number;
  category: string | null;
  active: boolean;
  trackInventory?: boolean;
  onHandQtyMilli?: number;
  reorderThresholdMilli?: number;
  vendor: { id: string; name: string } | null;
}

interface Assembly {
  id: string;
  name: string;
  description: string | null;
  category: string | null;
  active: boolean;
  _count: { lines: number };
}

interface AssemblyDetail extends Assembly {
  lines: Array<{
    id: string;
    productId: string | null;
    subAssemblyId: string | null;
    quantity: string;
    unitPriceOverrideCents: number | null;
    description: string | null;
    category: string | null;
    position: number;
    product: { id: string; name: string; unit: string | null; defaultUnitPriceCents: number } | null;
    subAssembly: { id: string; name: string } | null;
  }>;
}

interface PreviewLine {
  description: string;
  quantity: number;
  unit: string | null;
  unitPriceCents: number;
  totalCents: number;
  category: string | null;
}

export default function CatalogPage() {
  const { user } = useAuth();
  const isAdmin = user?.role === 'ADMIN';
  const [tab, setTab] = useState<'products' | 'assemblies'>('products');
  const [products, setProducts] = useState<Product[]>([]);
  const [assemblies, setAssemblies] = useState<Assembly[]>([]);
  const [openAssembly, setOpenAssembly] = useState<AssemblyDetail | null>(null);
  const [preview, setPreview] = useState<{ lines: PreviewLine[]; totalCents: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);

  // Bulk-select state — Set keyed by id so toggle is O(1).
  const [selectedProducts, setSelectedProducts] = useState<Set<string>>(new Set());
  const [selectedAssemblies, setSelectedAssemblies] = useState<Set<string>>(new Set());

  // Price-history popover state.
  const [priceHistoryFor, setPriceHistoryFor] = useState<string | null>(null);
  const [priceHistory, setPriceHistory] = useState<Array<{
    id: string;
    oldPriceCents: number;
    newPriceCents: number;
    notes: string | null;
    createdAt: string;
    changedBy: { id: string; name: string } | null;
  }>>([]);

  async function openPriceHistory(productId: string) {
    if (priceHistoryFor === productId) {
      setPriceHistoryFor(null);
      setPriceHistory([]);
      return;
    }
    try {
      const r = await api<{ history: typeof priceHistory }>(
        `/api/catalog/products/${productId}/price-history`,
      );
      setPriceHistory(r.history);
      setPriceHistoryFor(productId);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to load price history');
    }
  }

  function toggleId(set: Set<string>, id: string): Set<string> {
    const next = new Set(set);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    return next;
  }

  // Quick-create form for products
  const [pName, setPName] = useState('');
  const [pSku, setPSku] = useState('');
  const [pKind, setPKind] = useState('material');
  const [pUnit, setPUnit] = useState('ea');
  const [pPrice, setPPrice] = useState('');
  const [pCategory, setPCategory] = useState('Materials');

  // Column sorting for the products table. Click a header to sort by that
  // column; click the same header again to flip asc/desc. Default order
  // matches what the API returns (creation order from the catalog seed).
  type ProductSortKey = 'name' | 'sku' | 'kind' | 'unit' | 'price' | 'category' | 'status' | 'inventory';
  const [sortKey, setSortKey] = useState<ProductSortKey | null>(null);
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('asc');

  function toggleSort(key: ProductSortKey) {
    if (sortKey === key) {
      setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortKey(key);
      setSortDir('asc');
    }
  }

  const sortedProducts = useMemo(() => {
    if (!sortKey) return products;
    const dir = sortDir === 'asc' ? 1 : -1;
    // Localized string compare so "10ft" sorts naturally next to "8ft".
    const cmpStr = (a: string, b: string) =>
      a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' });
    return [...products].sort((a, b) => {
      switch (sortKey) {
        case 'name':     return dir * cmpStr(a.name, b.name);
        case 'sku':      return dir * cmpStr(a.sku ?? '', b.sku ?? '');
        case 'kind':     return dir * cmpStr(a.kind, b.kind);
        case 'unit':     return dir * cmpStr(a.unit ?? '', b.unit ?? '');
        case 'price':    return dir * (a.defaultUnitPriceCents - b.defaultUnitPriceCents);
        case 'category': return dir * cmpStr(a.category ?? '', b.category ?? '');
        case 'status':   return dir * (Number(b.active) - Number(a.active));
        case 'inventory':return dir * ((a.onHandQtyMilli ?? 0) - (b.onHandQtyMilli ?? 0));
        default: return 0;
      }
    });
  }, [products, sortKey, sortDir]);

  function sortIndicator(key: ProductSortKey): string {
    if (sortKey !== key) return '';
    return sortDir === 'asc' ? ' ▲' : ' ▼';
  }

  // Per-row inline edit. editingId points at the product whose row is in
  // edit mode; editForm holds the in-flight values. Only one row can be
  // edited at a time — clicking Edit on another row swaps the form over.
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editForm, setEditForm] = useState({
    name: '',
    sku: '',
    kind: 'material',
    unit: '',
    price: '',
    laborPrice: '',
    materialPrice: '',
    category: '',
  });
  const [editSaving, setEditSaving] = useState(false);

  function startEdit(p: Product) {
    setEditingId(p.id);
    setEditForm({
      name: p.name,
      sku: p.sku ?? '',
      kind: p.kind,
      unit: p.unit ?? '',
      price: (p.defaultUnitPriceCents / 100).toFixed(2),
      laborPrice: ((p.defaultLaborCents ?? 0) / 100).toFixed(2),
      materialPrice: ((p.defaultMaterialCents ?? 0) / 100).toFixed(2),
      category: p.category ?? '',
    });
  }
  function cancelEdit() {
    setEditingId(null);
  }
  async function saveEdit(id: string) {
    setError(null);
    setEditSaving(true);
    try {
      await api(`/api/catalog/products/${id}`, {
        method: 'PATCH',
        body: JSON.stringify({
          name: editForm.name,
          sku: editForm.sku || null,
          kind: editForm.kind,
          unit: editForm.unit || null,
          defaultUnitPriceCents: Math.round(Number(editForm.price || 0) * 100),
          defaultLaborCents: Math.round(Number(editForm.laborPrice || 0) * 100),
          defaultMaterialCents: Math.round(Number(editForm.materialPrice || 0) * 100),
          category: editForm.category || null,
        }),
      });
      setEditingId(null);
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Save failed');
    } finally {
      setEditSaving(false);
    }
  }

  async function load() {
    try {
      // Admin sees archived rows so bulk unarchive is reachable; everyone
      // else gets the active-only default the API returns.
      const qs = isAdmin ? '?archived=true' : '';
      const [p, a] = await Promise.all([
        api<{ products: Product[] }>(`/api/catalog/products${qs}`),
        api<{ assemblies: Assembly[] }>(`/api/catalog/assemblies${qs}`),
      ]);
      setProducts(p.products);
      setAssemblies(a.assemblies);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to load catalog');
    }
  }
  useEffect(() => { load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [isAdmin]);

  async function createProduct(e: FormEvent) {
    e.preventDefault();
    setError(null);
    try {
      const cents = pPrice ? Math.round(Number(pPrice) * 100) : 0;
      await api('/api/catalog/products', {
        method: 'POST',
        body: JSON.stringify({
          name: pName,
          sku: pSku || undefined,
          kind: pKind,
          unit: pUnit,
          defaultUnitPriceCents: cents,
          category: pCategory || undefined,
        }),
      });
      setPName(''); setPSku(''); setPPrice('');
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Create failed');
    }
  }

  // Wrap each bulk action so the toolbar handlers stay one-liners.
  async function bulkProducts(payload: Record<string, unknown>) {
    setError(null);
    setInfo(null);
    try {
      const r = await api<{ updated: number; action: string }>(
        '/api/catalog/products/_bulk',
        { method: 'POST', body: JSON.stringify(payload) },
      );
      setInfo(`${r.action}: updated ${r.updated} product${r.updated === 1 ? '' : 's'}`);
      setSelectedProducts(new Set());
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Bulk update failed');
    }
  }
  async function bulkAssemblies(payload: Record<string, unknown>) {
    setError(null);
    setInfo(null);
    try {
      const r = await api<{ updated: number; action: string }>(
        '/api/catalog/assemblies/_bulk',
        { method: 'POST', body: JSON.stringify(payload) },
      );
      setInfo(`${r.action}: updated ${r.updated} assembl${r.updated === 1 ? 'y' : 'ies'}`);
      setSelectedAssemblies(new Set());
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Bulk update failed');
    }
  }

  function promptPriceBump() {
    const ids = Array.from(selectedProducts);
    if (ids.length === 0) return;
    const raw = prompt(`Bump price by what % (e.g. 5 for +5%, -10 for -10%) on ${ids.length} product(s)?`);
    if (raw == null || raw.trim() === '') return;
    const pct = Number(raw);
    if (!Number.isFinite(pct)) {
      setError('Enter a number');
      return;
    }
    void bulkProducts({ action: 'priceBump', ids, percent: pct });
  }
  function promptCategory(target: 'products' | 'assemblies') {
    const ids = target === 'products' ? Array.from(selectedProducts) : Array.from(selectedAssemblies);
    if (ids.length === 0) return;
    const cat = prompt(`Set category on ${ids.length} item(s) (leave blank to clear):`);
    if (cat == null) return;
    const payload = { action: 'setCategory', ids, category: cat.trim() || null };
    if (target === 'products') void bulkProducts(payload);
    else void bulkAssemblies(payload);
  }

  async function openDetail(a: Assembly) {
    setOpenAssembly(null);
    setPreview(null);
    try {
      const [d, p] = await Promise.all([
        api<{ assembly: AssemblyDetail }>(`/api/catalog/assemblies/${a.id}`),
        api<{ lines: PreviewLine[]; totalCents: number }>(`/api/catalog/assemblies/${a.id}/preview`),
      ]);
      setOpenAssembly(d.assembly);
      setPreview(p);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to load assembly');
    }
  }

  return (
    <div className="dashboard">
      <header className="row-between">
        <div>
          <h1>Catalog</h1>
          <p className="muted">
            Products are the SKUs you order from vendors. Assemblies are reusable bundles of
            products + labor that drop into estimates as a group. Sales reps see both when
            drafting an estimate.
          </p>
        </div>
        <Link to="/portal/catalog/inventory" className="button-ghost button-small">
          Inventory →
        </Link>
      </header>

      {error && <div className="form-error">{error}</div>}
      {info && <div className="form-success">{info}</div>}

      <div style={{ display: 'flex', gap: '0.5rem', marginBottom: '1rem' }}>
        <button
          type="button"
          className={tab === 'products' ? '' : 'button-ghost'}
          onClick={() => setTab('products')}
        >
          Products ({products.length})
        </button>
        <button
          type="button"
          className={tab === 'assemblies' ? '' : 'button-ghost'}
          onClick={() => setTab('assemblies')}
        >
          Assemblies ({assemblies.length})
        </button>
      </div>

      {tab === 'products' && (
        <>
          <section className="card">
            <h2>Add product</h2>
            <form onSubmit={createProduct}>
              <div className="form-row">
                <div>
                  <label>Name</label>
                  <input value={pName} onChange={(e) => setPName(e.target.value)} required />
                </div>
                <div>
                  <label>SKU (optional)</label>
                  <input value={pSku} onChange={(e) => setPSku(e.target.value)} />
                </div>
              </div>
              <div className="form-row">
                <div>
                  <label>Kind</label>
                  <select value={pKind} onChange={(e) => setPKind(e.target.value)}>
                    <option value="material">material</option>
                    <option value="labor">labor</option>
                    <option value="fee">fee</option>
                    <option value="subcontract">subcontract</option>
                  </select>
                </div>
                <div>
                  <label>Unit</label>
                  <input value={pUnit} onChange={(e) => setPUnit(e.target.value)} placeholder="ea, lf, sqft, hr" />
                </div>
              </div>
              <div className="form-row">
                <div>
                  <label>Default price (USD per unit)</label>
                  <input type="number" step="0.01" min="0" value={pPrice} onChange={(e) => setPPrice(e.target.value)} />
                </div>
                <div>
                  <label>Category</label>
                  <input value={pCategory} onChange={(e) => setPCategory(e.target.value)} />
                </div>
              </div>
              <button type="submit">Add</button>
            </form>
          </section>

          <section className="card">
            <div className="row-between">
              <h2>Products</h2>
              {isAdmin && selectedProducts.size > 0 && (
                <div className="bulk-toolbar">
                  <span className="muted">{selectedProducts.size} selected</span>
                  <button type="button" className="button-ghost button-small" onClick={promptPriceBump}>
                    Price bump %
                  </button>
                  <button type="button" className="button-ghost button-small" onClick={() => promptCategory('products')}>
                    Set category
                  </button>
                  <button
                    type="button"
                    className="button-ghost button-small"
                    onClick={() => bulkProducts({ action: 'archive', ids: Array.from(selectedProducts), active: false })}
                  >
                    Archive
                  </button>
                  <button
                    type="button"
                    className="button-ghost button-small"
                    onClick={() => bulkProducts({ action: 'archive', ids: Array.from(selectedProducts), active: true })}
                  >
                    Unarchive
                  </button>
                  <button
                    type="button"
                    className="button-ghost button-small"
                    onClick={() => setSelectedProducts(new Set())}
                  >
                    Clear
                  </button>
                </div>
              )}
            </div>
            {products.length ? (
              <table className="table">
                <thead>
                  <tr>
                    {isAdmin && (
                      <th style={{ width: 32 }}>
                        <input
                          type="checkbox"
                          checked={selectedProducts.size === products.length && products.length > 0}
                          onChange={(e) =>
                            setSelectedProducts(
                              e.target.checked ? new Set(products.map((p) => p.id)) : new Set(),
                            )
                          }
                          aria-label="Select all products"
                        />
                      </th>
                    )}
                    <th className="sortable" onClick={() => toggleSort('name')}>Name{sortIndicator('name')}</th>
                    <th className="sortable" onClick={() => toggleSort('sku')}>SKU{sortIndicator('sku')}</th>
                    <th className="sortable" onClick={() => toggleSort('kind')}>Kind{sortIndicator('kind')}</th>
                    <th className="sortable" onClick={() => toggleSort('unit')}>Unit{sortIndicator('unit')}</th>
                    <th className="sortable" onClick={() => toggleSort('price')}>Price{sortIndicator('price')}</th>
                    <th className="sortable" onClick={() => toggleSort('category')}>Category{sortIndicator('category')}</th>
                    <th className="sortable" onClick={() => toggleSort('status')}>Status{sortIndicator('status')}</th>
                    <th className="sortable" onClick={() => toggleSort('inventory')}>Inventory{sortIndicator('inventory')}</th>
                    {isAdmin && <th></th>}
                  </tr>
                </thead>
                <tbody>
                  {sortedProducts.map((p) => {
                    const isEditing = editingId === p.id;
                    if (isEditing) {
                      return (
                        <tr key={p.id} className="catalog-edit-row">
                          <td colSpan={isAdmin ? 10 : 8}>
                            <div className="form-row">
                              <div>
                                <label>Name</label>
                                <input
                                  value={editForm.name}
                                  onChange={(e) => setEditForm((f) => ({ ...f, name: e.target.value }))}
                                  required
                                />
                              </div>
                              <div>
                                <label>SKU</label>
                                <input
                                  value={editForm.sku}
                                  onChange={(e) => setEditForm((f) => ({ ...f, sku: e.target.value }))}
                                />
                              </div>
                            </div>
                            <div className="form-row">
                              <div>
                                <label>Kind</label>
                                <select
                                  value={editForm.kind}
                                  onChange={(e) => setEditForm((f) => ({ ...f, kind: e.target.value }))}
                                >
                                  <option value="material">material</option>
                                  <option value="labor">labor</option>
                                  <option value="fee">fee</option>
                                  <option value="subcontract">subcontract</option>
                                </select>
                              </div>
                              <div>
                                <label>Unit</label>
                                <input
                                  value={editForm.unit}
                                  onChange={(e) => setEditForm((f) => ({ ...f, unit: e.target.value }))}
                                  placeholder="ea, lf, sqft, hr"
                                />
                              </div>
                            </div>
                            <div className="form-row">
                              <div>
                                <label>Default price (USD per unit)</label>
                                <input
                                  type="number"
                                  step="0.01"
                                  min="0"
                                  value={editForm.price}
                                  onChange={(e) => setEditForm((f) => ({ ...f, price: e.target.value }))}
                                />
                              </div>
                              <div>
                                <label>Category</label>
                                <input
                                  value={editForm.category}
                                  onChange={(e) => setEditForm((f) => ({ ...f, category: e.target.value }))}
                                />
                              </div>
                            </div>
                            {/* Optional labor + material split à la
                                Xactimate. Leave both 0 to keep the row
                                as a "lump" item (legacy behaviour). When
                                set, job-cost rollups break out by type. */}
                            <div className="form-row">
                              <div>
                                <label>Labor portion (USD)</label>
                                <input
                                  type="number"
                                  step="0.01"
                                  min="0"
                                  value={editForm.laborPrice}
                                  onChange={(e) => setEditForm((f) => ({ ...f, laborPrice: e.target.value }))}
                                  placeholder="0.00"
                                  title="If this product is part labor + part material, split here. Sum doesn't have to equal Default price — keep the blended price for what the customer sees, while tracking the underlying split."
                                />
                              </div>
                              <div>
                                <label>Material portion (USD)</label>
                                <input
                                  type="number"
                                  step="0.01"
                                  min="0"
                                  value={editForm.materialPrice}
                                  onChange={(e) => setEditForm((f) => ({ ...f, materialPrice: e.target.value }))}
                                  placeholder="0.00"
                                />
                              </div>
                            </div>
                            <div style={{ display: 'flex', gap: '0.5rem', marginTop: '0.5rem' }}>
                              <button
                                type="button"
                                onClick={() => saveEdit(p.id)}
                                disabled={editSaving || !editForm.name.trim()}
                              >
                                {editSaving ? 'Saving…' : 'Save'}
                              </button>
                              <button
                                type="button"
                                className="button-ghost"
                                onClick={cancelEdit}
                                disabled={editSaving}
                              >
                                Cancel
                              </button>
                            </div>
                          </td>
                        </tr>
                      );
                    }
                    return (
                      <tr key={p.id} style={{ opacity: p.active ? 1 : 0.55 }}>
                        {isAdmin && (
                          <td>
                            <input
                              type="checkbox"
                              checked={selectedProducts.has(p.id)}
                              onChange={() => setSelectedProducts((s) => toggleId(s, p.id))}
                              aria-label={`Select ${p.name}`}
                            />
                          </td>
                        )}
                        <td><strong>{p.name}</strong></td>
                        <td>{p.sku ?? <span className="muted">—</span>}</td>
                        <td>{p.kind}</td>
                        <td>{p.unit ?? '—'}</td>
                        <td>
                          <button
                            type="button"
                            className="button-ghost button-small"
                            onClick={() => openPriceHistory(p.id)}
                            title="Click to see price history"
                          >
                            {formatCents(p.defaultUnitPriceCents)}
                          </button>
                        </td>
                        <td>{p.category ?? <span className="muted">—</span>}</td>
                        <td>{p.active ? <span className="muted">active</span> : <em className="muted">archived</em>}</td>
                        <td>
                          {isAdmin && (
                            <button
                              type="button"
                              className={`button-small ${p.trackInventory ? '' : 'button-ghost'}`}
                              onClick={async () => {
                                if (!p.trackInventory) {
                                  const raw = prompt(`Current on-hand qty for ${p.name} (in ${p.unit ?? 'units'}):`, '0');
                                  if (raw == null) return;
                                  const qty = Number(raw);
                                  if (!Number.isFinite(qty) || qty < 0) return;
                                  await api(`/api/inventory/products/${p.id}`, {
                                    method: 'PATCH',
                                    body: JSON.stringify({ trackInventory: true, onHandQty: qty }),
                                  }).catch((err) => setError(err instanceof ApiError ? err.message : 'Update failed'));
                                } else {
                                  if (!confirm(`Stop tracking inventory for ${p.name}?`)) return;
                                  await api(`/api/inventory/products/${p.id}`, {
                                    method: 'PATCH',
                                    body: JSON.stringify({ trackInventory: false }),
                                  }).catch((err) => setError(err instanceof ApiError ? err.message : 'Update failed'));
                                }
                                await load();
                              }}
                              title={p.trackInventory ? 'Inventory tracked — click to disable' : 'Click to start tracking inventory'}
                            >
                              {p.trackInventory ? `${(p.onHandQtyMilli ?? 0) / 1000} on hand` : 'Track stock'}
                            </button>
                          )}
                        </td>
                        {isAdmin && (
                          <td>
                            <button
                              type="button"
                              className="button-ghost button-small"
                              onClick={() => startEdit(p)}
                            >
                              Edit
                            </button>
                          </td>
                        )}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            ) : (
              <p className="muted">No products yet — add one above.</p>
            )}
          </section>

          {priceHistoryFor && (
            <section className="card">
              <div className="row-between">
                <h2>Price history</h2>
                <button type="button" className="button-ghost button-small" onClick={() => setPriceHistoryFor(null)}>
                  Close
                </button>
              </div>
              {priceHistory.length === 0 ? (
                <p className="muted">No price changes logged yet for this product.</p>
              ) : (
                <table className="table">
                  <thead>
                    <tr>
                      <th>When</th>
                      <th>Changed by</th>
                      <th style={{ textAlign: 'right' }}>From</th>
                      <th style={{ textAlign: 'right' }}>To</th>
                      <th style={{ textAlign: 'right' }}>Δ</th>
                      <th>Notes</th>
                    </tr>
                  </thead>
                  <tbody>
                    {priceHistory.map((h) => {
                      const delta = h.newPriceCents - h.oldPriceCents;
                      const deltaPct = h.oldPriceCents > 0 ? Math.round((delta / h.oldPriceCents) * 1000) / 10 : null;
                      return (
                        <tr key={h.id}>
                          <td className="muted">{new Date(h.createdAt).toLocaleString()}</td>
                          <td className="muted">{h.changedBy?.name ?? 'system'}</td>
                          <td style={{ textAlign: 'right' }}>{formatCents(h.oldPriceCents)}</td>
                          <td style={{ textAlign: 'right' }}>{formatCents(h.newPriceCents)}</td>
                          <td style={{ textAlign: 'right', color: delta < 0 ? 'var(--paid, #0f9d58)' : 'var(--accent)' }}>
                            {delta > 0 ? '+' : ''}{formatCents(delta)}
                            {deltaPct !== null && (
                              <span className="muted" style={{ marginLeft: '0.3rem', fontSize: '0.85rem' }}>
                                ({deltaPct > 0 ? '+' : ''}{deltaPct}%)
                              </span>
                            )}
                          </td>
                          <td className="muted">{h.notes ?? '—'}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              )}
            </section>
          )}
        </>
      )}

      {tab === 'assemblies' && (
        <>
          <section className="card">
            <div className="row-between">
              <h2>Assemblies</h2>
              {isAdmin && selectedAssemblies.size > 0 && (
                <div className="bulk-toolbar">
                  <span className="muted">{selectedAssemblies.size} selected</span>
                  <button type="button" className="button-ghost button-small" onClick={() => promptCategory('assemblies')}>
                    Set category
                  </button>
                  <button
                    type="button"
                    className="button-ghost button-small"
                    onClick={() => bulkAssemblies({ action: 'archive', ids: Array.from(selectedAssemblies), active: false })}
                  >
                    Archive
                  </button>
                  <button
                    type="button"
                    className="button-ghost button-small"
                    onClick={() => bulkAssemblies({ action: 'archive', ids: Array.from(selectedAssemblies), active: true })}
                  >
                    Unarchive
                  </button>
                  <button
                    type="button"
                    className="button-ghost button-small"
                    onClick={() => setSelectedAssemblies(new Set())}
                  >
                    Clear
                  </button>
                </div>
              )}
            </div>
            <p className="muted" style={{ fontSize: '0.85rem' }}>
              Build assemblies via the API for now (see <code>POST /api/catalog/assemblies</code>) — a richer
              builder UI is on the roadmap. Click an assembly to preview its expanded line items.
            </p>
            {assemblies.length ? (
              <table className="table">
                <thead>
                  <tr>
                    {isAdmin && (
                      <th style={{ width: 32 }}>
                        <input
                          type="checkbox"
                          checked={selectedAssemblies.size === assemblies.length && assemblies.length > 0}
                          onChange={(e) =>
                            setSelectedAssemblies(
                              e.target.checked ? new Set(assemblies.map((a) => a.id)) : new Set(),
                            )
                          }
                          aria-label="Select all assemblies"
                        />
                      </th>
                    )}
                    <th>Name</th><th>Category</th><th>Lines</th><th>Status</th><th></th>
                  </tr>
                </thead>
                <tbody>
                  {assemblies.map((a) => (
                    <tr key={a.id} style={{ opacity: a.active ? 1 : 0.55 }}>
                      {isAdmin && (
                        <td>
                          <input
                            type="checkbox"
                            checked={selectedAssemblies.has(a.id)}
                            onChange={() => setSelectedAssemblies((s) => toggleId(s, a.id))}
                            aria-label={`Select ${a.name}`}
                          />
                        </td>
                      )}
                      <td><strong>{a.name}</strong></td>
                      <td>{a.category ?? <span className="muted">—</span>}</td>
                      <td>{a._count.lines}</td>
                      <td>{a.active ? <span className="muted">active</span> : <em className="muted">archived</em>}</td>
                      <td>
                        <button className="button-ghost button-small" onClick={() => openDetail(a)}>Preview</button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : (
              <p className="muted">No assemblies yet.</p>
            )}
          </section>

          {openAssembly && preview && (
            <section className="card">
              <h2>{openAssembly.name}</h2>
              {openAssembly.description && <p className="muted">{openAssembly.description}</p>}
              <table className="table">
                <thead><tr><th>Description</th><th>Qty</th><th>Unit</th><th>Price</th><th>Total</th><th>Category</th></tr></thead>
                <tbody>
                  {preview.lines.map((l, i) => (
                    <tr key={i}>
                      <td>{l.description}</td>
                      <td>{l.quantity}</td>
                      <td>{l.unit ?? '—'}</td>
                      <td>{formatCents(l.unitPriceCents)}</td>
                      <td><strong>{formatCents(l.totalCents)}</strong></td>
                      <td>{l.category ?? <span className="muted">—</span>}</td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr>
                    <td colSpan={4} style={{ textAlign: 'right' }}><em>Total</em></td>
                    <td colSpan={2}><strong>{formatCents(preview.totalCents)}</strong></td>
                  </tr>
                </tfoot>
              </table>
            </section>
          )}
        </>
      )}
    </div>
  );
}
