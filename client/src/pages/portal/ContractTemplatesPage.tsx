import { type FormEvent, useEffect, useMemo, useState } from 'react';
import { ApiError, api } from '../../lib/api';
import { formatDate } from '../../lib/format';

interface VariableDef {
  key: string;
  label: string;
  required?: boolean;
  multiline?: boolean;
  defaultValue?: string;
}

interface Template {
  id: string;
  name: string;
  description: string | null;
  body: string;
  variables: VariableDef[];
  active: boolean;
  createdAt: string;
  updatedAt: string;
  createdBy: { id: string; name: string };
  _count: { contracts: number };
}

interface DraftVariable {
  key: string;
  label: string;
  required: boolean;
  multiline: boolean;
  defaultValue: string;
}

const DEFAULT_BODY = `AGREEMENT BETWEEN NEW TERRA CONSTRUCTION AND {{customer_name}}

Project address: {{project_address}}

Scope of work:
{{scope}}

Total contract amount: \${{total_amount}}
Payment terms: {{payment_terms}}

Signed: ____________________
Date:   {{today}}
`;

// Pull variable keys out of {{name}} placeholders so the template author
// gets a starter list without having to maintain it manually.
function extractVarKeys(body: string): string[] {
  const matches = body.match(/\{\{\s*([a-zA-Z][a-zA-Z0-9_]*)\s*\}\}/g) ?? [];
  return Array.from(
    new Set(matches.map((m) => m.replace(/\{\{\s*|\s*\}\}/g, '')).filter(Boolean)),
  );
}

function humanize(key: string): string {
  return key.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

export default function ContractTemplatesPage() {
  const [templates, setTemplates] = useState<Template[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<Template | null>(null);
  const [showForm, setShowForm] = useState(false);

  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [body, setBody] = useState(DEFAULT_BODY);
  const [variables, setVariables] = useState<DraftVariable[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [archivedShown, setArchivedShown] = useState(false);

  async function load() {
    try {
      const { templates } = await api<{ templates: Template[] }>(
        `/api/contract-templates${archivedShown ? '?archived=true' : ''}`,
      );
      setTemplates(templates);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to load templates');
    }
  }

  useEffect(() => { load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [archivedShown]);

  // Detected variable keys in the body — surface as a hint while editing.
  const detectedKeys = useMemo(() => extractVarKeys(body), [body]);

  function startNew() {
    setEditing(null);
    setName('');
    setDescription('');
    setBody(DEFAULT_BODY);
    setVariables(
      extractVarKeys(DEFAULT_BODY).map((k) => ({
        key: k,
        label: humanize(k),
        required: true,
        multiline: k === 'scope',
        defaultValue: '',
      })),
    );
    setShowForm(true);
  }

  function startEdit(t: Template) {
    setEditing(t);
    setName(t.name);
    setDescription(t.description ?? '');
    setBody(t.body);
    setVariables(
      t.variables.map((v) => ({
        key: v.key,
        label: v.label,
        required: !!v.required,
        multiline: !!v.multiline,
        defaultValue: v.defaultValue ?? '',
      })),
    );
    setShowForm(true);
  }

  function syncVariablesFromBody() {
    const keys = extractVarKeys(body);
    const byKey = new Map(variables.map((v) => [v.key, v]));
    const next = keys.map(
      (k) =>
        byKey.get(k) ?? {
          key: k,
          label: humanize(k),
          required: true,
          multiline: false,
          defaultValue: '',
        },
    );
    setVariables(next);
  }

  async function save(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      // Strip empty default strings so they aren't persisted as "" (cleaner JSON
      // and lets us treat absence the same as "no default" elsewhere).
      const trimmedVars = variables.map((v) => {
        const out: DraftVariable & { defaultValue?: string } = { ...v };
        if (!v.defaultValue) delete (out as { defaultValue?: string }).defaultValue;
        return out;
      });
      const payload = { name, description: description || undefined, body, variables: trimmedVars };
      if (editing) {
        await api(`/api/contract-templates/${editing.id}`, {
          method: 'PATCH',
          body: JSON.stringify(payload),
        });
      } else {
        await api('/api/contract-templates', {
          method: 'POST',
          body: JSON.stringify(payload),
        });
      }
      setShowForm(false);
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Save failed');
    } finally {
      setSubmitting(false);
    }
  }

  async function archive(t: Template) {
    if (!confirm(`Archive "${t.name}"? It stays linked to existing contracts but won't be picked for new ones.`)) return;
    try {
      await api(`/api/contract-templates/${t.id}`, { method: 'DELETE' });
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Archive failed');
    }
  }

  async function reactivate(t: Template) {
    try {
      await api(`/api/contract-templates/${t.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ active: true }),
      });
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Update failed');
    }
  }

  return (
    <div className="dashboard">
      <header className="row-between">
        <div>
          <h1>Contract templates</h1>
          <p className="muted">
            Build reusable contract bodies. Use <code>{'{{variable_name}}'}</code> placeholders;
            sales reps fill them in when sending a contract.
          </p>
        </div>
        <div style={{ display: 'flex', gap: '0.5rem' }}>
          <label style={{ marginBottom: 0 }}>
            <input
              type="checkbox"
              checked={archivedShown}
              onChange={(e) => setArchivedShown(e.target.checked)}
              style={{ width: 'auto', marginRight: 6 }}
            />
            Show archived
          </label>
          <button onClick={startNew}>New template</button>
        </div>
      </header>

      {error && <div className="form-error">{error}</div>}

      {showForm && (
        <section className="card">
          <h2>{editing ? `Edit ${editing.name}` : 'New template'}</h2>
          <form onSubmit={save}>
            <label htmlFor="t-name">Name</label>
            <input id="t-name" value={name} onChange={(e) => setName(e.target.value)} required />

            <label htmlFor="t-desc">Description (internal)</label>
            <input id="t-desc" value={description} onChange={(e) => setDescription(e.target.value)} />

            <label htmlFor="t-body">Body</label>
            <textarea
              id="t-body"
              rows={14}
              value={body}
              onChange={(e) => setBody(e.target.value)}
              required
              spellCheck={false}
              style={{ fontFamily: 'ui-monospace, Menlo, monospace', fontSize: '0.875rem' }}
            />

            <div className="row-between" style={{ marginBottom: '0.75rem' }}>
              <strong>Variables</strong>
              <button type="button" className="button-ghost button-small" onClick={syncVariablesFromBody}>
                Sync from body ({detectedKeys.length} detected)
              </button>
            </div>

            {variables.length === 0 ? (
              <p className="muted">
                No variables yet. Add <code>{'{{name}}'}</code> placeholders in the body, then sync.
              </p>
            ) : (
              <table className="table" style={{ marginBottom: '1rem' }}>
                <thead>
                  <tr>
                    <th>Key</th>
                    <th>Label</th>
                    <th>Required</th>
                    <th>Multiline</th>
                    <th>Default</th>
                  </tr>
                </thead>
                <tbody>
                  {variables.map((v, i) => (
                    <tr key={v.key}>
                      <td><code>{v.key}</code></td>
                      <td>
                        <input
                          value={v.label}
                          onChange={(e) => {
                            const next = [...variables];
                            next[i] = { ...v, label: e.target.value };
                            setVariables(next);
                          }}
                          style={{ marginBottom: 0 }}
                        />
                      </td>
                      <td>
                        <input
                          type="checkbox"
                          checked={v.required}
                          onChange={(e) => {
                            const next = [...variables];
                            next[i] = { ...v, required: e.target.checked };
                            setVariables(next);
                          }}
                          style={{ width: 'auto' }}
                        />
                      </td>
                      <td>
                        <input
                          type="checkbox"
                          checked={v.multiline}
                          onChange={(e) => {
                            const next = [...variables];
                            next[i] = { ...v, multiline: e.target.checked };
                            setVariables(next);
                          }}
                          style={{ width: 'auto' }}
                        />
                      </td>
                      <td>
                        <input
                          value={v.defaultValue}
                          onChange={(e) => {
                            const next = [...variables];
                            next[i] = { ...v, defaultValue: e.target.value };
                            setVariables(next);
                          }}
                          placeholder="(none)"
                          style={{ marginBottom: 0 }}
                        />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}

            <div style={{ display: 'flex', gap: '0.5rem' }}>
              <button type="submit" disabled={submitting}>
                {submitting ? 'Saving…' : editing ? 'Save changes' : 'Create template'}
              </button>
              <button type="button" className="button-ghost" onClick={() => setShowForm(false)}>
                Cancel
              </button>
            </div>
          </form>
        </section>
      )}

      <section className="card">
        {templates.length ? (
          <table className="table">
            <thead>
              <tr>
                <th>Name</th>
                <th>Variables</th>
                <th>Used</th>
                <th>Updated</th>
                <th>Status</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {templates.map((t) => (
                <tr key={t.id}>
                  <td>
                    <strong>{t.name}</strong>
                    {t.description && <div className="muted">{t.description}</div>}
                  </td>
                  <td>{t.variables.length}</td>
                  <td>{t._count.contracts}</td>
                  <td>{formatDate(t.updatedAt)}</td>
                  <td>{t.active ? 'Active' : 'Archived'}</td>
                  <td>
                    <button className="button button-ghost button-small" onClick={() => startEdit(t)}>
                      Edit
                    </button>{' '}
                    {t.active ? (
                      <button className="button button-ghost button-small" onClick={() => archive(t)}>
                        Archive
                      </button>
                    ) : (
                      <button className="button button-ghost button-small" onClick={() => reactivate(t)}>
                        Reactivate
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <p className="muted">No templates yet.</p>
        )}
      </section>
    </div>
  );
}
