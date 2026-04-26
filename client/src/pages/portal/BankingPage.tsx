import { type FormEvent, useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { ApiError, api } from '../../lib/api';
import { formatCents, formatDate } from '../../lib/format';

type AccountKind = 'CHECKING' | 'SAVINGS' | 'CASH' | 'CREDIT_CARD' | 'LINE_OF_CREDIT' | 'LOAN' | 'OTHER';

interface BankAccount {
  id: string;
  name: string;
  kind: AccountKind;
  last4: string | null;
  institutionName: string | null;
  currentBalanceCents: number;
  isLiability: boolean;
  active: boolean;
  notes: string | null;
  _count: { transactions: number };
}

interface BankTransaction {
  id: string;
  date: string;
  amountCents: number;
  description: string;
  runningBalanceCents: number | null;
  reconciled: boolean;
  notes: string | null;
  account: { id: string; name: string; kind: AccountKind };
  category: { id: string; name: string } | null;
  matchedPayment: { id: string; invoiceId: string; amountCents: number } | null;
  matchedExpense: { id: string; description: string | null; amountCents: number } | null;
  matchedSubBill: { id: string; number: string; amountCents: number } | null;
}

interface Category { id: string; name: string }

const KIND_LABEL: Record<AccountKind, string> = {
  CHECKING: 'Checking',
  SAVINGS: 'Savings',
  CASH: 'Cash',
  CREDIT_CARD: 'Credit card',
  LINE_OF_CREDIT: 'Line of credit',
  LOAN: 'Loan',
  OTHER: 'Other',
};

const LIABILITY_KINDS = new Set<AccountKind>(['CREDIT_CARD', 'LINE_OF_CREDIT', 'LOAN']);

function isLiability(a: BankAccount): boolean {
  return a.isLiability || LIABILITY_KINDS.has(a.kind);
}

export default function BankingPage() {
  const [accounts, setAccounts] = useState<BankAccount[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [active, setActive] = useState<string | null>(null);
  const [transactions, setTransactions] = useState<BankTransaction[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);

  // Filters
  const [filterUncat, setFilterUncat] = useState(false);
  const [filterUnreconciled, setFilterUnreconciled] = useState(false);
  const [search, setSearch] = useState('');

  // New-account form
  const [showNewAccount, setShowNewAccount] = useState(false);
  const [aName, setAName] = useState('');
  const [aKind, setAKind] = useState<AccountKind>('CHECKING');
  const [aLast4, setALast4] = useState('');
  const [aInstitution, setAInstitution] = useState('');
  const [aBalance, setABalance] = useState('');

  // New-tx form
  const [showNewTx, setShowNewTx] = useState(false);
  const [tDate, setTDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [tDescription, setTDescription] = useState('');
  const [tAmount, setTAmount] = useState('');
  const [tDirection, setTDirection] = useState<'in' | 'out'>('out');
  const [tCategoryId, setTCategoryId] = useState('');

  const fileInputRef = useRef<HTMLInputElement>(null);
  const [importing, setImporting] = useState(false);

  async function loadAccounts() {
    try {
      const [a, c] = await Promise.all([
        api<{ accounts: BankAccount[] }>('/api/banking/accounts'),
        api<{ categories: Category[] }>('/api/finance/categories').catch(() => ({ categories: [] })),
      ]);
      setAccounts(a.accounts);
      setCategories(c.categories);
      if (!active && a.accounts.length > 0) setActive(a.accounts[0].id);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to load accounts');
    }
  }

  async function loadTransactions(accountId: string) {
    try {
      const params = new URLSearchParams({ accountId });
      if (filterUncat) params.set('uncategorized', 'true');
      if (filterUnreconciled) params.set('unreconciled', 'true');
      if (search) params.set('q', search);
      const r = await api<{ transactions: BankTransaction[] }>(
        `/api/banking/transactions?${params.toString()}`,
      );
      setTransactions(r.transactions);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to load transactions');
    }
  }

  useEffect(() => { loadAccounts(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, []);
  useEffect(() => {
    if (active) loadTransactions(active);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, filterUncat, filterUnreconciled, search]);

  async function createAccount(e: FormEvent) {
    e.preventDefault();
    setError(null);
    try {
      await api('/api/banking/accounts', {
        method: 'POST',
        body: JSON.stringify({
          name: aName,
          kind: aKind,
          last4: aLast4 || null,
          institutionName: aInstitution || null,
          currentBalanceCents: aBalance ? Math.round(Number(aBalance) * 100) : 0,
        }),
      });
      setAName(''); setALast4(''); setAInstitution(''); setABalance('');
      setShowNewAccount(false);
      await loadAccounts();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not create account');
    }
  }

  async function createTransaction(e: FormEvent) {
    e.preventDefault();
    setError(null);
    if (!active) return;
    const cents = Math.round(Number(tAmount) * 100);
    if (!Number.isFinite(cents) || cents <= 0) {
      setError('Enter a valid amount');
      return;
    }
    const signed = tDirection === 'in' ? cents : -cents;
    try {
      await api('/api/banking/transactions', {
        method: 'POST',
        body: JSON.stringify({
          accountId: active,
          date: new Date(tDate).toISOString(),
          description: tDescription,
          amountCents: signed,
          categoryId: tCategoryId || null,
        }),
      });
      setTDescription(''); setTAmount(''); setTCategoryId('');
      setShowNewTx(false);
      await loadTransactions(active);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not add');
    }
  }

  async function importCsv() {
    if (!active || !fileInputRef.current?.files?.[0]) return;
    setImporting(true);
    setError(null); setInfo(null);
    try {
      const apiBase = import.meta.env.VITE_API_URL ?? '';
      const token = localStorage.getItem('nt_token');
      const form = new FormData();
      form.append('file', fileInputRef.current.files[0]);
      const res = await fetch(`${apiBase}/api/banking/accounts/${active}/import`, {
        method: 'POST',
        headers: token ? { Authorization: `Bearer ${token}` } : {},
        body: form,
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) {
        setError(data?.error ?? 'Import failed');
        return;
      }
      setInfo(`Imported ${data.created} new transaction${data.created === 1 ? '' : 's'} (${data.categorized} auto-categorized; ${data.skipped} duplicates skipped).`);
      if (fileInputRef.current) fileInputRef.current.value = '';
      await loadTransactions(active);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Import failed');
    } finally {
      setImporting(false);
    }
  }

  async function applyRules() {
    try {
      const r = await api<{ updated: number; considered: number }>(
        '/api/banking/rules/_apply',
        { method: 'POST' },
      );
      setInfo(`Applied rules: ${r.updated} of ${r.considered} uncategorized transactions classified.`);
      if (active) await loadTransactions(active);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Apply failed');
    }
  }

  async function patchTransaction(tx: BankTransaction, patch: Record<string, unknown>) {
    try {
      await api(`/api/banking/transactions/${tx.id}`, {
        method: 'PATCH',
        body: JSON.stringify(patch),
      });
      if (active) await loadTransactions(active);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Update failed');
    }
  }

  async function deleteTransaction(tx: BankTransaction) {
    if (!confirm('Delete this transaction?')) return;
    try {
      await api(`/api/banking/transactions/${tx.id}`, { method: 'DELETE' });
      if (active) await loadTransactions(active);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Delete failed');
    }
  }

  async function patchAccountBalance(account: BankAccount) {
    const raw = prompt(`Set current balance for ${account.name}:`, (account.currentBalanceCents / 100).toFixed(2));
    if (raw == null) return;
    const cents = Math.round(Number(raw) * 100);
    if (!Number.isFinite(cents)) { setError('Invalid amount'); return; }
    try {
      await api(`/api/banking/accounts/${account.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ currentBalanceCents: cents }),
      });
      await loadAccounts();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Update failed');
    }
  }

  const activeAccount = accounts.find((a) => a.id === active) ?? null;

  // Aggregate balances for the sidebar header.
  const assetTotal = accounts
    .filter((a) => a.active && !isLiability(a))
    .reduce((s, a) => s + a.currentBalanceCents, 0);
  const liabilityTotal = accounts
    .filter((a) => a.active && isLiability(a))
    .reduce((s, a) => s + a.currentBalanceCents, 0);

  return (
    <div className="dashboard">
      <header className="row-between">
        <div>
          <h1>Banking</h1>
          <p className="muted">
            Bank, credit-card, and cash accounts. Import CSV statements or add transactions manually.
            {' '}<Link to="/portal/finance">← back to finance</Link>
            {' · '}<Link to="/portal/banking/rules">Categorization rules</Link>
            {' · '}<Link to="/portal/banking/assets">Other assets &amp; liabilities</Link>
          </p>
        </div>
      </header>

      {error && <div className="form-error">{error}</div>}
      {info && <div className="form-success">{info}</div>}

      <section className="card">
        <div className="row-between">
          <h2>Accounts</h2>
          <button onClick={() => setShowNewAccount((v) => !v)}>
            {showNewAccount ? 'Cancel' : '+ Add account'}
          </button>
        </div>

        {showNewAccount && (
          <form onSubmit={createAccount} style={{ marginBottom: '1rem' }}>
            <div className="form-row">
              <div>
                <label>Name</label>
                <input value={aName} onChange={(e) => setAName(e.target.value)} required placeholder="Chase Checking" />
              </div>
              <div>
                <label>Kind</label>
                <select value={aKind} onChange={(e) => setAKind(e.target.value as AccountKind)}>
                  {(Object.keys(KIND_LABEL) as AccountKind[]).map((k) => (
                    <option key={k} value={k}>{KIND_LABEL[k]}</option>
                  ))}
                </select>
              </div>
              <div>
                <label>Institution</label>
                <input value={aInstitution} onChange={(e) => setAInstitution(e.target.value)} />
              </div>
              <div>
                <label>Last 4</label>
                <input value={aLast4} onChange={(e) => setALast4(e.target.value)} maxLength={8} />
              </div>
              <div>
                <label>Current balance (USD)</label>
                <input type="number" step="0.01" value={aBalance} onChange={(e) => setABalance(e.target.value)} />
              </div>
            </div>
            <button type="submit">Create</button>
          </form>
        )}

        <div className="invoice-stats">
          <div>
            <div className="stat-label">Cash + bank assets</div>
            <div className="stat-value">{formatCents(assetTotal)}</div>
          </div>
          <div>
            <div className="stat-label">Card / loan liabilities</div>
            <div className="stat-value" style={{ color: 'var(--accent)' }}>{formatCents(liabilityTotal)}</div>
          </div>
          <div>
            <div className="stat-label">Net</div>
            <div className="stat-value">{formatCents(assetTotal - liabilityTotal)}</div>
          </div>
        </div>

        <table className="table">
          <thead>
            <tr>
              <th>Account</th>
              <th>Kind</th>
              <th>Institution</th>
              <th style={{ textAlign: 'right' }}>Balance</th>
              <th>Txns</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {accounts.map((a) => (
              <tr key={a.id} style={{ opacity: a.active ? 1 : 0.55, background: a.id === active ? 'var(--surface)' : undefined }}>
                <td>
                  <button
                    type="button"
                    className="button-ghost button-small"
                    onClick={() => setActive(a.id)}
                  >
                    <strong>{a.name}</strong>
                    {a.last4 && <span className="muted"> ··{a.last4}</span>}
                  </button>
                </td>
                <td>
                  {KIND_LABEL[a.kind]}
                  {isLiability(a) && <span className="muted"> · liability</span>}
                </td>
                <td>{a.institutionName ?? <span className="muted">—</span>}</td>
                <td
                  style={{ textAlign: 'right', cursor: 'pointer', color: isLiability(a) ? 'var(--accent)' : undefined }}
                  onClick={() => patchAccountBalance(a)}
                  title="Click to update the current balance"
                >
                  {formatCents(a.currentBalanceCents)}
                </td>
                <td className="muted">{a._count.transactions}</td>
                <td>
                  <button
                    type="button"
                    className="button-ghost button-small"
                    onClick={() => setActive(a.id)}
                  >
                    Open
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {accounts.length === 0 && <p className="muted">No accounts yet. Add one above.</p>}
      </section>

      {activeAccount && (
        <section className="card">
          <div className="row-between">
            <div>
              <h2>{activeAccount.name}</h2>
              <p className="muted" style={{ fontSize: '0.85rem' }}>
                {KIND_LABEL[activeAccount.kind]} · balance {formatCents(activeAccount.currentBalanceCents)}
              </p>
            </div>
            <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
              <button type="button" className="button-ghost" onClick={() => setShowNewTx((v) => !v)}>
                {showNewTx ? 'Cancel' : '+ Add transaction'}
              </button>
              <button type="button" className="button-ghost" onClick={applyRules} title="Re-run categorization rules across uncategorized transactions">
                Apply rules
              </button>
            </div>
          </div>

          <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'flex-end', marginTop: '0.75rem', flexWrap: 'wrap' }}>
            <div>
              <label>Import CSV</label>
              <input ref={fileInputRef} type="file" accept=".csv,text/csv" />
            </div>
            <button type="button" onClick={importCsv} disabled={importing}>
              {importing ? 'Importing…' : 'Import'}
            </button>
            <span className="muted" style={{ fontSize: '0.85rem' }}>
              Most US bank exports work — Chase, BofA, Capital One. Re-imports are deduped.
            </span>
          </div>

          {showNewTx && (
            <form onSubmit={createTransaction} style={{ marginTop: '0.75rem' }}>
              <div className="form-row">
                <div>
                  <label>Date</label>
                  <input type="date" value={tDate} onChange={(e) => setTDate(e.target.value)} required />
                </div>
                <div>
                  <label>Description</label>
                  <input value={tDescription} onChange={(e) => setTDescription(e.target.value)} required />
                </div>
                <div>
                  <label>Direction</label>
                  <select value={tDirection} onChange={(e) => setTDirection(e.target.value as 'in' | 'out')}>
                    <option value="out">Out (expense)</option>
                    <option value="in">In (deposit)</option>
                  </select>
                </div>
                <div>
                  <label>Amount (USD)</label>
                  <input type="number" step="0.01" min="0" value={tAmount} onChange={(e) => setTAmount(e.target.value)} required />
                </div>
                <div>
                  <label>Category</label>
                  <select value={tCategoryId} onChange={(e) => setTCategoryId(e.target.value)}>
                    <option value="">—</option>
                    {categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                  </select>
                </div>
              </div>
              <button type="submit">Add transaction</button>
            </form>
          )}

          <div style={{ display: 'flex', gap: '0.75rem', alignItems: 'center', marginTop: '1rem', flexWrap: 'wrap' }}>
            <label style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', fontSize: '0.85rem' }}>
              <input
                type="checkbox"
                checked={filterUncat}
                onChange={(e) => setFilterUncat(e.target.checked)}
                style={{ width: 'auto' }}
              />
              Uncategorized only
            </label>
            <label style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', fontSize: '0.85rem' }}>
              <input
                type="checkbox"
                checked={filterUnreconciled}
                onChange={(e) => setFilterUnreconciled(e.target.checked)}
                style={{ width: 'auto' }}
              />
              Unreconciled only
            </label>
            <input
              placeholder="Search description…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              style={{ width: 240 }}
            />
          </div>

          {transactions.length ? (
            <table className="table" style={{ marginTop: '0.5rem' }}>
              <thead>
                <tr>
                  <th>Date</th>
                  <th>Description</th>
                  <th>Category</th>
                  <th>Match</th>
                  <th style={{ textAlign: 'right' }}>Amount</th>
                  <th>Recon</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {transactions.map((t) => (
                  <tr key={t.id}>
                    <td>{formatDate(t.date)}</td>
                    <td style={{ maxWidth: 300 }}>{t.description}</td>
                    <td>
                      <select
                        value={t.category?.id ?? ''}
                        onChange={(e) => patchTransaction(t, { categoryId: e.target.value || null })}
                      >
                        <option value="">—</option>
                        {categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                      </select>
                    </td>
                    <td className="muted" style={{ fontSize: '0.85rem' }}>
                      {t.matchedPayment && <>Payment {formatCents(t.matchedPayment.amountCents)}</>}
                      {t.matchedExpense && <>Expense {formatCents(t.matchedExpense.amountCents)}</>}
                      {t.matchedSubBill && <>Sub bill {t.matchedSubBill.number}</>}
                      {!t.matchedPayment && !t.matchedExpense && !t.matchedSubBill && '—'}
                    </td>
                    <td
                      style={{
                        textAlign: 'right',
                        color: t.amountCents > 0 ? 'var(--paid, #0f9d58)' : t.amountCents < 0 ? 'var(--accent)' : undefined,
                      }}
                    >
                      {formatCents(t.amountCents)}
                    </td>
                    <td>
                      <input
                        type="checkbox"
                        checked={t.reconciled}
                        onChange={(e) => patchTransaction(t, { reconciled: e.target.checked })}
                        style={{ width: 'auto' }}
                      />
                    </td>
                    <td>
                      <button
                        type="button"
                        className="button-ghost button-small"
                        onClick={() => deleteTransaction(t)}
                      >
                        Delete
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <p className="muted" style={{ marginTop: '1rem' }}>No transactions{filterUncat || filterUnreconciled || search ? ' match the filters' : ' yet — import a CSV or add one manually'}.</p>
          )}
        </section>
      )}
    </div>
  );
}
