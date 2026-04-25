import { type FormEvent, useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { ApiError, api } from '../../lib/api';

interface VariableDef {
  key: string;
  label: string;
  required?: boolean;
  multiline?: boolean;
}

interface Template {
  id: string;
  name: string;
  description: string | null;
  body: string;
  variables: VariableDef[];
}

interface CustomerOption {
  id: string;
  name: string;
  email: string;
}

function renderPreview(body: string, values: Record<string, string>): string {
  return body.replace(/\{\{\s*([a-zA-Z][a-zA-Z0-9_]*)\s*\}\}/g, (_m, key: string) => {
    return values[key] && values[key].length > 0 ? values[key] : `[${key}]`;
  });
}

export default function NewContractPage() {
  const navigate = useNavigate();
  const [templates, setTemplates] = useState<Template[]>([]);
  const [customers, setCustomers] = useState<CustomerOption[]>([]);
  const [error, setError] = useState<string | null>(null);

  const [templateId, setTemplateId] = useState('');
  const [customerId, setCustomerId] = useState('');
  const [values, setValues] = useState<Record<string, string>>({});
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    Promise.all([
      api<{ templates: Template[] }>('/api/contract-templates'),
      api<{ users: CustomerOption[] }>('/api/portal/customers'),
    ])
      .then(([t, c]) => {
        setTemplates(t.templates);
        setCustomers(c.users);
      })
      .catch((err) => setError(err instanceof ApiError ? err.message : 'Failed to load'));
  }, []);

  const template = templates.find((t) => t.id === templateId) ?? null;

  // Reset variable values when template changes.
  useEffect(() => {
    if (!template) {
      setValues({});
      return;
    }
    const next: Record<string, string> = {};
    for (const v of template.variables) next[v.key] = values[v.key] ?? '';
    setValues(next);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [templateId]);

  const preview = useMemo(
    () => (template ? renderPreview(template.body, values) : ''),
    [template, values],
  );

  async function submit(e: FormEvent, send: boolean) {
    e.preventDefault();
    if (!template) return;
    setError(null);
    setSubmitting(true);
    try {
      const created = await api<{ contract: { id: string } }>('/api/contracts', {
        method: 'POST',
        body: JSON.stringify({
          templateId: template.id,
          customerId,
          variableValues: values,
        }),
      });
      if (send) {
        await api(`/api/contracts/${created.contract.id}/send`, { method: 'POST' });
      }
      navigate(`/portal/contracts/${created.contract.id}`);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to create contract');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="dashboard">
      <header>
        <Link to="/portal/contracts" className="muted">← Contracts</Link>
        <h1>New contract</h1>
        <p className="muted">Pick a template, fill it out, and either save as draft or send for signature.</p>
      </header>

      {error && <div className="form-error">{error}</div>}

      <section className="card">
        <form onSubmit={(e) => submit(e, true)}>
          <div className="form-row">
            <div>
              <label htmlFor="ct-template">Template</label>
              <select
                id="ct-template"
                value={templateId}
                onChange={(e) => setTemplateId(e.target.value)}
                required
              >
                <option value="">Select…</option>
                {templates.map((t) => (
                  <option key={t.id} value={t.id}>{t.name}</option>
                ))}
              </select>
            </div>
            <div>
              <label htmlFor="ct-customer">Customer</label>
              <select
                id="ct-customer"
                value={customerId}
                onChange={(e) => setCustomerId(e.target.value)}
                required
              >
                <option value="">Select…</option>
                {customers.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name} ({c.email})
                  </option>
                ))}
              </select>
            </div>
          </div>

          {template && template.variables.length > 0 && (
            <>
              <h2 style={{ marginTop: '1.5rem' }}>Fill in</h2>
              {template.variables.map((v) => (
                <div key={v.key}>
                  <label htmlFor={`var-${v.key}`}>
                    {v.label}
                    {v.required && <span style={{ color: 'var(--error)' }}> *</span>}
                  </label>
                  {v.multiline ? (
                    <textarea
                      id={`var-${v.key}`}
                      rows={4}
                      value={values[v.key] ?? ''}
                      onChange={(e) => setValues({ ...values, [v.key]: e.target.value })}
                      required={v.required}
                    />
                  ) : (
                    <input
                      id={`var-${v.key}`}
                      value={values[v.key] ?? ''}
                      onChange={(e) => setValues({ ...values, [v.key]: e.target.value })}
                      required={v.required}
                    />
                  )}
                </div>
              ))}
            </>
          )}

          <div style={{ display: 'flex', gap: '0.5rem', marginTop: '0.5rem' }}>
            <button type="button" className="button-ghost" onClick={(e) => submit(e, false)} disabled={submitting || !template}>
              {submitting ? 'Saving…' : 'Save as draft'}
            </button>
            <button type="submit" disabled={submitting || !template}>
              {submitting ? 'Sending…' : 'Save & send'}
            </button>
          </div>
        </form>
      </section>

      {template && (
        <section className="card">
          <h2>Preview</h2>
          <pre className="contract-body">{preview}</pre>
        </section>
      )}
    </div>
  );
}
