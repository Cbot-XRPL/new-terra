import { type FormEvent, useEffect, useState } from 'react';
import { ApiError, api } from '../../lib/api';
import { useAuth } from '../../auth/AuthContext';
import { formatDate } from '../../lib/format';

type SelectionStatus = 'PENDING' | 'APPROVED' | 'CHANGE_REQUESTED';

interface Selection {
  id: string;
  category: string;
  option: string;
  notes: string | null;
  status: SelectionStatus;
  decidedAt: string | null;
  createdAt: string;
}

export default function SelectionsSection({ projectId }: { projectId: string }) {
  const { user } = useAuth();
  const isStaff = user?.role === 'ADMIN' || user?.role === 'EMPLOYEE';
  const isCustomer = user?.role === 'CUSTOMER';

  const [selections, setSelections] = useState<Selection[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);

  const [category, setCategory] = useState('');
  const [option, setOption] = useState('');
  const [notes, setNotes] = useState('');
  const [submitting, setSubmitting] = useState(false);

  async function load() {
    try {
      const { selections } = await api<{ selections: Selection[] }>(
        `/api/projects/${projectId}/selections`,
      );
      setSelections(selections);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to load selections');
    }
  }

  useEffect(() => { load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [projectId]);

  async function create(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      await api(`/api/projects/${projectId}/selections`, {
        method: 'POST',
        body: JSON.stringify({ category, option, notes: notes || undefined }),
      });
      setCategory('');
      setOption('');
      setNotes('');
      setShowForm(false);
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to create selection');
    } finally {
      setSubmitting(false);
    }
  }

  async function decide(id: string, status: 'APPROVED' | 'CHANGE_REQUESTED') {
    try {
      await api(`/api/projects/${projectId}/selections/${id}`, {
        method: 'PATCH',
        body: JSON.stringify({ status }),
      });
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Update failed');
    }
  }

  async function remove(id: string) {
    if (!confirm('Delete this selection?')) return;
    try {
      await api(`/api/projects/${projectId}/selections/${id}`, { method: 'DELETE' });
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Delete failed');
    }
  }

  return (
    <section className="card">
      <div className="row-between">
        <h2>Selections</h2>
        {isStaff && (
          <button onClick={() => setShowForm((v) => !v)}>
            {showForm ? 'Cancel' : 'New selection'}
          </button>
        )}
      </div>

      {error && <div className="form-error">{error}</div>}

      {isStaff && showForm && (
        <form onSubmit={create}>
          <div className="form-row">
            <div>
              <label htmlFor="sel-cat">Category</label>
              <input
                id="sel-cat"
                value={category}
                onChange={(e) => setCategory(e.target.value)}
                required
                placeholder="e.g. Cabinet finish"
              />
            </div>
            <div>
              <label htmlFor="sel-opt">Option</label>
              <input
                id="sel-opt"
                value={option}
                onChange={(e) => setOption(e.target.value)}
                required
                placeholder="e.g. Shaker white maple"
              />
            </div>
          </div>
          <label htmlFor="sel-notes">Notes</label>
          <textarea
            id="sel-notes"
            rows={2}
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
          />
          <button type="submit" disabled={submitting}>
            {submitting ? 'Adding…' : 'Add selection'}
          </button>
        </form>
      )}

      {selections.length ? (
        <ul className="list">
          {selections.map((s) => (
            <li key={s.id}>
              <div className="row-between">
                <div>
                  <strong>{s.category}:</strong> {s.option}
                  <div className="muted">
                    <span className={`badge badge-${s.status.toLowerCase().replace('_', '-')}`}>
                      {s.status.replace('_', ' ').toLowerCase()}
                    </span>
                    {s.decidedAt && ` · decided ${formatDate(s.decidedAt)}`}
                  </div>
                  {s.notes && <p>{s.notes}</p>}
                </div>
                <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
                  {isCustomer && s.status === 'PENDING' && (
                    <>
                      <button className="button-small" onClick={() => decide(s.id, 'APPROVED')}>
                        Approve
                      </button>
                      <button
                        className="button-small button-ghost"
                        onClick={() => decide(s.id, 'CHANGE_REQUESTED')}
                      >
                        Request change
                      </button>
                    </>
                  )}
                  {isStaff && (
                    <button
                      type="button"
                      className="button button-ghost button-small"
                      onClick={() => remove(s.id)}
                    >
                      Delete
                    </button>
                  )}
                </div>
              </div>
            </li>
          ))}
        </ul>
      ) : (
        <p className="muted">No selections yet.</p>
      )}
    </section>
  );
}
