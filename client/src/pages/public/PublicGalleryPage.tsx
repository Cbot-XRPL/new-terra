import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';

interface Image {
  id: string;
  url: string;
  thumbnailUrl: string | null;
  filename: string;
  caption: string | null;
  phase: string | null;
  takenAt: string | null;
  createdAt: string;
  at: string;
}

interface Resp {
  project: { name: string; customerFirstName: string };
  images: Image[];
  label: string | null;
  expiresAt: string;
}

const API_BASE = import.meta.env.VITE_API_URL ?? '';

// Public read of a shared gallery — no auth, just the URL token. We
// deliberately don't render the customer's full name, address, budget,
// or anything else internal; this page can be forwarded freely.
export default function PublicGalleryPage() {
  const { token } = useParams<{ token: string }>();
  const [data, setData] = useState<Resp | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!token) return;
    fetch(`${API_BASE}/api/public/gallery/${encodeURIComponent(token)}`)
      .then(async (res) => {
        if (res.status === 404) { setError('That link is invalid or no longer active.'); return; }
        if (res.status === 410) { setError('That link has expired or been revoked.'); return; }
        if (!res.ok) { setError('Could not load the gallery.'); return; }
        const body = (await res.json()) as Resp;
        setData(body);
      })
      .catch(() => setError('Could not load the gallery.'));
  }, [token]);

  if (error) {
    return (
      <main style={{ maxWidth: 600, margin: '4rem auto', padding: '2rem', textAlign: 'center' }}>
        <h1>Gallery unavailable</h1>
        <p className="muted">{error}</p>
      </main>
    );
  }
  if (!data) {
    return <main style={{ padding: '2rem', textAlign: 'center' }}><p className="muted">Loading…</p></main>;
  }

  return (
    <main style={{ maxWidth: 1100, margin: '2rem auto', padding: '0 1rem' }}>
      <header style={{ marginBottom: '1.5rem' }}>
        <h1 style={{ margin: '0 0 0.25rem' }}>{data.project.name}</h1>
        <p className="muted">
          Shared by {data.project.customerFirstName} · New Terra Construction
          {data.label && <> · {data.label}</>}
        </p>
      </header>

      {data.images.length === 0 ? (
        <p className="muted">No photos in this gallery yet.</p>
      ) : (
        <div className="gallery">
          {data.images.map((img) => (
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
                  {img.phase && (
                    <span className="badge badge-sent" style={{ marginRight: '0.4rem' }}>{img.phase}</span>
                  )}
                  {new Date(img.at).toLocaleDateString()}
                </div>
              </figcaption>
            </figure>
          ))}
        </div>
      )}

      <footer style={{ marginTop: '3rem', textAlign: 'center', fontSize: '0.85rem', color: 'var(--text-muted)' }}>
        Photos courtesy of <strong>New Terra Construction</strong>.
        {' '}This link expires {new Date(data.expiresAt).toLocaleDateString()}.
      </footer>
    </main>
  );
}
