import { type FormEvent, useState } from 'react';
import { Link } from 'react-router-dom';
import { ApiError, api } from '../../lib/api';
import { indexHeaders, parseCsv } from '../../lib/csv';
import type { Role } from '../../auth/AuthContext';

interface ParsedRow {
  email: string;
  role: Role;
  source: string;
}

interface ResultRow {
  email: string;
  role: Role;
  status: 'invited' | 'exists' | 'invitation_pending' | 'error';
  message?: string;
  inviteUrl?: string;
}

const VALID_ROLES: Role[] = ['ADMIN', 'EMPLOYEE', 'SUBCONTRACTOR', 'CUSTOMER'];

const SAMPLE = `email,role,name
ashley@example.com,CUSTOMER,Ashley Brown
brett@example.com,CUSTOMER,Brett Patel
chris@trades.dev,SUBCONTRACTOR,Chris Lee
`;

export default function BulkImportPage() {
  const [text, setText] = useState('');
  const [parsed, setParsed] = useState<ParsedRow[] | null>(null);
  const [issues, setIssues] = useState<string[]>([]);
  const [defaultRole, setDefaultRole] = useState<Role>('CUSTOMER');
  const [sendEmails, setSendEmails] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [results, setResults] = useState<ResultRow[] | null>(null);
  const [summary, setSummary] = useState<Record<string, number> | null>(null);
  const [error, setError] = useState<string | null>(null);

  function loadSample() {
    setText(SAMPLE);
    setParsed(null);
    setResults(null);
    setIssues([]);
  }

  function preview() {
    setError(null);
    setIssues([]);
    setResults(null);
    setSummary(null);

    if (!text.trim()) {
      setIssues(['No CSV pasted yet']);
      setParsed(null);
      return;
    }

    const rows = parseCsv(text);
    if (rows.length < 1) {
      setIssues(['Empty CSV']);
      setParsed(null);
      return;
    }

    // Heuristic: if the first row has "email" or "e-mail", treat it as a
    // header. Otherwise assume column 0 is email and column 1 (if present)
    // is role.
    const first = rows[0].map((c) => c.trim().toLowerCase());
    const hasHeader = first.some((c) => c === 'email' || c === 'e-mail');
    const headers = hasHeader ? indexHeaders(rows[0]) : null;
    const dataRows = hasHeader ? rows.slice(1) : rows;

    const seen = new Set<string>();
    const out: ParsedRow[] = [];
    const localIssues: string[] = [];

    dataRows.forEach((r, idx) => {
      const lineNum = (hasHeader ? idx + 2 : idx + 1);
      const emailIdx = headers?.email ?? headers?.['e-mail'] ?? 0;
      const roleIdx = headers?.role ?? (hasHeader ? -1 : 1);

      const emailRaw = (r[emailIdx] ?? '').trim().toLowerCase();
      const roleRaw = roleIdx >= 0 ? (r[roleIdx] ?? '').trim().toUpperCase() : '';

      if (!emailRaw) {
        localIssues.push(`Line ${lineNum}: missing email`);
        return;
      }
      // Lightweight check; the server will validate properly.
      if (!emailRaw.includes('@') || emailRaw.includes(' ')) {
        localIssues.push(`Line ${lineNum}: invalid email "${emailRaw}"`);
        return;
      }
      if (seen.has(emailRaw)) {
        localIssues.push(`Line ${lineNum}: duplicate ${emailRaw} (skipped)`);
        return;
      }
      seen.add(emailRaw);

      let role: Role = defaultRole;
      if (roleRaw) {
        if ((VALID_ROLES as string[]).includes(roleRaw)) {
          role = roleRaw as Role;
        } else {
          localIssues.push(`Line ${lineNum}: unknown role "${roleRaw}", using ${defaultRole}`);
        }
      }
      out.push({ email: emailRaw, role, source: r.join(',') });
    });

    setIssues(localIssues);
    setParsed(out);
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!parsed || parsed.length === 0) return;
    setSubmitting(true);
    setError(null);
    try {
      const res = await api<{ summary: Record<string, number>; results: ResultRow[] }>(
        '/api/admin/bulk/invitations',
        {
          method: 'POST',
          body: JSON.stringify({
            rows: parsed.map((p) => ({ email: p.email, role: p.role })),
            sendEmails,
          }),
        },
      );
      setResults(res.results);
      setSummary(res.summary);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Import failed');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="dashboard">
      <header>
        <Link to="/portal/admin" className="muted">← Admin</Link>
        <h1>Bulk import</h1>
        <p className="muted">
          Paste a CSV with at least an <code>email</code> column. Optional <code>role</code>{' '}
          column accepts {VALID_ROLES.join(', ').toLowerCase()}. We create one invitation per
          new email; existing users and pending invites are skipped.
        </p>
      </header>

      {error && <div className="form-error">{error}</div>}

      <section className="card">
        <div className="row-between">
          <div>
            <label htmlFor="bi-default">Default role (when CSV has no role column)</label>
            <select
              id="bi-default"
              value={defaultRole}
              onChange={(e) => setDefaultRole(e.target.value as Role)}
              style={{ width: 200 }}
            >
              {VALID_ROLES.map((r) => (
                <option key={r} value={r}>{r.toLowerCase()}</option>
              ))}
            </select>
            <label style={{ marginTop: '0.5rem' }}>
              <input
                type="checkbox"
                checked={sendEmails}
                onChange={(e) => setSendEmails(e.target.checked)}
                style={{ width: 'auto', marginRight: 8 }}
              />
              Email each invitee (otherwise the link is returned in the response)
            </label>
          </div>
          <button type="button" className="button-ghost button-small" onClick={loadSample}>
            Load sample
          </button>
        </div>

        <label htmlFor="bi-text">CSV</label>
        <textarea
          id="bi-text"
          rows={10}
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="email,role,name&#10;ashley@example.com,CUSTOMER,Ashley Brown"
          spellCheck={false}
          style={{ fontFamily: 'ui-monospace, Menlo, monospace', fontSize: '0.875rem' }}
        />
        <div style={{ display: 'flex', gap: '0.5rem' }}>
          <button type="button" onClick={preview}>Preview</button>
        </div>
      </section>

      {parsed && (
        <section className="card">
          <h2>Preview ({parsed.length} row{parsed.length === 1 ? '' : 's'})</h2>
          {issues.length > 0 && (
            <div className="form-error">
              <strong>Issues:</strong>
              <ul style={{ marginTop: '0.5rem', marginLeft: '1.25rem' }}>
                {issues.map((i, idx) => <li key={idx}>{i}</li>)}
              </ul>
            </div>
          )}
          {parsed.length > 0 && (
            <>
              <table className="table" style={{ marginBottom: '1rem' }}>
                <thead><tr><th>Email</th><th>Role</th></tr></thead>
                <tbody>
                  {parsed.map((p) => (
                    <tr key={p.email}>
                      <td>{p.email}</td>
                      <td>{p.role.toLowerCase()}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <form onSubmit={submit}>
                <button type="submit" disabled={submitting}>
                  {submitting ? 'Importing…' : `Send ${parsed.length} invitation${parsed.length === 1 ? '' : 's'}`}
                </button>
              </form>
            </>
          )}
        </section>
      )}

      {results && summary && (
        <section className="card">
          <h2>Result</h2>
          <p>
            <strong>{summary.invited ?? 0}</strong> invited
            {summary.exists ? ` · ${summary.exists} already a user` : ''}
            {summary.invitation_pending ? ` · ${summary.invitation_pending} already invited` : ''}
            {summary.error ? ` · ${summary.error} errored` : ''}
          </p>
          <table className="table">
            <thead><tr><th>Email</th><th>Role</th><th>Status</th><th>Notes</th></tr></thead>
            <tbody>
              {results.map((r) => (
                <tr key={r.email}>
                  <td>{r.email}</td>
                  <td>{r.role.toLowerCase()}</td>
                  <td>{r.status.replace('_', ' ')}</td>
                  <td className="muted">
                    {r.message}
                    {r.inviteUrl && (
                      <>
                        <br />
                        <code style={{ fontSize: '0.75rem', wordBreak: 'break-all' }}>{r.inviteUrl}</code>
                      </>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}
    </div>
  );
}
