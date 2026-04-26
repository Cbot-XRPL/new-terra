import { type FormEvent, useEffect, useState } from 'react';
import { ApiError, api } from '../../lib/api';
import { useAuth } from '../../auth/AuthContext';
import { formatDate } from '../../lib/format';

type Status = 'OPEN' | 'READY_FOR_REVIEW' | 'DONE' | 'REOPENED';

interface Item {
  id: string;
  description: string;
  notes: string | null;
  area: string | null;
  status: Status;
  position: number;
  signedAt: string | null;
  signatureName: string | null;
  reopenedAt: string | null;
  reopenReason: string | null;
  createdAt: string;
  createdBy: { id: string; name: string };
}

const STATUS_BADGE: Record<Status, string> = {
  OPEN: 'badge-draft',
  READY_FOR_REVIEW: 'badge-sent',
  DONE: 'badge-paid',
  REOPENED: 'badge-overdue',
};

const STATUS_LABEL: Record<Status, string> = {
  OPEN: 'open',
  READY_FOR_REVIEW: 'ready for customer',
  DONE: 'signed off',
  REOPENED: 'reopened',
};

export default function PunchListSection({ projectId }: { projectId: string }) {
  const { user } = useAuth();
  const isCustomer = user?.role === 'CUSTOMER';
  const canManage = user?.role === 'ADMIN' || user?.role === 'EMPLOYEE';

  const [items, setItems] = useState<Item[]>([]);
  const [error, setError] = useState<string | null>(null);

  // New-item form
  const [showForm, setShowForm] = useState(false);
  const [description, setDescription] = useState('');
  const [area, setArea] = useState('');
  const [notes, setNotes] = useState('');

  // Customer signature inline state
  const [signingId, setSigningId] = useState<string | null>(null);
  const [signatureName, setSignatureName] = useState('');

  async function load() {
    try {
      const r = await api<{ items: Item[] }>(`/api/projects/${projectId}/punch-list`);
      setItems(r.items);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to load');
    }
  }
  useEffect(() => { load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [projectId]);

  async function add(e: FormEvent) {
    e.preventDefault();
    try {
      await api(`/api/projects/${projectId}/punch-list`, {
        method: 'POST',
        body: JSON.stringify({
          description,
          area: area || null,
          notes: notes || null,
        }),
      });
      setDescription('');
      setArea('');
      setNotes('');
      setShowForm(false);
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Add failed');
    }
  }

  async function setStatus(item: Item, status: Status) {
    try {
      await api(`/api/projects/${projectId}/punch-list/${item.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ status }),
      });
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Update failed');
    }
  }

  async function remove(item: Item) {
    if (!confirm(`Delete "${item.description}"?`)) return;
    try {
      await api(`/api/projects/${projectId}/punch-list/${item.id}`, { method: 'DELETE' });
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Delete failed');
    }
  }

  async function sign(item: Item) {
    if (!signatureName.trim()) {
      setError('Type your full name as signature');
      return;
    }
    try {
      await api(`/api/projects/${projectId}/punch-list/${item.id}/sign`, {
        method: 'POST',
        body: JSON.stringify({ signatureName: signatureName.trim() }),
      });
      setSigningId(null);
      setSignatureName('');
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Sign failed');
    }
  }

  async function reopen(item: Item) {
    const reason = prompt('What needs more work?');
    if (reason === null) return;
    try {
      await api(`/api/projects/${projectId}/punch-list/${item.id}/reopen`, {
        method: 'POST',
        body: JSON.stringify({ reason: reason || null }),
      });
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Reopen failed');
    }
  }

  // Group by area for natural walk-through reading.
  const grouped = new Map<string, Item[]>();
  for (const it of items) {
    const k = it.area ?? 'General';
    const arr = grouped.get(k) ?? [];
    arr.push(it);
    grouped.set(k, arr);
  }

  const counts = items.reduce(
    (acc, it) => {
      acc[it.status] += 1;
      return acc;
    },
    { OPEN: 0, READY_FOR_REVIEW: 0, DONE: 0, REOPENED: 0 } as Record<Status, number>,
  );

  return (
    <section className="card">
      <div className="row-between">
        <div>
          <h2>Punch list</h2>
          <p className="muted" style={{ marginBottom: '0.5rem', fontSize: '0.9rem' }}>
            {isCustomer
              ? 'Walk through each item. Sign off when you\'re happy, or reopen with a note if something needs more work.'
              : 'Walk-through items. Mark items ready for review when finished, then the customer can sign off (with their typed name + IP captured).'}
          </p>
        </div>
        {canManage && (
          <button onClick={() => setShowForm((v) => !v)}>
            {showForm ? 'Cancel' : '+ Add item'}
          </button>
        )}
      </div>

      {error && <div className="form-error">{error}</div>}

      {items.length > 0 && (
        <div className="invoice-stats" style={{ marginBottom: '1rem' }}>
          <div><div className="stat-label">Open</div><div className="stat-value">{counts.OPEN}</div></div>
          <div><div className="stat-label">Awaiting customer</div><div className="stat-value">{counts.READY_FOR_REVIEW}</div></div>
          <div><div className="stat-label">Reopened</div><div className="stat-value" style={{ color: counts.REOPENED > 0 ? 'var(--accent)' : undefined }}>{counts.REOPENED}</div></div>
          <div><div className="stat-label">Signed off</div><div className="stat-value">{counts.DONE}</div></div>
        </div>
      )}

      {canManage && showForm && (
        <form onSubmit={add} style={{ marginBottom: '1rem' }}>
          <div className="form-row">
            <div style={{ flex: 2 }}>
              <label>Description</label>
              <input value={description} onChange={(e) => setDescription(e.target.value)} required placeholder="Touch-up paint behind kitchen door" />
            </div>
            <div>
              <label>Area</label>
              <input value={area} onChange={(e) => setArea(e.target.value)} placeholder="Kitchen, Master bath, …" />
            </div>
          </div>
          <label>Notes</label>
          <input value={notes} onChange={(e) => setNotes(e.target.value)} />
          <button type="submit">Add to punch list</button>
        </form>
      )}

      {items.length === 0 ? (
        <p className="muted">No punch-list items yet.</p>
      ) : (
        [...grouped.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([area, list]) => (
          <div key={area} style={{ marginBottom: '1rem' }}>
            <h3 style={{ margin: '0.5rem 0' }}>{area}</h3>
            <table className="table">
              <thead>
                <tr>
                  <th>Item</th>
                  <th>Status</th>
                  <th>Signoff</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {list.map((it) => (
                  <tr key={it.id}>
                    <td>
                      <strong>{it.description}</strong>
                      {it.notes && <div className="muted" style={{ fontSize: '0.85rem' }}>{it.notes}</div>}
                      {it.reopenReason && (
                        <div style={{ fontSize: '0.85rem', color: 'var(--accent)' }}>
                          Reopened: {it.reopenReason}
                        </div>
                      )}
                    </td>
                    <td>
                      <span className={`badge ${STATUS_BADGE[it.status]}`}>{STATUS_LABEL[it.status]}</span>
                    </td>
                    <td className="muted" style={{ fontSize: '0.85rem' }}>
                      {it.signedAt
                        ? <>Signed {formatDate(it.signedAt)}<br />by {it.signatureName}</>
                        : it.reopenedAt
                          ? <>Reopened {formatDate(it.reopenedAt)}</>
                          : '—'}
                    </td>
                    <td>
                      {canManage && (it.status === 'OPEN' || it.status === 'REOPENED') && (
                        <button type="button" className="button-small" onClick={() => setStatus(it, 'READY_FOR_REVIEW')}>
                          Ready for review
                        </button>
                      )}
                      {canManage && it.status === 'READY_FOR_REVIEW' && (
                        <button type="button" className="button-ghost button-small" onClick={() => setStatus(it, 'OPEN')}>
                          Back to open
                        </button>
                      )}
                      {canManage && (
                        <button type="button" className="button-ghost button-small" style={{ marginLeft: '0.4rem' }} onClick={() => remove(it)}>
                          Delete
                        </button>
                      )}
                      {isCustomer && (it.status === 'READY_FOR_REVIEW' || it.status === 'REOPENED') && (
                        signingId === it.id ? (
                          <div style={{ display: 'flex', gap: '0.4rem', alignItems: 'center', flexWrap: 'wrap' }}>
                            <input
                              value={signatureName}
                              onChange={(e) => setSignatureName(e.target.value)}
                              placeholder="Your full name"
                              style={{ width: 180 }}
                            />
                            <button type="button" className="button-small" onClick={() => sign(it)}>Sign</button>
                            <button type="button" className="button-ghost button-small" onClick={() => { setSigningId(null); setSignatureName(''); }}>Cancel</button>
                          </div>
                        ) : (
                          <>
                            <button type="button" className="button-small" onClick={() => setSigningId(it.id)}>
                              Sign off
                            </button>
                            <button type="button" className="button-ghost button-small" style={{ marginLeft: '0.4rem' }} onClick={() => reopen(it)}>
                              Reopen
                            </button>
                          </>
                        )
                      )}
                      {isCustomer && it.status === 'DONE' && (
                        <button type="button" className="button-ghost button-small" onClick={() => reopen(it)}>
                          Reopen
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ))
      )}
    </section>
  );
}
