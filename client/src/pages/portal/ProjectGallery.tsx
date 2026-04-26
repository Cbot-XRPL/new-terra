import { type FormEvent, useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { ApiError } from '../../lib/api';
import { useAuth, type Role } from '../../auth/AuthContext';
import { formatDateTime } from '../../lib/format';

interface ProjectImage {
  id: string;
  url: string;
  thumbnailUrl: string | null;
  filename: string;
  caption: string | null;
  phase: string | null;
  takenAt: string | null;
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

async function uploadFiles(
  projectId: string,
  files: FileList,
  meta: { caption: string; phase: string; takenAt: string },
) {
  const form = new FormData();
  for (const f of Array.from(files)) form.append('files', f);
  if (meta.caption) form.append('caption', meta.caption);
  if (meta.phase) form.append('phase', meta.phase);
  if (meta.takenAt) form.append('takenAt', new Date(meta.takenAt).toISOString());
  const res = await fetch(`${API_BASE}/api/projects/${projectId}/images`, {
    method: 'POST',
    headers: authHeaders(),
    body: form,
  });
  const data = await res.json().catch(() => null);
  if (!res.ok) throw new ApiError(res.status, data?.error ?? res.statusText, data);
  return data as { images: ProjectImage[] };
}

export default function ProjectGallery({ projectId }: { projectId: string }) {
  const { user } = useAuth();
  const canUpload = user?.role === 'ADMIN' || user?.role === 'EMPLOYEE' || user?.role === 'SUBCONTRACTOR';
  const canDelete = user?.role === 'ADMIN' || user?.role === 'EMPLOYEE';

  const [images, setImages] = useState<ProjectImage[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [caption, setCaption] = useState('');
  const [phase, setPhase] = useState('');
  const [takenAt, setTakenAt] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  async function load() {
    try {
      const { images } = await jsonRequest<{ images: ProjectImage[] }>(
        `/api/projects/${projectId}/images`,
      );
      setImages(images);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to load images');
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
      await uploadFiles(projectId, files, { caption, phase, takenAt });
      setCaption('');
      setPhase('');
      setTakenAt('');
      if (fileInputRef.current) fileInputRef.current.value = '';
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Upload failed');
    } finally {
      setSubmitting(false);
    }
  }

  async function onDelete(imageId: string) {
    if (!confirm('Delete this photo?')) return;
    try {
      await jsonRequest(`/api/projects/${projectId}/images/${imageId}`, { method: 'DELETE' });
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Delete failed');
    }
  }

  return (
    <section className="card">
      <div className="row-between">
        <h2>Photos</h2>
        <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
          <Link to={`/portal/projects/${projectId}/timeline`} className="button-ghost button-small">
            View timeline →
          </Link>
          {(user?.role === 'ADMIN' || user?.role === 'EMPLOYEE' || user?.role === 'CUSTOMER') && (
            <ShareManager projectId={projectId} />
          )}
        </div>
      </div>
      {error && <div className="form-error">{error}</div>}

      {canUpload && (
        <form onSubmit={onUpload} className="upload-form">
          <input ref={fileInputRef} type="file" accept="image/*" multiple required />
          <input
            type="text"
            placeholder="Caption (optional)"
            value={caption}
            onChange={(e) => setCaption(e.target.value)}
          />
          <input
            type="text"
            list="phase-suggestions"
            placeholder="Phase (e.g. before, framing, final)"
            value={phase}
            onChange={(e) => setPhase(e.target.value)}
            style={{ width: 200 }}
          />
          <datalist id="phase-suggestions">
            <option value="before" />
            <option value="demo" />
            <option value="framing" />
            <option value="rough-in" />
            <option value="finish" />
            <option value="punch" />
            <option value="after" />
          </datalist>
          <input
            type="date"
            value={takenAt}
            onChange={(e) => setTakenAt(e.target.value)}
            title="Date the photo was taken (defaults to today)"
            style={{ width: 160 }}
          />
          <button type="submit" disabled={submitting}>
            {submitting ? 'Uploading…' : 'Upload'}
          </button>
        </form>
      )}

      {images.length ? (
        <div className="gallery">
          {images.map((img) => (
            <figure key={img.id} className="gallery-item">
              <a href={img.url} target="_blank" rel="noreferrer">
                <img
                  src={img.thumbnailUrl ?? img.url}
                  alt={img.caption ?? img.filename}
                  loading="lazy"
                />
              </a>
              <figcaption>
                {img.caption && <div>{img.caption}</div>}
                <div className="muted">
                  {img.uploadedBy.name} · {formatDateTime(img.createdAt)}
                </div>
                {canDelete && (
                  <button
                    type="button"
                    className="button button-ghost button-small"
                    onClick={() => onDelete(img.id)}
                  >
                    Delete
                  </button>
                )}
              </figcaption>
            </figure>
          ))}
        </div>
      ) : (
        <p className="muted">No photos yet.</p>
      )}
    </section>
  );
}

interface ShareRow {
  id: string;
  label: string | null;
  expiresAt: string;
  revokedAt: string | null;
  viewCount: number;
  lastViewedAt: string | null;
  createdAt: string;
  createdBy: { id: string; name: string };
}

// Mints + lists time-limited public gallery share links. Admin sees the
// raw token exactly once on create — copy then or revoke + remint.
function ShareManager({ projectId }: { projectId: string }) {
  const [open, setOpen] = useState(false);
  const [shares, setShares] = useState<ShareRow[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [label, setLabel] = useState('');
  const [days, setDays] = useState(30);
  const [justCreatedUrl, setJustCreatedUrl] = useState<string | null>(null);

  async function load() {
    try {
      const r = await jsonRequest<{ shares: ShareRow[] }>(`/api/projects/${projectId}/shares`);
      setShares(r.shares);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to load shares');
    }
  }

  useEffect(() => {
    if (open) load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  async function create() {
    setError(null);
    try {
      const r = await jsonRequest<{ share: ShareRow; token: string }>(
        `/api/projects/${projectId}/shares`,
        {
          method: 'POST',
          body: JSON.stringify({ label: label || null, expiresInDays: days }),
        },
      );
      const url = `${window.location.origin}/g/${r.token}`;
      setJustCreatedUrl(url);
      setLabel('');
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Create failed');
    }
  }

  async function revoke(share: ShareRow) {
    if (!confirm(`Revoke "${share.label ?? 'unlabeled link'}"?`)) return;
    try {
      await jsonRequest(`/api/projects/${projectId}/shares/${share.id}/revoke`, { method: 'POST' });
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Revoke failed');
    }
  }

  return (
    <>
      <button type="button" className="button-ghost button-small" onClick={() => setOpen((v) => !v)}>
        {open ? 'Close share' : 'Share gallery'}
      </button>
      {open && (
        <div style={{ flexBasis: '100%', marginTop: '0.5rem', padding: '0.75rem', background: 'var(--bg-elevated)', borderRadius: 8, border: '1px solid rgba(95,99,104,0.3)' }}>
          {error && <div className="form-error">{error}</div>}
          {justCreatedUrl && (
            <div className="form-success" style={{ wordBreak: 'break-all' }}>
              <strong>New link (copy now):</strong>{' '}
              <code>{justCreatedUrl}</code>
              <button
                type="button"
                className="button-ghost button-small"
                style={{ marginLeft: '0.5rem' }}
                onClick={() => navigator.clipboard?.writeText(justCreatedUrl).then(() => alert('Copied'))}
              >
                Copy
              </button>
            </div>
          )}
          <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'flex-end', flexWrap: 'wrap', marginBottom: '0.5rem' }}>
            <div>
              <label>Label (optional)</label>
              <input value={label} onChange={(e) => setLabel(e.target.value)} placeholder="Sent to family" />
            </div>
            <div>
              <label>Expires in (days)</label>
              <input
                type="number"
                min="1"
                max="365"
                value={days}
                onChange={(e) => setDays(Number(e.target.value))}
                style={{ width: 100 }}
              />
            </div>
            <button type="button" onClick={create}>Generate link</button>
          </div>
          {shares.length > 0 && (
            <table className="table">
              <thead>
                <tr>
                  <th>Label</th>
                  <th>Created</th>
                  <th>Expires</th>
                  <th>Status</th>
                  <th>Views</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {shares.map((s) => {
                  const expired = !s.revokedAt && new Date(s.expiresAt) < new Date();
                  return (
                    <tr key={s.id} style={{ opacity: s.revokedAt || expired ? 0.55 : 1 }}>
                      <td>{s.label ?? <span className="muted">—</span>}</td>
                      <td className="muted">{new Date(s.createdAt).toLocaleDateString()}</td>
                      <td className="muted">{new Date(s.expiresAt).toLocaleDateString()}</td>
                      <td>
                        {s.revokedAt ? <span className="badge badge-void">revoked</span>
                          : expired ? <span className="badge badge-overdue">expired</span>
                          : <span className="badge badge-paid">active</span>}
                      </td>
                      <td>{s.viewCount}</td>
                      <td>
                        {!s.revokedAt && !expired && (
                          <button type="button" className="button-ghost button-small" onClick={() => revoke(s)}>
                            Revoke
                          </button>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>
      )}
    </>
  );
}
