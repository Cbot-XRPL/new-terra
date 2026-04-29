import { useRef } from 'react';
import { Paperclip, X } from 'lucide-react';

const API_BASE = import.meta.env.VITE_API_URL ?? '';

// Persisted shape stored on each parent row server-side.
export interface Attachment {
  url: string;
  thumbnailUrl: string;
  filename: string;
}

/**
 * File picker for image attachments on a message-style compose form.
 * Tracks selected files in a parent-managed array. The compose form is
 * responsible for sending them as multipart `attachments[]` on submit.
 */
interface InputProps {
  files: File[];
  onChange: (files: File[]) => void;
  max?: number;
  disabled?: boolean;
}

export function AttachmentInput({ files, onChange, max = 5, disabled }: InputProps) {
  const inputRef = useRef<HTMLInputElement>(null);

  function add(picked: FileList | null) {
    if (!picked) return;
    const merged = [...files, ...Array.from(picked)].slice(0, max);
    onChange(merged);
    if (inputRef.current) inputRef.current.value = '';
  }

  function remove(index: number) {
    onChange(files.filter((_, i) => i !== index));
  }

  return (
    <div className="attachment-input">
      <button
        type="button"
        className="button-ghost button-small"
        onClick={() => inputRef.current?.click()}
        disabled={disabled || files.length >= max}
        title="Attach images"
      >
        <Paperclip size={16} /> Attach
      </button>
      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        multiple
        style={{ display: 'none' }}
        onChange={(e) => add(e.target.files)}
      />
      {files.length > 0 && (
        <div className="attachment-pending">
          {files.map((f, i) => (
            <span key={i} className="attachment-pending-pill">
              {f.name}
              <button
                type="button"
                onClick={() => remove(i)}
                aria-label={`Remove ${f.name}`}
                title="Remove"
              >
                <X size={12} />
              </button>
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

/**
 * Renders the saved attachments from a post/message/comment as a thumbnail
 * strip. Click any thumb to open the full-size in a new tab.
 */
interface GalleryProps {
  attachments: Attachment[];
}

export function AttachmentGallery({ attachments }: GalleryProps) {
  if (attachments.length === 0) return null;
  return (
    <div className="attachment-gallery">
      {attachments.map((a, i) => (
        <a
          key={i}
          href={`${API_BASE}${a.url}`}
          target="_blank"
          rel="noreferrer"
          className="attachment-thumb"
          title={a.filename}
        >
          <img src={`${API_BASE}${a.thumbnailUrl}`} alt={a.filename} loading="lazy" />
        </a>
      ))}
    </div>
  );
}

/** Best-effort coercion from the server's JSON column to typed Attachment[]. */
export function asAttachments(json: unknown): Attachment[] {
  if (!Array.isArray(json)) return [];
  return json.filter(
    (a): a is Attachment =>
      a != null &&
      typeof a === 'object' &&
      typeof (a as Attachment).url === 'string' &&
      typeof (a as Attachment).thumbnailUrl === 'string' &&
      typeof (a as Attachment).filename === 'string',
  );
}
