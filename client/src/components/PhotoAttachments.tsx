import { useEffect, useRef, useState } from 'react';
import { ApiError, api } from '../lib/api';

const API_BASE = import.meta.env.VITE_API_URL ?? '';

interface Attachment {
  id: string;
  filename: string;
  url: string;
  thumbnailUrl: string | null;
  caption: string | null;
  createdAt: string;
  uploadedBy: { id: string; name: string };
}

interface Props {
  // 'leads' or 'estimates' — drives the API path.
  parent: 'leads' | 'estimates';
  parentId: string;
  // Whether the current viewer can upload + delete.
  canEdit: boolean;
  title?: string;
  emptyText?: string;
}

function authHeaders(): Record<string, string> {
  const token = sessionStorage.getItem('nt_token') ?? localStorage.getItem('nt_token');
  return token ? { Authorization: `Bearer ${token}` } : {};
}

// Reusable photo gallery + uploader for leads + estimates. The data
// shape is identical between the two; we just swap the API path.
export default function PhotoAttachments({
  parent,
  parentId,
  canEdit,
  title = 'Photos',
  emptyText,
}: Props) {
  const [photos, setPhotos] = useState<Attachment[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const fileRef = useRef<HTMLInputElement | null>(null);

  async function load() {
    try {
      const r = await api<{ attachments: Attachment[] }>(
        `/api/${parent}/${parentId}/attachments`,
      );
      setPhotos(r.attachments);
    } catch (err) {
      if (err instanceof ApiError && err.status === 403) {
        setPhotos([]);
        return;
      }
      setError(err instanceof ApiError ? err.message : 'Failed to load photos');
    }
  }
  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [parent, parentId]);

  async function upload(file: File) {
    setError(null);
    setUploading(true);
    try {
      const form = new FormData();
      form.append('file', file);
      const res = await fetch(`${API_BASE}/api/${parent}/${parentId}/attachments`, {
        method: 'POST',
        headers: authHeaders(),
        body: form,
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) throw new ApiError(res.status, data?.error ?? res.statusText, data);
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Upload failed');
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  }

  async function remove(id: string) {
    if (!confirm('Delete this photo?')) return;
    setError(null);
    try {
      await api(`/api/${parent}/${parentId}/attachments/${id}`, { method: 'DELETE' });
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Delete failed');
    }
  }

  return (
    <section className="card">
      <div className="row-between" style={{ marginBottom: '0.75rem' }}>
        <h2 style={{ margin: 0 }}>{title}</h2>
        {canEdit && (
          <>
            <input
              ref={fileRef}
              type="file"
              accept="image/*"
              capture="environment"
              style={{ display: 'none' }}
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) upload(f);
              }}
            />
            <button
              type="button"
              className="button-small"
              onClick={() => fileRef.current?.click()}
              disabled={uploading}
            >
              {uploading ? 'Uploading…' : 'Add photo'}
            </button>
          </>
        )}
      </div>
      {error && <div className="form-error">{error}</div>}
      {photos === null ? (
        <p className="muted">Loading…</p>
      ) : photos.length === 0 ? (
        <p className="muted">{emptyText ?? 'No photos yet.'}</p>
      ) : (
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fill, minmax(140px, 1fr))',
            gap: '0.5rem',
          }}
        >
          {photos.map((p) => (
            <figure
              key={p.id}
              style={{
                margin: 0,
                position: 'relative',
                background: 'var(--surface-strong)',
                borderRadius: 8,
                overflow: 'hidden',
                aspectRatio: '1',
              }}
            >
              <a href={p.url} target="_blank" rel="noreferrer">
                <img
                  src={p.thumbnailUrl ?? p.url}
                  alt={p.caption ?? p.filename}
                  loading="lazy"
                  style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }}
                />
              </a>
              {canEdit && (
                <button
                  type="button"
                  onClick={() => remove(p.id)}
                  title="Delete"
                  style={{
                    position: 'absolute',
                    top: 4,
                    right: 4,
                    background: 'rgba(0,0,0,0.6)',
                    color: '#fff',
                    border: 'none',
                    borderRadius: '50%',
                    width: 22,
                    height: 22,
                    fontSize: 12,
                    padding: 0,
                    cursor: 'pointer',
                  }}
                >
                  ×
                </button>
              )}
            </figure>
          ))}
        </div>
      )}
    </section>
  );
}
