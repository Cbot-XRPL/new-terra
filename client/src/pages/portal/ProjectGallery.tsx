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
        <Link to={`/portal/projects/${projectId}/timeline`} className="button-ghost button-small">
          View timeline →
        </Link>
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
