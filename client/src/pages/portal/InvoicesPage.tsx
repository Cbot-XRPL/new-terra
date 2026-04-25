import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { ApiError, api } from '../../lib/api';
import { useAuth } from '../../auth/AuthContext';
import { formatCents, formatDate } from '../../lib/format';

interface Invoice {
  id: string;
  number: string;
  amountCents: number;
  status: string;
  issuedAt: string;
  dueAt: string | null;
  customer: { id: string; name: string };
  project: { id: string; name: string } | null;
}

export default function InvoicesPage() {
  const { user } = useAuth();
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api<{ invoices: Invoice[] }>('/api/invoices')
      .then((d) => setInvoices(d.invoices))
      .catch((err) => setError(err instanceof ApiError ? err.message : 'Failed to load'));
  }, []);

  const total = invoices.reduce((sum, i) => sum + i.amountCents, 0);
  const outstanding = invoices
    .filter((i) => i.status === 'SENT' || i.status === 'OVERDUE')
    .reduce((sum, i) => sum + i.amountCents, 0);

  return (
    <div className="dashboard">
      <header>
        <h1>Invoices</h1>
        <p className="muted">
          {user?.role === 'CUSTOMER' ? 'Your invoices.' : 'All invoices across projects.'}
        </p>
      </header>

      {error && <div className="form-error">{error}</div>}

      <section className="card">
        <div className="invoice-stats">
          <div>
            <div className="stat-label">Total billed</div>
            <div className="stat-value">{formatCents(total)}</div>
          </div>
          <div>
            <div className="stat-label">Outstanding</div>
            <div className="stat-value">{formatCents(outstanding)}</div>
          </div>
          <div>
            <div className="stat-label">Count</div>
            <div className="stat-value">{invoices.length}</div>
          </div>
        </div>
      </section>

      <section className="card">
        {invoices.length ? (
          <table className="table">
            <thead>
              <tr>
                <th>#</th>
                <th>Issued</th>
                <th>Due</th>
                {user?.role !== 'CUSTOMER' && <th>Customer</th>}
                <th>Project</th>
                <th>Amount</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {invoices.map((inv) => (
                <tr key={inv.id}>
                  <td>{inv.number}</td>
                  <td>{formatDate(inv.issuedAt)}</td>
                  <td>{formatDate(inv.dueAt)}</td>
                  {user?.role !== 'CUSTOMER' && <td>{inv.customer.name}</td>}
                  <td>
                    {inv.project ? (
                      <Link to={`/portal/projects/${inv.project.id}`}>{inv.project.name}</Link>
                    ) : (
                      <span className="muted">—</span>
                    )}
                  </td>
                  <td>{formatCents(inv.amountCents)}</td>
                  <td>
                    <span className={`badge badge-${inv.status.toLowerCase()}`}>
                      {inv.status.toLowerCase()}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <p className="muted">No invoices yet.</p>
        )}
      </section>
    </div>
  );
}
