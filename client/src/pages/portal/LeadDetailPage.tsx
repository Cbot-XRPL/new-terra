import { type FormEvent, useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { ApiError, api } from '../../lib/api';
import { useAuth } from '../../auth/AuthContext';
import { formatCents, formatDateTime } from '../../lib/format';

type LeadStatus = 'NEW' | 'CONTACTED' | 'QUALIFIED' | 'QUOTE_SENT' | 'WON' | 'LOST' | 'ON_HOLD';
type LeadSource =
  | 'WEBSITE_FORM' | 'REFERRAL' | 'REPEAT_CUSTOMER' | 'GOOGLE'
  | 'ANGI' | 'HOME_DEPOT' | 'WALK_IN' | 'OTHER';

interface Activity {
  id: string;
  type: string;
  body: string;
  createdAt: string;
  author: { id: string; name: string; role: string };
}

interface Lead {
  id: string;
  name: string;
  email: string | null;
  phone: string | null;
  address: string | null;
  scope: string | null;
  estimatedValueCents: number | null;
  status: LeadStatus;
  source: LeadSource;
  notes: string | null;
  serviceCategory: string | null;
  landingPath: string | null;
  referrer: string | null;
  utmSource: string | null;
  utmMedium: string | null;
  utmCampaign: string | null;
  createdAt: string;
  updatedAt: string;
  convertedAt: string | null;
  owner: { id: string; name: string; email: string } | null;
  createdBy: { id: string; name: string };
  convertedToCustomer: { id: string; name: string; email: string } | null;
  activities: Activity[];
}

const STATUSES: LeadStatus[] = ['NEW', 'CONTACTED', 'QUALIFIED', 'QUOTE_SENT', 'WON', 'LOST', 'ON_HOLD'];
const SOURCES: LeadSource[] = ['WEBSITE_FORM', 'REFERRAL', 'REPEAT_CUSTOMER', 'GOOGLE', 'ANGI', 'HOME_DEPOT', 'WALK_IN', 'OTHER'];
const ACTIVITY_TYPES = ['note', 'call', 'email', 'meeting'] as const;

function humanize(s: string) {
  return s.toLowerCase().replace(/_/g, ' ');
}

const STATUS_BADGE: Record<LeadStatus, string> = {
  NEW: 'badge-draft',
  CONTACTED: 'badge-sent',
  QUALIFIED: 'badge-sent',
  QUOTE_SENT: 'badge-sent',
  WON: 'badge-paid',
  LOST: 'badge-overdue',
  ON_HOLD: 'badge-void',
};

export default function LeadDetailPage() {
  const { id } = useParams<{ id: string }>();
  const { user } = useAuth();

  const [lead, setLead] = useState<Lead | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<Partial<Lead> | null>(null);
  const [saving, setSaving] = useState(false);

  // Activity composer
  const [actType, setActType] = useState<(typeof ACTIVITY_TYPES)[number]>('note');
  const [actBody, setActBody] = useState('');
  const [actSubmitting, setActSubmitting] = useState(false);

  // Convert dialog
  const [convertEmail, setConvertEmail] = useState('');
  const [converting, setConverting] = useState(false);
  const [convertResult, setConvertResult] = useState<string | null>(null);

  async function load() {
    if (!id) return;
    try {
      const { lead } = await api<{ lead: Lead }>(`/api/leads/${id}`);
      setLead(lead);
      setConvertEmail(lead.email ?? '');
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to load lead');
    }
  }

  useEffect(() => { load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [id]);

  if (!lead) {
    return (
      <div className="dashboard">
        {error ? <div className="form-error">{error}</div> : <p className="muted">Loading…</p>}
      </div>
    );
  }

  async function patch(payload: Partial<Lead>) {
    setSaving(true);
    setError(null);
    try {
      const { lead: updated } = await api<{ lead: Lead }>(`/api/leads/${lead!.id}`, {
        method: 'PATCH',
        body: JSON.stringify(payload),
      });
      setLead({ ...lead!, ...updated });
      setEditing(null);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Save failed');
    } finally {
      setSaving(false);
    }
  }

  async function addActivity(e: FormEvent) {
    e.preventDefault();
    setActSubmitting(true);
    setError(null);
    try {
      await api(`/api/leads/${lead!.id}/activities`, {
        method: 'POST',
        body: JSON.stringify({ type: actType, body: actBody }),
      });
      setActBody('');
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to log activity');
    } finally {
      setActSubmitting(false);
    }
  }

  async function convert() {
    if (!convertEmail) {
      setError('Need an email to convert');
      return;
    }
    if (!confirm(`Convert ${lead!.name} to a customer at ${convertEmail}?`)) return;
    setConverting(true);
    setError(null);
    setConvertResult(null);
    try {
      const res = await api<{ lead: Lead; inviteUrl?: string }>(`/api/leads/${lead!.id}/convert`, {
        method: 'POST',
        body: JSON.stringify({ email: convertEmail, sendInvite: true }),
      });
      setConvertResult(
        res.lead.convertedToCustomer
          ? `Linked to existing user ${res.lead.convertedToCustomer.email}`
          : res.inviteUrl
            ? `Invitation created — dev URL: ${res.inviteUrl}`
            : `Invitation emailed to ${convertEmail}`,
      );
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Convert failed');
    } finally {
      setConverting(false);
    }
  }

  return (
    <div className="dashboard">
      <header>
        <Link to="/portal/leads" className="muted">← Leads</Link>
        <h1>{lead.name}</h1>
        <div className="muted">
          <span className={`badge ${STATUS_BADGE[lead.status]}`}>{humanize(lead.status)}</span>
          {' · '}source: {humanize(lead.source)}
          {lead.owner && <> · owned by <strong>{lead.owner.name}</strong></>}
        </div>
      </header>

      {error && <div className="form-error">{error}</div>}
      {convertResult && <div className="form-success" style={{ wordBreak: 'break-all' }}>{convertResult}</div>}

      <section className="card">
        <div className="row-between">
          <h2>Contact</h2>
          {!editing && (
            <button className="button-ghost button-small" onClick={() => setEditing({ ...lead })}>
              Edit
            </button>
          )}
        </div>
        {editing ? (
          <>
            <div className="form-row">
              <div>
                <label>Name</label>
                <input value={editing.name ?? ''} onChange={(e) => setEditing({ ...editing, name: e.target.value })} />
              </div>
              <div>
                <label>Email</label>
                <input type="email" value={editing.email ?? ''} onChange={(e) => setEditing({ ...editing, email: e.target.value })} />
              </div>
            </div>
            <div className="form-row">
              <div>
                <label>Phone</label>
                <input value={editing.phone ?? ''} onChange={(e) => setEditing({ ...editing, phone: e.target.value })} />
              </div>
              <div>
                <label>Address</label>
                <input value={editing.address ?? ''} onChange={(e) => setEditing({ ...editing, address: e.target.value })} />
              </div>
            </div>
            <label>Scope</label>
            <textarea rows={3} value={editing.scope ?? ''} onChange={(e) => setEditing({ ...editing, scope: e.target.value })} />
            <div className="form-row">
              <div>
                <label>Estimated value (USD)</label>
                <input
                  type="number"
                  min="0"
                  step="100"
                  value={editing.estimatedValueCents ? editing.estimatedValueCents / 100 : ''}
                  onChange={(e) =>
                    setEditing({
                      ...editing,
                      estimatedValueCents: e.target.value ? Math.round(Number(e.target.value) * 100) : null,
                    })
                  }
                />
              </div>
              <div>
                <label>Source</label>
                <select
                  value={editing.source ?? 'OTHER'}
                  onChange={(e) => setEditing({ ...editing, source: e.target.value as LeadSource })}
                >
                  {SOURCES.map((s) => <option key={s} value={s}>{humanize(s)}</option>)}
                </select>
              </div>
            </div>
            <label>Notes</label>
            <textarea rows={3} value={editing.notes ?? ''} onChange={(e) => setEditing({ ...editing, notes: e.target.value })} />
            <div style={{ display: 'flex', gap: '0.5rem' }}>
              <button onClick={() => patch(editing)} disabled={saving}>{saving ? 'Saving…' : 'Save'}</button>
              <button className="button-ghost" onClick={() => setEditing(null)}>Cancel</button>
            </div>
          </>
        ) : (
          <>
            <p>{lead.email ?? <span className="muted">no email</span>} · {lead.phone ?? <span className="muted">no phone</span>}</p>
            {lead.address && <p>{lead.address}</p>}
            {lead.scope && <p style={{ whiteSpace: 'pre-wrap' }}>{lead.scope}</p>}
            <p className="muted">
              {lead.estimatedValueCents ? formatCents(lead.estimatedValueCents) : 'no estimate'} · created {formatDateTime(lead.createdAt)} by {lead.createdBy.name}
            </p>
            {lead.notes && (
              <>
                <h3>Internal notes</h3>
                <p style={{ whiteSpace: 'pre-wrap' }}>{lead.notes}</p>
              </>
            )}
          </>
        )}
      </section>

      <section className="card">
        <div className="row-between">
          <h2>Status</h2>
          <select
            value={lead.status}
            onChange={(e) => patch({ status: e.target.value as LeadStatus })}
            style={{ marginBottom: 0, minWidth: 200 }}
          >
            {STATUSES.map((s) => (
              <option key={s} value={s}>{humanize(s)}</option>
            ))}
          </select>
        </div>
      </section>

      {(lead.serviceCategory || lead.landingPath || lead.referrer || lead.utmSource) && (
        <section className="card">
          <h2>Where they came from</h2>
          <dl className="meta-grid">
            {lead.serviceCategory && (<><dt>Asked about</dt><dd>{lead.serviceCategory}</dd></>)}
            {lead.landingPath && (<><dt>Landing page</dt><dd><code>{lead.landingPath}</code></dd></>)}
            {lead.referrer && (<><dt>Referrer</dt><dd><code>{lead.referrer}</code></dd></>)}
            {lead.utmSource && (<><dt>UTM source</dt><dd>{lead.utmSource}</dd></>)}
            {lead.utmMedium && (<><dt>UTM medium</dt><dd>{lead.utmMedium}</dd></>)}
            {lead.utmCampaign && (<><dt>UTM campaign</dt><dd>{lead.utmCampaign}</dd></>)}
          </dl>
        </section>
      )}

      <section className="card">
        <h2>Convert to customer</h2>
        {lead.convertedToCustomer ? (
          <p>
            Linked to <strong>{lead.convertedToCustomer.name}</strong> ({lead.convertedToCustomer.email})
            {lead.convertedAt && <> · {formatDateTime(lead.convertedAt)}</>}
          </p>
        ) : lead.convertedAt ? (
          <p className="muted">Invitation issued {formatDateTime(lead.convertedAt)} — pending acceptance.</p>
        ) : (
          <>
            <p className="muted">
              Issues an invitation so the customer can set their password and access the portal.
              If a user already exists with this email we'll link to it instead.
            </p>
            <div className="form-row">
              <div>
                <label>Email</label>
                <input type="email" value={convertEmail} onChange={(e) => setConvertEmail(e.target.value)} />
              </div>
              <div style={{ alignSelf: 'end' }}>
                <button onClick={convert} disabled={converting || !convertEmail}>
                  {converting ? 'Converting…' : 'Convert'}
                </button>
              </div>
            </div>
          </>
        )}
      </section>

      <section className="card">
        <h2>Activity</h2>
        <form onSubmit={addActivity} style={{ marginBottom: '1rem' }}>
          <div className="form-row">
            <div>
              <label>Type</label>
              <select value={actType} onChange={(e) => setActType(e.target.value as typeof ACTIVITY_TYPES[number])}>
                {ACTIVITY_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
              </select>
            </div>
            <div style={{ flex: 2 }}>
              <label>Notes</label>
              <input
                value={actBody}
                onChange={(e) => setActBody(e.target.value)}
                placeholder="What happened?"
                required
              />
            </div>
          </div>
          <button type="submit" disabled={actSubmitting || !actBody}>{actSubmitting ? 'Logging…' : 'Log activity'}</button>
        </form>

        {lead.activities.length ? (
          <ul className="list">
            {lead.activities.map((a) => (
              <li key={a.id}>
                <strong>{a.type.replace('_', ' ')}</strong>{' '}
                <span className="muted">· {a.author.name} · {formatDateTime(a.createdAt)}</span>
                <p style={{ whiteSpace: 'pre-wrap', marginTop: '0.25rem' }}>{a.body}</p>
              </li>
            ))}
          </ul>
        ) : (
          <p className="muted">No activity yet.</p>
        )}
        {/* Suppress unused warning until we wire role-gated actions further. */}
        {user && null}
      </section>
    </div>
  );
}
