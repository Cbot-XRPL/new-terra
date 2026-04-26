import { type FormEvent, useState } from 'react';
import {
  concreteSlab,
  deckFraming,
  fenceLayout,
  mulchCoverage,
  paintCoverage,
  retainingWall,
  type CalcResult,
} from '../../lib/calculators';

interface FieldDef {
  key: string;
  label: string;
  unit?: string;
  step?: string;
  min?: number;
  max?: number;
  default: number;
  optional?: boolean;
}

interface CalcDef {
  id: string;
  name: string;
  description: string;
  fields: FieldDef[];
  run: (values: Record<string, number>) => CalcResult;
}

const CALCS: CalcDef[] = [
  {
    id: 'mulch',
    name: 'Mulch / gravel coverage',
    description: 'Cubic yards of bulk material to cover an area at a given depth.',
    fields: [
      { key: 'areaSqft', label: 'Area', unit: 'sqft', default: 200, step: '1', min: 0 },
      { key: 'depthInches', label: 'Depth', unit: 'in', default: 3, step: '0.5', min: 0 },
    ],
    run: (v) =>
      mulchCoverage({ areaSqft: v.areaSqft, depthInches: v.depthInches }),
  },
  {
    id: 'concrete',
    name: 'Concrete (slab / pad)',
    description: 'Yards or bags of concrete for a rectangular pour.',
    fields: [
      { key: 'lengthFt', label: 'Length', unit: 'ft', default: 10, step: '0.5', min: 0 },
      { key: 'widthFt', label: 'Width', unit: 'ft', default: 10, step: '0.5', min: 0 },
      { key: 'depthInches', label: 'Depth', unit: 'in', default: 4, step: '0.5', min: 0 },
    ],
    run: (v) =>
      concreteSlab({ lengthFt: v.lengthFt, widthFt: v.widthFt, depthInches: v.depthInches }),
  },
  {
    id: 'wall',
    name: 'Retaining wall (segmental block)',
    description: 'Block + base gravel for a stackable retaining wall.',
    fields: [
      { key: 'lengthFt', label: 'Wall length', unit: 'ft', default: 20, step: '0.5', min: 0 },
      { key: 'heightInches', label: 'Wall height', unit: 'in', default: 24, step: '1', min: 0 },
      { key: 'blockWidthInches', label: 'Block width', unit: 'in', default: 12, step: '0.5', min: 0, optional: true },
      { key: 'blockHeightInches', label: 'Block height', unit: 'in', default: 4, step: '0.5', min: 0, optional: true },
    ],
    run: (v) =>
      retainingWall({
        lengthFt: v.lengthFt,
        heightInches: v.heightInches,
        blockWidthInches: v.blockWidthInches,
        blockHeightInches: v.blockHeightInches,
      }),
  },
  {
    id: 'deck',
    name: 'Deck framing',
    description: 'Joists, beams, and decking quantity for a rectangular deck.',
    fields: [
      { key: 'lengthFt', label: 'Length (along joists)', unit: 'ft', default: 16, step: '1', min: 0 },
      { key: 'widthFt', label: 'Width (span)', unit: 'ft', default: 20, step: '1', min: 0 },
      { key: 'joistSpacingInches', label: 'Joist spacing', unit: 'in o.c.', default: 16, step: '4', min: 12, max: 24 },
      { key: 'joistLumberLengthFt', label: 'Joist stock length', unit: 'ft', default: 20, step: '2', min: 8 },
    ],
    run: (v) =>
      deckFraming({
        lengthFt: v.lengthFt,
        widthFt: v.widthFt,
        joistSpacingInches: v.joistSpacingInches,
        joistLumberLengthFt: v.joistLumberLengthFt,
      }),
  },
  {
    id: 'paint',
    name: 'Paint coverage',
    description: 'Gallons of paint for a wall area, accounting for openings + coats.',
    fields: [
      { key: 'wallSqft', label: 'Wall area', unit: 'sqft', default: 800, step: '10', min: 0 },
      { key: 'openingsSqft', label: 'Openings (doors / windows)', unit: 'sqft', default: 40, step: '5', min: 0, optional: true },
      { key: 'coats', label: 'Coats', default: 2, step: '1', min: 1, max: 5, optional: true },
    ],
    run: (v) =>
      paintCoverage({
        wallSqft: v.wallSqft,
        openingsSqft: v.openingsSqft,
        coats: v.coats,
      }),
  },
  {
    id: 'fence',
    name: 'Fence layout',
    description: 'Posts, sections, and concrete for a linear fence run.',
    fields: [
      { key: 'lengthFt', label: 'Total length', unit: 'ft', default: 100, step: '1', min: 0 },
      { key: 'postSpacingFt', label: 'Post spacing', unit: 'ft', default: 8, step: '1', min: 4, max: 10 },
      { key: 'hasGates', label: '4-ft gates', default: 1, step: '1', min: 0, max: 4, optional: true },
    ],
    run: (v) =>
      fenceLayout({
        lengthFt: v.lengthFt,
        postSpacingFt: v.postSpacingFt,
        hasGates: v.hasGates,
      }),
  },
];

function CalculatorCard({ def }: { def: CalcDef }) {
  const [values, setValues] = useState<Record<string, number>>(
    () => Object.fromEntries(def.fields.map((f) => [f.key, f.default])),
  );
  const [result, setResult] = useState<CalcResult | null>(null);

  function calculate(e: FormEvent) {
    e.preventDefault();
    setResult(def.run(values));
  }

  return (
    <section className="card">
      <h2>{def.name}</h2>
      <p className="muted" style={{ fontSize: '0.85rem' }}>{def.description}</p>
      <form onSubmit={calculate}>
        <div className="form-row" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))' }}>
          {def.fields.map((f) => (
            <div key={f.key}>
              <label>
                {f.label}
                {f.unit && <span className="muted"> ({f.unit})</span>}
                {f.optional && <span className="muted"> · optional</span>}
              </label>
              <input
                type="number"
                step={f.step ?? 'any'}
                min={f.min}
                max={f.max}
                value={values[f.key]}
                onChange={(e) =>
                  setValues({ ...values, [f.key]: Number(e.target.value) })
                }
              />
            </div>
          ))}
        </div>
        <button type="submit">Calculate</button>
      </form>

      {result && (
        <div style={{ marginTop: '1rem' }}>
          <div className="result-headline">
            <div className="muted" style={{ fontSize: '0.85rem' }}>{result.primary.label}</div>
            <div style={{ fontSize: '1.75rem', fontWeight: 700 }}>{result.primary.value}</div>
          </div>
          <table className="table" style={{ marginTop: '0.75rem' }}>
            <tbody>
              {result.breakdown.map((row) => (
                <tr key={row.label}>
                  <td className="muted">{row.label}</td>
                  <td><strong>{row.value}</strong></td>
                </tr>
              ))}
            </tbody>
          </table>
          {result.notes && result.notes.length > 0 && (
            <ul className="muted" style={{ marginTop: '0.75rem', paddingLeft: '1.25rem', fontSize: '0.85rem' }}>
              {result.notes.map((n, i) => <li key={i}>{n}</li>)}
            </ul>
          )}
        </div>
      )}
    </section>
  );
}

export default function CalculatorsPage() {
  const [openId, setOpenId] = useState<string | null>(CALCS[0]?.id ?? null);
  const open = CALCS.find((c) => c.id === openId);

  return (
    <div className="dashboard">
      <header>
        <h1>Calculators</h1>
        <p className="muted">
          Quick material + labor sizing for the common job patterns. These are estimates — round
          up and add waste factors before ordering.
        </p>
      </header>

      <div className="form-row" style={{ gridTemplateColumns: '220px 1fr' }}>
        <nav className="card" style={{ padding: '0.5rem' }}>
          <ul style={{ listStyle: 'none', display: 'flex', flexDirection: 'column', gap: '0.25rem', margin: 0 }}>
            {CALCS.map((c) => (
              <li key={c.id}>
                <button
                  type="button"
                  className={openId === c.id ? '' : 'button-ghost'}
                  style={{ width: '100%', textAlign: 'left' }}
                  onClick={() => setOpenId(c.id)}
                >
                  {c.name}
                </button>
              </li>
            ))}
          </ul>
        </nav>
        <div>{open && <CalculatorCard key={open.id} def={open} />}</div>
      </div>
    </div>
  );
}
