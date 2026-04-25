import { useEffect, useState } from 'react';
import { api } from '../../lib/api';
import { useAuth } from '../../auth/AuthContext';

interface Project { id: string; name: string; address?: string | null; }
interface Invoice { id: string; number: string; amountCents: number; status: string; issuedAt: string; dueAt?: string | null; }
interface Selection { id: string; category: string; option: string; status: string; }
interface Membership { tier: string; active: boolean; renewsAt?: string | null; }

interface Overview {
  projects: Project[];
  invoices: Invoice[];
  selections: Selection[];
  membership: Membership | null;
}

function formatCents(cents: number) {
  return (cents / 100).toLocaleString('en-US', { style: 'currency', currency: 'USD' });
}

export default function CustomerDashboard() {
  const { user } = useAuth();
  const [data, setData] = useState<Overview | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api<Overview>('/api/portal/customer/overview')
      .then(setData)
      .catch((err) => setError(err.message));
  }, []);

  return (
    <div className="dashboard">
      <header>
        <h1>Welcome, {user?.name.split(' ')[0]}</h1>
        <p className="muted">Your projects, invoices, selections, and membership.</p>
      </header>

      {error && <div className="form-error">{error}</div>}

      <section className="card">
        <h2>Membership</h2>
        {data?.membership ? (
          <p>
            <strong>{data.membership.tier}</strong>{' '}
            {data.membership.active ? '· active' : '· inactive'}
            {data.membership.renewsAt && ` · renews ${new Date(data.membership.renewsAt).toLocaleDateString()}`}
          </p>
        ) : (
          <div>
            <p className="muted">You're not on a membership yet.</p>
            <h3>Why join?</h3>
            <ul>
              <li>Priority scheduling for repairs and service calls</li>
              <li>Annual home + property inspection</li>
              <li>Members-only pricing on remodels and add-ons</li>
            </ul>
            <a className="button" href="mailto:sales@newterraconstruction.com?subject=Membership%20Inquiry">
              Talk to us about memberships
            </a>
          </div>
        )}
      </section>

      <section className="card">
        <h2>Projects</h2>
        {data?.projects.length ? (
          <ul className="list">
            {data.projects.map((p) => (
              <li key={p.id}>
                <strong>{p.name}</strong>
                {p.address && <div className="muted">{p.address}</div>}
              </li>
            ))}
          </ul>
        ) : (
          <p className="muted">No active projects yet.</p>
        )}
      </section>

      <section className="card">
        <h2>Invoices</h2>
        {data?.invoices.length ? (
          <table className="table">
            <thead>
              <tr><th>#</th><th>Issued</th><th>Amount</th><th>Status</th></tr>
            </thead>
            <tbody>
              {data.invoices.map((inv) => (
                <tr key={inv.id}>
                  <td>{inv.number}</td>
                  <td>{new Date(inv.issuedAt).toLocaleDateString()}</td>
                  <td>{formatCents(inv.amountCents)}</td>
                  <td>{inv.status}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <p className="muted">No invoices yet.</p>
        )}
      </section>

      <section className="card">
        <h2>Selections</h2>
        {data?.selections.length ? (
          <ul className="list">
            {data.selections.map((s) => (
              <li key={s.id}>
                <strong>{s.category}:</strong> {s.option}{' '}
                <span className="muted">— {s.status.toLowerCase()}</span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="muted">No selections pending.</p>
        )}
      </section>
    </div>
  );
}
