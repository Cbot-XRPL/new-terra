import { type FormEvent, useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { ApiError, api } from '../../lib/api';
import { formatCents } from '../../lib/format';

interface VariableDef {
  key: string;
  label: string;
  required?: boolean;
  multiline?: boolean;
  defaultValue?: string;
}

interface DraftDraw {
  id: string; // local-only — generated client-side for keying + remove
  name: string;
  description: string;
  amountCents: number;
  percentBasis: number | null;
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

interface ProjectOption {
  id: string;
  name: string;
  customer: { id: string };
}

function formatDrawSchedule(draws: DraftDraw[]): string {
  if (draws.length === 0) return '(No draw schedule defined.)';
  const total = draws.reduce((s, d) => s + d.amountCents, 0);
  const lines = draws.map((d, i) => {
    const amount = `$${(d.amountCents / 100).toFixed(2)}`;
    const detail = d.description ? ` — ${d.description}` : '';
    return `  ${i + 1}. ${d.name}: ${amount}${detail}`;
  });
  lines.push('');
  lines.push(`  Total: $${(total / 100).toFixed(2)}`);
  return lines.join('\n');
}

function renderPreview(
  body: string,
  values: Record<string, string>,
  draws: DraftDraw[],
): string {
  const enriched: Record<string, string> = {
    ...values,
    draw_schedule: values.draw_schedule || formatDrawSchedule(draws),
  };
  return body.replace(/\{\{\s*([a-zA-Z][a-zA-Z0-9_]*)\s*\}\}/g, (_m, key: string) => {
    const v = enriched[key];
    return typeof v === 'string' && v.length > 0 ? v : `[${key}]`;
  });
}

function uid(): string {
  return Math.random().toString(36).slice(2, 10);
}

export default function NewContractPage() {
  const navigate = useNavigate();
  const [templates, setTemplates] = useState<Template[]>([]);
  const [customers, setCustomers] = useState<CustomerOption[]>([]);
  const [projects, setProjects] = useState<ProjectOption[]>([]);
  const [error, setError] = useState<string | null>(null);

  const [templateId, setTemplateId] = useState('');
  const [customerId, setCustomerId] = useState('');
  const [projectId, setProjectId] = useState('');
  const [values, setValues] = useState<Record<string, string>>({});
  const [draws, setDraws] = useState<DraftDraw[]>([]);
  const [submitting, setSubmitting] = useState(false);

  // Draw editor row
  const [drawName, setDrawName] = useState('');
  const [drawDesc, setDrawDesc] = useState('');
  const [drawAmount, setDrawAmount] = useState('');

  // Manual body edit — when the rep clicks "Edit text" the preview turns
  // into a textarea; the saved string overrides the auto-rendered body.
  const [bodyOverride, setBodyOverride] = useState<string | null>(null);

  useEffect(() => {
    Promise.all([
      api<{ templates: Template[] }>('/api/contract-templates'),
      api<{ users: CustomerOption[] }>('/api/portal/customers'),
      api<{ projects: ProjectOption[] }>('/api/projects'),
    ])
      .then(([t, c, p]) => {
        setTemplates(t.templates);
        setCustomers(c.users);
        setProjects(p.projects);
      })
      .catch((err) => setError(err instanceof ApiError ? err.message : 'Failed to load'));
  }, []);

  // When the customer changes, drop a project selection that no longer applies.
  useEffect(() => {
    if (!customerId) {
      setProjectId('');
      return;
    }
    if (projectId && !projects.some((p) => p.id === projectId && p.customer.id === customerId)) {
      setProjectId('');
    }
  }, [customerId, projectId, projects]);

  const template = templates.find((t) => t.id === templateId) ?? null;

  // Reset variable values when template changes — prefill from defaults so
  // sales reps don't re-type boilerplate (payment terms, signoff line, etc.).
  useEffect(() => {
    if (!template) {
      setValues({});
      return;
    }
    const next: Record<string, string> = {};
    for (const v of template.variables) {
      next[v.key] = values[v.key] ?? v.defaultValue ?? '';
    }
    setValues(next);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [templateId]);

  // Contract total is derived from the sum of draws — no separate input.
  const contractTotalCents = draws.reduce((s, d) => s + d.amountCents, 0);

  const previewValues = useMemo(
    () => ({
      ...values,
      // Inject the live total so the preview reflects what the rep is
      // building as they add draws. Server does the same on save.
      contract_total: contractTotalCents > 0 ? formatCents(contractTotalCents) : '',
    }),
    [values, contractTotalCents],
  );

  const previewAuto = useMemo(
    () => (template ? renderPreview(template.body, previewValues, draws) : ''),
    [template, previewValues, draws],
  );
  const previewShown = bodyOverride ?? previewAuto;

  function addDraw() {
    setError(null);
    if (!drawName.trim()) {
      setError('Draw needs a milestone name');
      return;
    }
    const dollars = Number(drawAmount);
    if (!drawAmount || !Number.isFinite(dollars) || dollars <= 0) {
      setError('Draw amount must be > 0');
      return;
    }
    setDraws((d) => [
      ...d,
      {
        id: uid(),
        name: drawName.trim(),
        description: drawDesc.trim(),
        amountCents: Math.round(dollars * 100),
        percentBasis: null,
      },
    ]);
    setDrawName('');
    setDrawDesc('');
    setDrawAmount('');
  }

  function removeDraw(id: string) {
    setDraws((d) => d.filter((x) => x.id !== id));
  }

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
          projectId: projectId || undefined,
          variableValues: values,
          draws: draws.map((d) => ({
            name: d.name,
            description: d.description || undefined,
            amountCents: d.amountCents,
            percentBasis: d.percentBasis ?? undefined,
          })),
          bodyOverride: bodyOverride ?? undefined,
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
          {customerId && projects.some((p) => p.customer.id === customerId) && (
            <>
              <label htmlFor="ct-project">Project (optional)</label>
              <select
                id="ct-project"
                value={projectId}
                onChange={(e) => setProjectId(e.target.value)}
              >
                <option value="">— not tied to a project —</option>
                {projects
                  .filter((p) => p.customer.id === customerId)
                  .map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
              </select>
            </>
          )}

          {template && template.variables.length > 0 && (
            <>
              <h2 style={{ marginTop: '1.5rem' }}>Fill in</h2>
              {template.variables
                // Payment terms renders with the draws below since it's
                // part of the same payment-plan block.
                .filter((v) => v.key !== 'payment_terms_days')
                .map((v) => (
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

          {template && (
            <>
              <div className="row-between" style={{ marginTop: '1.5rem', alignItems: 'baseline' }}>
                <h2 style={{ margin: 0 }}>Draw schedule</h2>
                <div style={{ fontSize: '0.95rem' }}>
                  Contract total:{' '}
                  <strong>{formatCents(contractTotalCents)}</strong>
                  {draws.length > 0 && (
                    <span className="muted" style={{ marginLeft: '0.4rem', fontSize: '0.8rem' }}>
                      ({draws.length} draw{draws.length === 1 ? '' : 's'})
                    </span>
                  )}
                </div>
              </div>
              <p className="muted" style={{ fontSize: '0.85rem', margin: '0.25rem 0 0.75rem' }}>
                The first draw is the deposit due at signing. The contract total is the sum of all draws.
              </p>
              {template.variables.some((v) => v.key === 'payment_terms_days') && (
                <div className="form-row">
                  <div>
                    <label htmlFor="var-payment_terms_days">Payment terms (days)</label>
                    <input
                      id="var-payment_terms_days"
                      value={values.payment_terms_days ?? ''}
                      onChange={(e) => setValues({ ...values, payment_terms_days: e.target.value })}
                      placeholder="e.g. 7"
                    />
                  </div>
                </div>
              )}
              <p className="muted" style={{ fontSize: '0.85rem', marginBottom: '0.5rem' }}>
                Progress-billing milestones. They render into the contract body and become
                invoiceable from the project once work begins.
              </p>
              {draws.length > 0 && (
                <table className="table" style={{ marginBottom: '0.75rem' }}>
                  <thead>
                    <tr>
                      <th style={{ width: '2rem' }}>#</th>
                      <th>Milestone</th>
                      <th style={{ textAlign: 'right' }}>Amount</th>
                      <th></th>
                    </tr>
                  </thead>
                  <tbody>
                    {draws.map((d, i) => (
                      <tr key={d.id}>
                        <td>{i + 1}</td>
                        <td>
                          <strong>{d.name}</strong>
                          {d.description && (
                            <div className="muted" style={{ fontSize: '0.85rem' }}>
                              {d.description}
                            </div>
                          )}
                        </td>
                        <td style={{ textAlign: 'right' }}>
                          {formatCents(d.amountCents)}
                          {d.percentBasis != null && (
                            <div className="muted" style={{ fontSize: '0.75rem' }}>
                              ({d.percentBasis}%)
                            </div>
                          )}
                        </td>
                        <td style={{ textAlign: 'right' }}>
                          <button
                            type="button"
                            className="button-ghost button-small"
                            onClick={() => removeDraw(d.id)}
                          >
                            Remove
                          </button>
                        </td>
                      </tr>
                    ))}
                    <tr>
                      <td colSpan={2} style={{ textAlign: 'right', fontWeight: 600 }}>Total</td>
                      <td style={{ textAlign: 'right', fontWeight: 600 }}>
                        {formatCents(draws.reduce((s, d) => s + d.amountCents, 0))}
                      </td>
                      <td />
                    </tr>
                  </tbody>
                </table>
              )}
              <div className="form-row">
                <div>
                  <label>Milestone</label>
                  <input
                    value={drawName}
                    onChange={(e) => setDrawName(e.target.value)}
                    placeholder="e.g. Foundation poured"
                  />
                </div>
                <div>
                  <label>Description (optional)</label>
                  <input
                    value={drawDesc}
                    onChange={(e) => setDrawDesc(e.target.value)}
                    placeholder="Detail surfaced to the customer"
                  />
                </div>
              </div>
              <div className="form-row">
                <div>
                  <label>Amount ($)</label>
                  <input
                    type="number"
                    step="0.01"
                    min="0"
                    value={drawAmount}
                    onChange={(e) => setDrawAmount(e.target.value)}
                    placeholder="e.g. 5000"
                  />
                </div>
                <div style={{ alignSelf: 'end' }}>
                  <button type="button" className="button-ghost" onClick={addDraw}>
                    Add draw
                  </button>
                </div>
              </div>
            </>
          )}

          <div style={{ display: 'flex', gap: '0.5rem', marginTop: '1rem' }}>
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
          <div className="row-between">
            <h2 style={{ margin: 0 }}>Preview</h2>
            <div style={{ display: 'flex', gap: '0.5rem' }}>
              {bodyOverride !== null && (
                <button
                  type="button"
                  className="button-ghost button-small"
                  onClick={() => setBodyOverride(null)}
                  title="Discard manual edits and re-render from template + variables + draws"
                >
                  Reset to template
                </button>
              )}
              {bodyOverride === null ? (
                <button
                  type="button"
                  className="button-ghost button-small"
                  onClick={() => setBodyOverride(previewAuto)}
                  title="Hand-edit the contract text below before sending"
                >
                  Edit text
                </button>
              ) : (
                <span className="muted" style={{ fontSize: '0.8rem', alignSelf: 'center' }}>
                  Editing — variable + draw changes will not overwrite this.
                </span>
              )}
            </div>
          </div>
          {bodyOverride === null ? (
            <pre className="contract-body">{previewShown}</pre>
          ) : (
            <textarea
              className="contract-body"
              value={bodyOverride}
              onChange={(e) => setBodyOverride(e.target.value)}
              style={{ width: '100%', minHeight: '500px', fontFamily: 'inherit' }}
            />
          )}
        </section>
      )}
    </div>
  );
}
