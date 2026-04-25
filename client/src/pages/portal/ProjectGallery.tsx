import { type FormEvent, useEffect, useRef, useState } from 'react';
import { ApiError } from '../../lib/api';
import { useAuth, type Role } from '../../auth/AuthContext';
import { formatDateTime } from '../../lib/format';

interface ProjectImage {
  id: string;
  url: string;
  filename: string;
  caption: string | null;
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

async function uploadFiles(projectId: string, files: FileList, caption: string) {
  const form = new FormData();
  for (const f of Array.from(files)) form.append('files', f);
  if (caption) form.append('caption', caption);
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
      await uploadFiles(projectId, files, caption);
      setCaption('');
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
      <h2>Photos</h2>
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
                <img src={img.url} alt={img.caption ?? img.filename} loading="lazy" />
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
