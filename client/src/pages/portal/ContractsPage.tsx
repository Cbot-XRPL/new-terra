import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { ApiError, api } from '../../lib/api';
import { useAuth } from '../../auth/AuthContext';
import { formatDate } from '../../lib/format';

type ContractStatus = 'DRAFT' | 'SENT' | 'VIEWED' | 'SIGNED' | 'DECLINED' | 'VOID';

interface ContractRow {
  id: string;
  templateNameSnapshot: string;
  status: ContractStatus;
  sentAt: string | null;
  signedAt: string | null;
  createdAt: string;
  customer?: { id: string; name: string };
  createdBy?: { id: string; name: string };
}

const STATUS_BADGE: Record<ContractStatus, string> = {
  DRAFT: 'badge-draft',
  SENT: 'badge-sent',
  VIEWED: 'badge-sent',
  SIGNED: 'badge-paid',
  DECLINED: 'badge-overdue',
  VOID: 'badge-void',
};

export default function ContractsPage() {
  const { user } = useAuth();
  const isStaffAccess =
    user?.role === 'ADMIN' || (user?.role === 'EMPLOYEE' && user.isSales);

  const [contracts, setContracts] = useState<ContractRow[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<'ALL' | ContractStatus>('ALL');

  useEffect(() => {
    api<{ contracts: ContractRow[] }>('/api/contracts')
      .then((d) => setContracts(d.contracts))
      .catch((err) => setError(err instanceof ApiError ? err.message : 'Failed to load'));
  }, []);

  const visible = filter === 'ALL' ? contracts : contracts.filter((c) => c.status === filter);

  return (
    <div className="dashboard">
      <header className="row-between">
        <div>
          <h1>Contracts</h1>
          <p className="muted">
            {user?.role === 'CUSTOMER'
              ? 'Contracts sent to you for review and signature.'
              : user?.role === 'ADMIN'
                ? 'All contracts across every sales rep.'
                : 'Your active and historical contracts.'}
          </p>
        </div>
        <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
          <select
            value={filter}
            onChange={(e) => setFilter(e.target.value as 'ALL' | ContractStatus)}
            style={{ marginBottom: 0, minWidth: 140 }}
          >
            <option value="ALL">All statuses</option>
            {(['DRAFT', 'SENT', 'VIEWED', 'SIGNED', 'DECLINED', 'VOID'] as ContractStatus[]).map((s) => (
              <option key={s} value={s}>{s.toLowerCase()}</option>
            ))}
          </select>
          {isStaffAccess && (
            <Link to="/portal/contracts/new" className="button">
              New contract
            </Link>
          )}
        </div>
      </header>

      {error && <div className="form-error">{error}</div>}

      <section className="card">
        {visible.length ? (
          <table className="table">
            <thead>
              <tr>
                <th>Template</th>
                {user?.role !== 'CUSTOMER' && <th>Customer</th>}
                {user?.role === 'ADMIN' && <th>Rep</th>}
                <th>Status</th>
                <th>Created</th>
                <th>Sent</th>
                <th>Signed</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {visible.map((c) => (
                <tr key={c.id}>
                  <td>{c.templateNameSnapshot}</td>
                  {user?.role !== 'CUSTOMER' && <td>{c.customer?.name}</td>}
                  {user?.role === 'ADMIN' && <td>{c.createdBy?.name}</td>}
                  <td><span className={`badge ${STATUS_BADGE[c.status]}`}>{c.status.toLowerCase()}</span></td>
                  <td>{formatDate(c.createdAt)}</td>
                  <td>{formatDate(c.sentAt)}</td>
                  <td>{formatDate(c.signedAt)}</td>
                  <td>
                    <Link to={`/portal/contracts/${c.id}`} className="button button-ghost button-small">
                      Open
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <p className="muted">No contracts{filter !== 'ALL' ? ` with status ${filter.toLowerCase()}` : ''}.</p>
        )}
      </section>
    </div>
  );
}
