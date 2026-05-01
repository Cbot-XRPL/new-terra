import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { ApiError, api } from '../../lib/api';
import { useAuth } from '../../auth/AuthContext';
import { formatDate } from '../../lib/format';

const API_BASE = import.meta.env.VITE_API_URL ?? '';

interface GalleryImage {
  id: string;
  url: string;
  thumbnailUrl: string | null;
  mediumUrl: string | null;
  caption: string | null;
  phase: string | null;
  takenAt: string | null;
  createdAt: string;
  project: { id: string; name: string; address: string | null };
  uploadedBy: { id: string; name: string };
}

interface ProjectFilterOption {
  id: string;
  name: string;
  _count: { images: number };
}

interface ListResponse {
  images: GalleryImage[];
  total: number;
  page: number;
  pageSize: number;
  projects: ProjectFilterOption[];
}

function authHeaders(): Record<string, string> {
  const token = sessionStorage.getItem('nt_token') ?? localStorage.getItem('nt_token');
  return token ? { Authorization: `Bearer ${token}` } : {};
}

// Detect a video upload by file extension on the URL since we don't
// store mime type. Covers everything iOS / Android camera apps spit out.
function isVideo(url: string): boolean {
  return /\.(mp4|mov|m4v|webm|avi|mkv)(\?|$)/i.test(url);
}

// Cross-project gallery page. Shows every photo the caller can see,
// grouped under each photo's project label. Click a thumbnail to open
// a lightbox; staff get an Upload button at the top that picks a
// project + posts to the existing /api/projects/:id/images endpoint.
export default function GalleryPage() {
  const { user } = useAuth();
  const [data, setData] = useState<ListResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [page, setPage] = useState(1);
  const [filterProjectId, setFilterProjectId] = useState<string>('');
  const [lightbox, setLightbox] = useState<GalleryImage | null>(null);

  // Upload state
  const fileRef = useRef<HTMLInputElement | null>(null);
  const [uploadProjectId, setUploadProjectId] = useState<string>('');
  const [uploading, setUploading] = useState(false);

  const isStaff = user?.role !== 'CUSTOMER';

  async function load() {
    try {
      const params = new URLSearchParams({
        page: String(page),
        pageSize: '60',
      });
      if (filterProjectId) params.set('projectId', filterProjectId);
      const r = await api<ListResponse>(`/api/portal/gallery?${params.toString()}`);
      setData(r);
      // Default the upload picker to the most-recent project so the
      // user can upload without expanding the dropdown.
      if (!uploadProjectId && r.projects.length > 0) {
        setUploadProjectId(r.projects[0]!.id);
      }
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to load gallery');
    }
  }
  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page, filterProjectId]);

  async function handleUpload(files: FileList) {
    if (!uploadProjectId || files.length === 0) return;
    setError(null);
    setUploading(true);
    try {
      const form = new FormData();
      for (const f of Array.from(files)) form.append('images', f);
      const res = await fetch(
        `${API_BASE}/api/projects/${uploadProjectId}/images`,
        { method: 'POST', headers: authHeaders(), body: form },
      );
      if (!res.ok) {
        const j = await res.json().catch(() => null);
        throw new ApiError(res.status, j?.error ?? res.statusText, j);
      }
      // Bounce back to page 1 so the new photos are visible immediately.
      if (page !== 1) setPage(1); else await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Upload failed');
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  }

  const totalPages = data ? Math.max(1, Math.ceil(data.total / data.pageSize)) : 1;

  return (
    <div className="dashboard">
      <header className="row-between">
        <div>
          <h1>Gallery</h1>
          <p className="muted">
            Every photo across {isStaff ? 'every project' : 'your projects'} in one place.
          </p>
        </div>
        {isStaff && data && data.projects.length > 0 && (
          <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center', flexWrap: 'wrap' }}>
            <select
              value={uploadProjectId}
              onChange={(e) => setUploadProjectId(e.target.value)}
              title="Project to attach uploaded photos to"
              style={{ marginBottom: 0, minWidth: 180 }}
            >
              {data.projects.map((p) => (
                <option key={p.id} value={p.id}>{p.name}</option>
              ))}
            </select>
            <input
              ref={fileRef}
              type="file"
              accept="image/*,video/*"
              multiple
              capture="environment"
              style={{ display: 'none' }}
              onChange={(e) => e.target.files && handleUpload(e.target.files)}
            />
            <button
              type="button"
              onClick={() => fileRef.current?.click()}
              disabled={uploading || !uploadProjectId}
            >
              {uploading ? 'Uploading…' : '+ Upload photos'}
            </button>
          </div>
        )}
      </header>

      {error && <div className="form-error">{error}</div>}

      {data && data.projects.length > 1 && (
        <section className="card" style={{ padding: '0.75rem 1rem' }}>
          <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center', flexWrap: 'wrap' }}>
            <label style={{ margin: 0, fontSize: '0.85rem' }}>Filter by project</label>
            <select
              value={filterProjectId}
              onChange={(e) => { setFilterProjectId(e.target.value); setPage(1); }}
              style={{ marginBottom: 0 }}
            >
              <option value="">All projects ({data.total})</option>
              {data.projects.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name} ({p._count.images})
                </option>
              ))}
            </select>
          </div>
        </section>
      )}

      <section className="card">
        {!data ? (
          <p className="muted">Loading…</p>
        ) : data.images.length === 0 ? (
          <p className="muted">
            No photos {filterProjectId ? 'on this project' : 'yet'}. {isStaff && 'Tap Upload above to add the first batch.'}
          </p>
        ) : (
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))',
              gap: '0.5rem',
            }}
          >
            {data.images.map((img) => {
              const video = isVideo(img.url);
              return (
                <button
                  key={img.id}
                  type="button"
                  className="gallery-tile"
                  onClick={() => setLightbox(img)}
                  title={img.caption ?? `${img.project.name} · ${formatDate(img.takenAt ?? img.createdAt)}`}
                >
                  {video ? (
                    // Native <video> renders the first frame as the
                    // poster automatically; preload="metadata" pulls
                    // just enough header bytes to show that frame
                    // without streaming the whole file.
                    <video
                      src={img.url}
                      preload="metadata"
                      muted
                      playsInline
                      style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }}
                    />
                  ) : (
                    <img
                      src={img.thumbnailUrl ?? img.mediumUrl ?? img.url}
                      alt={img.caption ?? img.project.name}
                      loading="lazy"
                    />
                  )}
                  {video && (
                    <span className="gallery-tile-badge" aria-hidden="true">▶</span>
                  )}
                  <div className="gallery-tile-overlay">
                    <div className="gallery-tile-project">{img.project.name}</div>
                    <div className="gallery-tile-date muted">
                      {formatDate(img.takenAt ?? img.createdAt)}
                    </div>
                  </div>
                </button>
              );
            })}
          </div>
        )}
      </section>

      {data && data.total > data.pageSize && (
        <div className="pagination">
          <span className="muted">
            {(page - 1) * data.pageSize + 1}–{Math.min(page * data.pageSize, data.total)} of {data.total}
          </span>
          <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
            <button
              className="button-ghost button-small"
              disabled={page <= 1}
              onClick={() => setPage((p) => p - 1)}
            >
              ◀ Prev
            </button>
            <span className="muted">Page {page} of {totalPages}</span>
            <button
              className="button-ghost button-small"
              disabled={page >= totalPages}
              onClick={() => setPage((p) => p + 1)}
            >
              Next ▶
            </button>
          </div>
        </div>
      )}

      {lightbox && (
        <div
          className="gallery-lightbox"
          role="dialog"
          aria-label="Photo viewer"
          onClick={() => setLightbox(null)}
        >
          <button
            type="button"
            className="gallery-lightbox-close"
            onClick={(e) => { e.stopPropagation(); setLightbox(null); }}
            aria-label="Close"
          >
            ×
          </button>
          {isVideo(lightbox.url) ? (
            <video
              src={lightbox.url}
              controls
              autoPlay
              playsInline
              onClick={(e) => e.stopPropagation()}
              style={{
                maxWidth: '100%',
                maxHeight: 'calc(100vh - 8rem)',
                borderRadius: 6,
              }}
            />
          ) : (
            <img
              src={lightbox.mediumUrl ?? lightbox.url}
              alt={lightbox.caption ?? lightbox.project.name}
              onClick={(e) => e.stopPropagation()}
            />
          )}
          <div
            className="gallery-lightbox-meta"
            onClick={(e) => e.stopPropagation()}
          >
            <Link to={`/portal/projects/${lightbox.project.id}`}>
              <strong>{lightbox.project.name}</strong>
            </Link>
            {lightbox.project.address && (
              <span className="muted"> · {lightbox.project.address}</span>
            )}
            <div className="muted" style={{ fontSize: '0.85rem' }}>
              {formatDate(lightbox.takenAt ?? lightbox.createdAt)}
              {lightbox.uploadedBy && <> · {lightbox.uploadedBy.name}</>}
              {lightbox.phase && <> · {lightbox.phase}</>}
            </div>
            {lightbox.caption && <p style={{ marginTop: '0.5rem' }}>{lightbox.caption}</p>}
          </div>
        </div>
      )}
    </div>
  );
}
