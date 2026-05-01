// Admin-only page for the regional-pricing data feed.
//
// Three panes: a labor CSV uploader, a materials CSV uploader, and a
// small viewer that shows the latest 50 rows of each table. The page
// targets infrequent admin use (pasting a BLS export once a quarter, a
// vendor price list once in a while), so a tabular dashboard with no
// filters is sufficient.

import { type FormEvent, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { ApiError, api } from '../../lib/api';

interface LaborRow {
  id: string;
  zipPrefix: string;
  socCode: string;
  meanHourlyCents: number;
  metroName: string | null;
  source: string;
  fetchedAt: string;
}

interface MaterialRow {
  id: string;
  productId: string;
  zipPrefix: string;
  unitPriceCents: number;
  source: string;
  fetchedAt: string;
  product?: { id: string; name: string; sku: string | null } | null;
}

interface ImportResult {
  imported: number;
  skipped: number;
  errors: Array<{ row: number; reason: string }>;
}

const LABOR_HEADER = 'zipPrefix,socCode,meanHourlyDollars,metroName,source';
const MATERIAL_HEADER = 'productId,zipPrefix,unitPriceDollars,source';

export default function AdminPricingPage() {
  const [laborRows, setLaborRows] = useState<LaborRow[]>([]);
  const [materialRows, setMaterialRows] = useState<MaterialRow[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<string | null>(null);

  // Token for the upload form's <input type="file">. Bumping it after a
  // successful submit clears the input without reaching into the DOM —
  // React friendly, no stale filename in the picker.
  const [laborFormKey, setLaborFormKey] = useState(0);
  const [materialFormKey, setMaterialFormKey] = useState(0);

  async function load() {
    try {
      const [labor, materials] = await Promise.all([
        api<{ rows: LaborRow[] }>('/api/integrations/regional-pricing/labor?pageSize=50'),
        api<{ rows: MaterialRow[] }>('/api/integrations/regional-pricing/materials?pageSize=50'),
      ]);
      setLaborRows(labor.rows);
      setMaterialRows(materials.rows);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to load pricing data');
    }
  }
  useEffect(() => {
    load();
  }, []);

  async function uploadCsv(
    e: FormEvent<HTMLFormElement>,
    endpoint: string,
    label: string,
    onSuccess: () => void,
  ) {
    e.preventDefault();
    setError(null);
    setFeedback(null);
    const form = new FormData(e.currentTarget);
    const file = form.get('file');
    if (!(file instanceof File) || file.size === 0) {
      setError('Pick a CSV file first.');
      return;
    }
    try {
      // FormData uploads need the browser to set the Content-Type with a
      // boundary. The shared `api` helper hardcodes JSON, so we go direct
      // through fetch for these two endpoints only.
      const token =
        sessionStorage.getItem('nt_token') ?? localStorage.getItem('nt_token');
      const res = await fetch(endpoint, {
        method: 'POST',
        body: form,
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      const json = (await res.json()) as ImportResult & { error?: string };
      if (!res.ok) throw new ApiError(res.status, json.error ?? 'Import failed', json);
      setFeedback(
        `${label}: imported ${json.imported}, skipped ${json.skipped}.` +
          (json.errors.length
            ? ` First error — row ${json.errors[0].row}: ${json.errors[0].reason}`
            : ''),
      );
      onSuccess();
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Import failed');
    }
  }

  return (
    <div className="dashboard">
      <header className="row-between">
        <div>
          <h1>Regional pricing</h1>
          <p className="muted">
            <Link to="/portal/admin">← Admin</Link>
            {' · '}
            BLS wage data + per-ZIP material prices feed the estimator's
            unit-price seeds.
          </p>
        </div>
      </header>

      {error && <div className="form-error">{error}</div>}
      {feedback && <div className="form-success">{feedback}</div>}

      <section className="card">
        <h2>Import labor wage data</h2>
        <p className="muted" style={{ fontSize: '0.85rem' }}>
          CSV columns: <code>{LABOR_HEADER}</code>. Use <code>zipPrefix=000</code>
          {' '}for the national baseline row (the wage multiplier divides
          regional ÷ national). Existing rows with the same{' '}
          <code>(zipPrefix, socCode, source)</code> are updated in place.
        </p>
        <form
          key={laborFormKey}
          onSubmit={(e) =>
            uploadCsv(
              e,
              '/api/integrations/regional-pricing/labor/import',
              'Labor',
              () => setLaborFormKey((k) => k + 1),
            )
          }
        >
          <input type="file" name="file" accept=".csv,text/csv" required />
          <button type="submit" style={{ marginLeft: '0.5rem' }}>Upload CSV</button>
        </form>
      </section>

      <section className="card">
        <h2>Import material price samples</h2>
        <p className="muted" style={{ fontSize: '0.85rem' }}>
          CSV columns: <code>{MATERIAL_HEADER}</code>. Each row is appended as a
          new sample so price history is preserved; the estimator uses the
          freshest row for the customer's ZIP prefix.
        </p>
        <form
          key={materialFormKey}
          onSubmit={(e) =>
            uploadCsv(
              e,
              '/api/integrations/regional-pricing/materials/import',
              'Materials',
              () => setMaterialFormKey((k) => k + 1),
            )
          }
        >
          <input type="file" name="file" accept=".csv,text/csv" required />
          <button type="submit" style={{ marginLeft: '0.5rem' }}>Upload CSV</button>
        </form>
      </section>

      <section className="card">
        <h2>Latest labor rows</h2>
        {laborRows.length ? (
          <table className="table">
            <thead>
              <tr>
                <th>ZIP prefix</th>
                <th>SOC</th>
                <th>Metro</th>
                <th>Mean hourly</th>
                <th>Source</th>
                <th>Fetched</th>
              </tr>
            </thead>
            <tbody>
              {laborRows.map((r) => (
                <tr key={r.id}>
                  <td>{r.zipPrefix}</td>
                  <td>{r.socCode}</td>
                  <td>{r.metroName ?? '—'}</td>
                  <td>${(r.meanHourlyCents / 100).toFixed(2)}</td>
                  <td>{r.source}</td>
                  <td>{new Date(r.fetchedAt).toLocaleDateString()}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <p className="muted">No labor data yet — upload a CSV above.</p>
        )}
      </section>

      <section className="card">
        <h2>Latest material rows</h2>
        {materialRows.length ? (
          <table className="table">
            <thead>
              <tr>
                <th>Product</th>
                <th>ZIP prefix</th>
                <th>Unit price</th>
                <th>Source</th>
                <th>Fetched</th>
              </tr>
            </thead>
            <tbody>
              {materialRows.map((r) => (
                <tr key={r.id}>
                  <td>
                    {r.product
                      ? `${r.product.name}${r.product.sku ? ` · ${r.product.sku}` : ''}`
                      : r.productId}
                  </td>
                  <td>{r.zipPrefix}</td>
                  <td>${(r.unitPriceCents / 100).toFixed(2)}</td>
                  <td>{r.source}</td>
                  <td>{new Date(r.fetchedAt).toLocaleDateString()}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <p className="muted">No material samples yet — upload a CSV above.</p>
        )}
      </section>
    </div>
  );
}
