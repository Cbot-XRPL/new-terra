// Horizontal scrollable strip of recent project photos for the staff
// overview. Each tile links to the project. Native horizontal scroll +
// scroll-snap means it works on touch (swipe) and mouse (wheel + arrow
// buttons) without a carousel library.

import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { ApiError, api } from '../../lib/api';
import { ChevronLeft, ChevronRight } from 'lucide-react';

const API_BASE = import.meta.env.VITE_API_URL ?? '';

interface Image {
  id: string;
  url: string;
  thumbnailUrl: string | null;
  mediumUrl: string | null;
  caption: string | null;
  phase: string | null;
  takenAt: string | null;
  createdAt: string;
  project: { id: string; name: string };
  uploadedBy: { id: string; name: string };
}

export default function ProjectImageCarousel() {
  const [images, setImages] = useState<Image[]>([]);
  const [error, setError] = useState<string | null>(null);
  const stripRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    api<{ images: Image[] }>('/api/portal/staff/recent-images')
      .then((r) => setImages(r.images))
      .catch((err) =>
        setError(err instanceof ApiError ? err.message : 'Failed to load photos'),
      );
  }, []);

  function scrollBy(dir: -1 | 1) {
    const el = stripRef.current;
    if (!el) return;
    el.scrollBy({ left: dir * (el.clientWidth * 0.85), behavior: 'smooth' });
  }

  if (error) {
    return (
      <section className="card">
        <div className="form-error">{error}</div>
      </section>
    );
  }
  if (images.length === 0) return null;

  return (
    <section className="card">
      <div className="row-between" style={{ marginBottom: '0.5rem' }}>
        <div>
          <h2 style={{ margin: 0 }}>Recent project photos</h2>
          <p className="muted" style={{ fontSize: '0.85rem', margin: '0.25rem 0 0' }}>
            What's happening on jobs across the company.
          </p>
        </div>
        <div style={{ display: 'flex', gap: '0.25rem' }}>
          <button
            type="button"
            className="button-ghost button-small"
            onClick={() => scrollBy(-1)}
            aria-label="Scroll left"
          >
            <ChevronLeft size={16} />
          </button>
          <button
            type="button"
            className="button-ghost button-small"
            onClick={() => scrollBy(1)}
            aria-label="Scroll right"
          >
            <ChevronRight size={16} />
          </button>
        </div>
      </div>

      <div ref={stripRef} className="photo-strip">
        {images.map((img) => {
          const src = img.thumbnailUrl ?? img.mediumUrl ?? img.url;
          return (
            <Link
              key={img.id}
              to={`/portal/projects/${img.project.id}`}
              className="photo-strip-item"
              title={img.caption ?? img.project.name}
            >
              <img src={`${API_BASE}${src}`} alt={img.caption ?? img.project.name} loading="lazy" />
              <div className="photo-strip-caption">
                <strong>{img.project.name}</strong>
                {img.caption && (
                  <span className="muted" style={{ fontSize: '0.75rem' }}>
                    {img.caption.slice(0, 40)}
                    {img.caption.length > 40 ? '…' : ''}
                  </span>
                )}
                {img.phase && !img.caption && (
                  <span className="muted" style={{ fontSize: '0.75rem' }}>
                    {img.phase}
                  </span>
                )}
              </div>
            </Link>
          );
        })}
      </div>
    </section>
  );
}
