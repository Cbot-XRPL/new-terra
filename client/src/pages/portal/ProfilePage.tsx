import { type FormEvent, useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ApiError, api } from '../../lib/api';
import { useAuth, type AuthUser } from '../../auth/AuthContext';
import Avatar from '../../components/Avatar';
import InstallAppButton from '../../components/InstallAppButton';
import {
  type ThemeMode,
  type CookieConsent,
  getStoredTheme,
  setStoredTheme,
  getCookieConsent,
  setCookieConsent,
} from '../../lib/theme';

const API_BASE = import.meta.env.VITE_API_URL ?? '';

function authHeaders(): Record<string, string> {
  const token = (sessionStorage.getItem('nt_token') ?? localStorage.getItem('nt_token'));
  return token ? { Authorization: `Bearer ${token}` } : {};
}

export default function ProfilePage() {
  const { user, refreshUser, logout } = useAuth();
  const navigate = useNavigate();

  const [name, setName] = useState(user?.name ?? '');
  const [email, setEmail] = useState(user?.email ?? '');
  const [phone, setPhone] = useState(user?.phone ?? '');
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);

  const fileInput = useRef<HTMLInputElement>(null);

  // Settings state — read once on mount; setters mirror to localStorage and
  // (for theme) re-apply the data-theme attribute immediately.
  const [themeMode, setThemeMode] = useState<ThemeMode>(getStoredTheme);
  const [cookies, setCookies] = useState<CookieConsent>(getCookieConsent);

  function pickTheme(next: ThemeMode) {
    setThemeMode(next);
    setStoredTheme(next);
  }
  function pickCookies(next: CookieConsent) {
    setCookies(next);
    setCookieConsent(next);
  }

  // Keep the form in sync if the cached user object changes (e.g. after an
  // avatar upload triggers refreshUser).
  useEffect(() => {
    if (!user) return;
    setName(user.name);
    setEmail(user.email);
    setPhone(user.phone ?? '');
  }, [user]);

  // Allow deep-linking to the settings card via /portal/profile#settings
  // (the gear icon in the sidebar uses this).
  useEffect(() => {
    if (window.location.hash === '#settings') {
      const el = document.getElementById('settings');
      if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  }, []);

  if (!user) return null;

  async function saveProfile(e: FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    setSuccess(null);
    try {
      const { user: updated } = await api<{ user: AuthUser }>('/api/me/profile', {
        method: 'PATCH',
        body: JSON.stringify({
          name,
          email,
          phone: phone ? phone : null,
        }),
      });
      await refreshUser(updated);
      setSuccess('Profile saved.');
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Save failed');
    } finally {
      setSaving(false);
    }
  }

  async function uploadAvatar(file: File) {
    setUploading(true);
    setError(null);
    setSuccess(null);
    try {
      const form = new FormData();
      form.append('file', file);
      const res = await fetch(`${API_BASE}/api/me/avatar`, {
        method: 'POST',
        headers: authHeaders(),
        body: form,
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) throw new ApiError(res.status, data?.error ?? res.statusText, data);
      await refreshUser(data.user as AuthUser);
      setSuccess('Profile picture updated.');
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Upload failed');
    } finally {
      setUploading(false);
      if (fileInput.current) fileInput.current.value = '';
    }
  }

  async function removeAvatar() {
    if (!confirm('Remove your profile picture?')) return;
    setError(null);
    setSuccess(null);
    try {
      const { user: updated } = await api<{ user: AuthUser }>('/api/me/avatar', { method: 'DELETE' });
      await refreshUser(updated);
      setSuccess('Profile picture removed.');
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Remove failed');
    }
  }

  return (
    <div className="dashboard">
      <header>
        <h1>Your profile</h1>
        <p className="muted">Update how the rest of the team sees you.</p>
      </header>

      {error && <div className="form-error">{error}</div>}
      {success && <div className="form-success">{success}</div>}

      <section className="card">
        <h2>Profile picture</h2>
        <div style={{ display: 'flex', alignItems: 'center', gap: '1.25rem', flexWrap: 'wrap' }}>
          <Avatar name={user.name} url={user.avatarUrl} size={96} />
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
            <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
              <button
                type="button"
                onClick={() => fileInput.current?.click()}
                disabled={uploading}
              >
                {uploading ? 'Uploading…' : user.avatarUrl ? 'Change photo' : 'Upload photo'}
              </button>
              {user.avatarUrl && (
                <button type="button" className="button-ghost" onClick={removeAvatar} disabled={uploading}>
                  Remove
                </button>
              )}
            </div>
            <p className="muted" style={{ fontSize: '0.85rem', margin: 0 }}>
              We resize to 512px and generate a 96px thumbnail for the nav. JPEG or PNG up to 8 MB.
            </p>
          </div>
        </div>
        <input
          ref={fileInput}
          type="file"
          accept="image/*"
          style={{ display: 'none' }}
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) uploadAvatar(f);
          }}
        />
      </section>

      <section className="card">
        <h2>Details</h2>
        <form onSubmit={saveProfile}>
          <label htmlFor="p-name">Full name</label>
          <input id="p-name" value={name} onChange={(e) => setName(e.target.value)} required />

          <label htmlFor="p-email">Email</label>
          <input
            id="p-email"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
            autoComplete="email"
          />
          <p className="muted" style={{ fontSize: '0.8rem', margin: '-0.5rem 0 1rem' }}>
            Used to sign in. Changing it takes effect immediately — no confirmation email yet.
          </p>

          <label htmlFor="p-phone">Phone</label>
          <input
            id="p-phone"
            type="tel"
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            placeholder="(555) 123-4567"
            autoComplete="tel"
          />

          <div style={{ display: 'flex', gap: '0.5rem' }}>
            <button type="submit" disabled={saving}>
              {saving ? 'Saving…' : 'Save changes'}
            </button>
          </div>
        </form>
      </section>

      <section id="settings" className="card">
        <h2>Settings</h2>

        <h3 style={{ marginTop: '0.5rem', marginBottom: '0.5rem' }}>Appearance</h3>
        <p className="muted" style={{ fontSize: '0.85rem', marginBottom: '0.75rem' }}>
          Picks the colour scheme for the whole app. <em>System</em> follows your OS preference.
        </p>
        <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap', marginBottom: '1.25rem' }}>
          {(['native', 'light', 'dark'] as ThemeMode[]).map((m) => (
            <button
              key={m}
              type="button"
              className={themeMode === m ? 'button' : 'button button-ghost'}
              onClick={() => pickTheme(m)}
            >
              {m === 'native' ? 'Native' : m === 'light' ? 'Light' : 'Dark'}
            </button>
          ))}
        </div>

        <h3 style={{ marginTop: '0.5rem', marginBottom: '0.5rem' }}>Cookies & storage</h3>
        <p className="muted" style={{ fontSize: '0.85rem', marginBottom: '0.75rem' }}>
          We always use a small amount of essential storage so you stay signed in and your offline
          uploads can replay. Optional cookies (e.g. future analytics) are off by default — you can
          opt in any time.
        </p>
        <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
          <button
            type="button"
            className={cookies === 'minimal' ? 'button' : 'button button-ghost'}
            onClick={() => pickCookies('minimal')}
          >
            Essential only
          </button>
          <button
            type="button"
            className={cookies === 'all' ? 'button' : 'button button-ghost'}
            onClick={() => pickCookies('all')}
          >
            Allow all
          </button>
        </div>
        <p className="muted" style={{ fontSize: '0.8rem', margin: '0.75rem 0 0' }}>
          Currently: <strong>{cookies === 'all' ? 'All cookies allowed' : 'Essential only (default)'}</strong>.
          Stored locally — clearing browser data resets this.
        </p>
      </section>

      <DocumentsSection user={user} refreshUser={refreshUser} />

      <section className="card">
        <h2>Account</h2>
        <dl className="kv">
          <dt>Role</dt>
          <dd>{user.role.toLowerCase()}</dd>
          {(user.isSales || user.isProjectManager) && (
            <>
              <dt>Capabilities</dt>
              <dd>
                {[user.isSales ? 'sales' : null, user.isProjectManager ? 'project manager' : null]
                  .filter(Boolean)
                  .join(', ')}
              </dd>
            </>
          )}
        </dl>
        <div style={{ marginTop: '1.5rem', paddingTop: '1rem', borderTop: '1px solid var(--border)' }}>
          <h3 style={{ marginTop: 0, marginBottom: '0.5rem', fontSize: '0.95rem' }}>
            Mobile app
          </h3>
          <InstallAppButton />
        </div>

        <div style={{ marginTop: '1rem' }}>
          <button
            type="button"
            className="button button-ghost"
            onClick={() => {
              logout();
              navigate('/');
            }}
          >
            Sign out
          </button>
        </div>
      </section>
    </div>
  );
}

// ─── Documents (licenses) ────────────────────────────────────────────
// One uploader per license type. Driver's licence is shown to everyone
// and flagged as required; contractor + business licences only show for
// SUBCONTRACTOR users. Files are saved as image (resized webp) or PDF.

interface DocSpec {
  slug: 'driver' | 'contractor' | 'business';
  label: string;
  required?: boolean;
  description?: string;
}

function DocumentsSection({
  user,
  refreshUser,
}: {
  user: AuthUser;
  refreshUser: (next?: AuthUser) => Promise<void>;
}) {
  const isContractor = user.role === 'SUBCONTRACTOR';
  const docs: DocSpec[] = [
    {
      slug: 'driver',
      label: "Driver's licence",
      required: true,
      description: 'Required for everyone — keep on file for project sign-ins and 1099 record-keeping.',
    },
  ];
  if (isContractor) {
    docs.push(
      {
        slug: 'contractor',
        label: 'Contractor licence',
        description: 'State / county contractor licence (if your trade requires one).',
      },
      {
        slug: 'business',
        label: 'Business licence',
        description: 'Business licence or LLC certificate.',
      },
    );
  }
  return (
    <section className="card">
      <h2>Documents</h2>
      {!user.driversLicenseUrl && (
        <div className="form-error" style={{ marginBottom: '1rem' }}>
          Driver's licence required — please upload below.
        </div>
      )}
      <p className="muted" style={{ fontSize: '0.85rem', marginBottom: '1rem' }}>
        We accept JPG, PNG, or PDF up to 10 MB. Replacement uploads overwrite
        the prior file.
      </p>
      {docs.map((d) => {
        const url = (
          d.slug === 'driver' ? user.driversLicenseUrl :
          d.slug === 'contractor' ? user.contractorLicenseUrl :
          user.businessLicenseUrl
        );
        return (
          <DocRow
            key={d.slug}
            spec={d}
            url={url ?? null}
            onChanged={async (next) => {
              await refreshUser(next);
            }}
          />
        );
      })}
    </section>
  );
}

function DocRow({
  spec,
  url,
  onChanged,
}: {
  spec: DocSpec;
  url: string | null;
  onChanged: (next: AuthUser) => Promise<void>;
}) {
  const fileRef = useRef<HTMLInputElement | null>(null);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function upload(file: File) {
    setError(null);
    setUploading(true);
    try {
      const form = new FormData();
      form.append('file', file);
      const res = await fetch(`${API_BASE}/api/me/license/${spec.slug}`, {
        method: 'POST',
        headers: authHeaders(),
        body: form,
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) throw new ApiError(res.status, data?.error ?? res.statusText, data);
      await onChanged(data.user as AuthUser);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Upload failed');
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  }

  async function remove() {
    if (!confirm(`Remove your ${spec.label.toLowerCase()}?`)) return;
    setError(null);
    try {
      const { user: updated } = await api<{ user: AuthUser }>(
        `/api/me/license/${spec.slug}`,
        { method: 'DELETE' },
      );
      await onChanged(updated);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Remove failed');
    }
  }

  return (
    <div style={{ marginBottom: '1.25rem', paddingBottom: '1rem', borderBottom: '1px solid var(--border)' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', flexWrap: 'wrap', gap: '0.5rem' }}>
        <div>
          <strong>{spec.label}</strong>
          {spec.required && <span style={{ color: 'var(--error)', marginLeft: 4 }}>*</span>}
          {url ? (
            <span className="muted" style={{ marginLeft: 8, fontSize: '0.85rem' }}>· on file</span>
          ) : (
            <span className="muted" style={{ marginLeft: 8, fontSize: '0.85rem' }}>· not uploaded</span>
          )}
        </div>
        <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
          {url && (
            <a
              href={url}
              target="_blank"
              rel="noreferrer"
              className="button button-ghost button-small"
            >
              View
            </a>
          )}
          <button
            type="button"
            className="button-small"
            onClick={() => fileRef.current?.click()}
            disabled={uploading}
          >
            {uploading ? 'Uploading…' : url ? 'Replace' : 'Upload'}
          </button>
          {url && (
            <button
              type="button"
              className="button button-ghost button-small"
              onClick={remove}
              disabled={uploading}
            >
              Remove
            </button>
          )}
        </div>
      </div>
      {spec.description && (
        <p className="muted" style={{ fontSize: '0.8rem', margin: '0.25rem 0 0' }}>
          {spec.description}
        </p>
      )}
      {error && <div className="form-error" style={{ marginTop: '0.5rem' }}>{error}</div>}
      <input
        ref={fileRef}
        type="file"
        accept="image/*,application/pdf"
        style={{ display: 'none' }}
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) upload(f);
        }}
      />
    </div>
  );
}
