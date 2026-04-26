import { type FormEvent, useEffect, useRef, useState } from 'react';
import { ApiError } from '../../lib/api';
import { useAuth, type Role } from '../../auth/AuthContext';
import { formatDate } from '../../lib/format';

interface ProjectDocument {
  id: string;
  filename: string;
  url: string;
  contentType: string;
  sizeBytes: number;
  category: string | null;
  description: string | null;
  customerVisible: boolean;
  createdAt: string;
  uploadedBy: { id: string; name: string; role: Role };
}

const API_BASE = import.meta.env.VITE_API_URL ?? '';

function authHeaders(): Record<string, string> {
  const token = localStorage.getItem('nt_token');
  return token ? { Authorization: `Bearer ${token}` } : {};
}

async function jsonRequest<T>(url: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch(`${API_BASE}${url}`, {
    ...init,
    headers: { 'Content-Type': 'application/json', ...authHeaders(), ...(init.headers ?? {}) },
  });
  const text = await res.text();
  const data = text ? JSON.parse(text) : null;
  if (!res.ok) throw new ApiError(res.status, data?.error ?? res.statusText, data);
  return data as T;
}

const COMMON_CATEGORIES = ['permit', 'drawing', 'manual', 'spec', 'warranty', 'inspection', 'other'];

export default function ProjectDocuments({ projectId }: { projectId: string }) {
  const { user } = useAuth();
  const canManage = user?.role === 'ADMIN' || user?.role === 'EMPLOYEE';
  const canUpload = canManage || user?.role === 'SUBCONTRACTOR';

  const [docs, setDocs] = useState<ProjectDocument[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [category, setCategory] = useState('');
  const [description, setDescription] = useState('');
  const [customerVisible, setCustomerVisible] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  async function load() {
    try {
      const { documents } = await jsonRequest<{ documents: ProjectDocument[] }>(
        `/api/projects/${projectId}/documents`,
      );
      setDocs(documents);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to load documents');
    }
  }
  useEffect(() => { load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [projectId]);

  async function onUpload(e: FormEvent) {
    e.preventDefault();
    const files = fileInputRef.current?.files;
    if (!files || files.length === 0) return;
    setSubmitting(true);
    setError(null);
    try {
      const form = new FormData();
      for (const f of Array.from(files)) form.append('files', f);
      if (category) form.append('category', category);
      if (description) form.append('description', description);
      form.append('customerVisible', String(customerVisible));
      const res = await fetch(`${API_BASE}/api/projects/${projectId}/documents`, {
        method: 'POST',
        headers: authHeaders(),
        body: form,
      });
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        setError(body?.error ?? 'Upload failed');
        return;
      }
      setCategory('');
      setDescription('');
      setCustomerVisible(true);
      if (fileInputRef.current) fileInputRef.current.value = '';
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Upload failed');
    } finally {
      setSubmitting(false);
    }
  }

  async function toggleVisibility(doc: ProjectDocument) {
    try {
      await jsonRequest(`/api/projects/${projectId}/documents/${doc.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ customerVisible: !doc.customerVisible }),
      });
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Update failed');
    }
  }

  async function remove(doc: ProjectDocument) {
    if (!confirm(`Delete "${doc.filename}"?`)) return;
    try {
      await jsonRequest(`/api/projects/${projectId}/documents/${doc.id}`, { method: 'DELETE' });
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Delete failed');
    }
  }

  // Group by category for display, with null collapsed under "uncategorised".
  const grouped = new Map<string, ProjectDocument[]>();
  for (const d of docs) {
    const k = d.category ?? 'uncategorised';
    const arr = grouped.get(k) ?? [];
    arr.push(d);
    grouped.set(k, arr);
  }

  return (
    <section className="card">
      <h2>Documents</h2>
      <p className="muted" style={{ marginBottom: '0.75rem', fontSize: '0.9rem' }}>
        Permits, drawings, manuals, specs — anything that isn&rsquo;t a photo.
        {canManage && ' Toggle visibility to hide internal-only files from the customer.'}
      </p>

      {error && <div className="form-error">{error}</div>}

      {canUpload && (
        <form onSubmit={onUpload} className="upload-form" style={{ marginBottom: '0.75rem' }}>
          <input ref={fileInputRef} type="file" multiple required />
          <input
            type="text"
            list="doc-categories"
            placeholder="Category (e.g. permit, drawing)"
            value={category}
            onChange={(e) => setCategory(e.target.value)}
            style={{ width: 200 }}
          />
          <datalist id="doc-categories">
            {COMMON_CATEGORIES.map((c) => <option key={c} value={c} />)}
          </datalist>
          <input
            type="text"
            placeholder="Description (optional)"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
          />
          {canManage && (
            <label style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', fontSize: '0.85rem' }}>
              <input
                type="checkbox"
                checked={customerVisible}
                onChange={(e) => setCustomerVisible(e.target.checked)}
                style={{ width: 'auto' }}
              />
              Customer can see
            </label>
          )}
          <button type="submit" disabled={submitting}>
            {submitting ? 'Uploading…' : 'Upload'}
          </button>
        </form>
      )}

      {docs.length ? (
        [...grouped.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([cat, items]) => (
          <div key={cat} style={{ marginBottom: '1rem' }}>
            <h3 style={{ margin: '0.5rem 0', textTransform: 'capitalize' }}>{cat}</h3>
            <table className="table">
              <thead>
                <tr>
                  <th>File</th>
                  <th>Description</th>
                  <th>Size</th>
                  <th>Uploaded</th>
                  {canManage && <th>Visible</th>}
                  {canManage && <th></th>}
                </tr>
              </thead>
              <tbody>
                {items.map((d) => (
                  <tr key={d.id} style={{ opacity: d.customerVisible ? 1 : 0.6 }}>
                    <td>
                      <a href={d.url} target="_blank" rel="noreferrer" style={{ wordBreak: 'break-all' }}>
                        📄 {d.filename}
                      </a>
                    </td>
                    <td className="muted">{d.description ?? '—'}</td>
                    <td>{(d.sizeBytes / 1024).toFixed(0)} KB</td>
                    <td className="muted" style={{ fontSize: '0.85rem' }}>
                      {formatDate(d.createdAt)} · {d.uploadedBy.name}
                    </td>
                    {canManage && (
                      <td>
                        <button
                          type="button"
                          className="button-ghost button-small"
                          onClick={() => toggleVisibility(d)}
                          title={d.customerVisible ? 'Hide from the customer' : 'Show to the customer'}
                        >
                          {d.customerVisible ? '👁 visible' : '🚫 hidden'}
                        </button>
                      </td>
                    )}
                    {canManage && (
                      <td>
                        <button
                          type="button"
                          className="button-ghost button-small"
                          onClick={() => remove(d)}
                        >
                          Delete
                        </button>
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ))
      ) : (
        <p className="muted">No documents yet.</p>
      )}
    </section>
  );
}
