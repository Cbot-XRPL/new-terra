import { type FormEvent, useEffect, useState } from 'react';
import { ApiError, api } from '../../lib/api';
import { formatCents } from '../../lib/format';

interface Product {
  id: string;
  sku: string | null;
  name: string;
  kind: string;
  unit: string | null;
  defaultUnitPriceCents: number;
  category: string | null;
  active: boolean;
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
  const [tab, setTab] = useState<'products' | 'assemblies'>('products');
  const [products, setProducts] = useState<Product[]>([]);
  const [assemblies, setAssemblies] = useState<Assembly[]>([]);
  const [openAssembly, setOpenAssembly] = useState<AssemblyDetail | null>(null);
  const [preview, setPreview] = useState<{ lines: PreviewLine[]; totalCents: number } | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Quick-create form for products
  const [pName, setPName] = useState('');
  const [pSku, setPSku] = useState('');
  const [pKind, setPKind] = useState('material');
  const [pUnit, setPUnit] = useState('ea');
  const [pPrice, setPPrice] = useState('');
  const [pCategory, setPCategory] = useState('Materials');

  async function load() {
    try {
      const [p, a] = await Promise.all([
        api<{ products: Product[] }>('/api/catalog/products'),
        api<{ assemblies: Assembly[] }>('/api/catalog/assemblies'),
      ]);
      setProducts(p.products);
      setAssemblies(a.assemblies);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to load catalog');
    }
  }
  useEffect(() => { load(); }, []);

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
      <header>
        <h1>Catalog</h1>
        <p className="muted">
          Products are the SKUs you order from vendors. Assemblies are reusable bundles of
          products + labor that drop into estimates as a group. Sales reps see both when
          drafting an estimate.
        </p>
      </header>

      {error && <div className="form-error">{error}</div>}

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
            <h2>Products</h2>
            {products.length ? (
              <table className="table">
                <thead><tr><th>Name</th><th>SKU</th><th>Kind</th><th>Unit</th><th>Price</th><th>Category</th></tr></thead>
                <tbody>
                  {products.map((p) => (
                    <tr key={p.id}>
                      <td><strong>{p.name}</strong></td>
                      <td>{p.sku ?? <span className="muted">—</span>}</td>
                      <td>{p.kind}</td>
                      <td>{p.unit ?? '—'}</td>
                      <td>{formatCents(p.defaultUnitPriceCents)}</td>
                      <td>{p.category ?? <span className="muted">—</span>}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : (
              <p className="muted">No products yet — add one above.</p>
            )}
          </section>
        </>
      )}

      {tab === 'assemblies' && (
        <>
          <section className="card">
            <h2>Assemblies</h2>
            <p className="muted" style={{ fontSize: '0.85rem' }}>
              Build assemblies via the API for now (see <code>POST /api/catalog/assemblies</code>) — a richer
              builder UI is on the roadmap. Click an assembly to preview its expanded line items.
            </p>
            {assemblies.length ? (
              <table className="table">
                <thead><tr><th>Name</th><th>Category</th><th>Lines</th><th></th></tr></thead>
                <tbody>
                  {assemblies.map((a) => (
                    <tr key={a.id}>
                      <td><strong>{a.name}</strong></td>
                      <td>{a.category ?? <span className="muted">—</span>}</td>
                      <td>{a._count.lines}</td>
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
