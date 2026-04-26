import { type FormEvent, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { ApiError, api } from '../../lib/api';

interface Rule {
  id: string;
  matchText: string;
  active: boolean;
  account: { id: string; name: string } | null;
  category: { id: string; name: string };
  vendor: { id: string; name: string } | null;
  project: { id: string; name: string } | null;
}

interface Account { id: string; name: string }
interface Category { id: string; name: string }

export default function BankRulesPage() {
  const [rules, setRules] = useState<Rule[]>([]);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);

  const [matchText, setMatchText] = useState('');
  const [accountId, setAccountId] = useState('');
  const [categoryId, setCategoryId] = useState('');

  async function load() {
    try {
      const [r, a, c] = await Promise.all([
        api<{ rules: Rule[] }>('/api/banking/rules'),
        api<{ accounts: Account[] }>('/api/banking/accounts'),
        api<{ categories: Category[] }>('/api/finance/categories'),
      ]);
      setRules(r.rules);
      setAccounts(a.accounts);
      setCategories(c.categories);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to load');
    }
  }
  useEffect(() => { load(); }, []);

  async function create(e: FormEvent) {
    e.preventDefault();
    setError(null);
    if (!matchText.trim() || !categoryId) {
      setError('Match text and category are required');
      return;
    }
    try {
      await api('/api/banking/rules', {
        method: 'POST',
        body: JSON.stringify({
          matchText: matchText.trim(),
          accountId: accountId || null,
          categoryId,
        }),
      });
      setMatchText('');
      setAccountId('');
      setCategoryId('');
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Create failed');
    }
  }

  async function toggle(rule: Rule) {
    try {
      await api(`/api/banking/rules/${rule.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ active: !rule.active }),
      });
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Update failed');
    }
  }

  async function remove(rule: Rule) {
    if (!confirm(`Delete rule "${rule.matchText}"?`)) return;
    try {
      await api(`/api/banking/rules/${rule.id}`, { method: 'DELETE' });
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Delete failed');
    }
  }

  async function applyAll() {
    try {
      const r = await api<{ updated: number; considered: number }>(
        '/api/banking/rules/_apply',
        { method: 'POST' },
      );
      setInfo(`Classified ${r.updated} of ${r.considered} uncategorized transactions.`);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Apply failed');
    }
  }

  return (
    <div className="dashboard">
      <header>
        <h1>Categorization rules</h1>
        <p className="muted">
          Substring match on transaction descriptions (case-insensitive). Rules are applied automatically
          on CSV import; click 'Apply to existing' to backfill on already-imported transactions.
          {' '}<Link to="/portal/banking">← back to banking</Link>
        </p>
      </header>

      {error && <div className="form-error">{error}</div>}
      {info && <div className="form-success">{info}</div>}

      <section className="card">
        <h2>New rule</h2>
        <form onSubmit={create}>
          <div className="form-row">
            <div>
              <label>Match text (case-insensitive)</label>
              <input
                value={matchText}
                onChange={(e) => setMatchText(e.target.value)}
                placeholder="HOME DEPOT"
                required
              />
            </div>
            <div>
              <label>Category</label>
              <select value={categoryId} onChange={(e) => setCategoryId(e.target.value)} required>
                <option value="">— pick a category —</option>
                {categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            </div>
            <div>
              <label>Account scope</label>
              <select value={accountId} onChange={(e) => setAccountId(e.target.value)}>
                <option value="">All accounts</option>
                {accounts.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
              </select>
            </div>
          </div>
          <div className="form-actions">
            <button type="submit">Create rule</button>
            <button type="button" className="button-ghost" onClick={applyAll}>
              Apply to existing transactions
            </button>
          </div>
        </form>
      </section>

      <section className="card">
        <h2>Rules</h2>
        {rules.length ? (
          <table className="table">
            <thead>
              <tr>
                <th>Match</th>
                <th>Category</th>
                <th>Account</th>
                <th>Status</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {rules.map((r) => (
                <tr key={r.id} style={{ opacity: r.active ? 1 : 0.55 }}>
                  <td><code>{r.matchText}</code></td>
                  <td>{r.category.name}</td>
                  <td>{r.account?.name ?? <span className="muted">all</span>}</td>
                  <td>{r.active ? 'active' : 'paused'}</td>
                  <td>
                    <button type="button" className="button-ghost button-small" onClick={() => toggle(r)}>
                      {r.active ? 'Pause' : 'Resume'}
                    </button>
                    <button
                      type="button"
                      className="button-ghost button-small"
                      style={{ marginLeft: '0.4rem' }}
                      onClick={() => remove(r)}
                    >
                      Delete
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <p className="muted">No rules yet. Add one above.</p>
        )}
      </section>
    </div>
  );
}
