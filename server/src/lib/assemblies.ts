// Recursively expand an assembly (and any nested sub-assemblies) into a flat
// list of estimate-ready line specs. Used by:
//   - the assembly preview endpoint (so the rep sees the rolled-up totals
//     before they drop the assembly into a draft)
//   - the estimate /add-assembly endpoint (which inserts the expanded lines)
//
// Cycle protection: tracks the chain of assembly ids being walked. If we
// revisit one we throw — the caller surfaces it as a 400.

import { prisma } from '../db.js';

export interface ExpandedLine {
  description: string;
  quantity: number;
  unit: string | null;
  unitPriceCents: number;
  totalCents: number;
  category: string | null;
  notes: string | null;
}

interface ExpandOptions {
  // Multiplier applied to all line quantities (used when expanding from a
  // parent line that has its own quantity).
  qtyMultiplier?: number;
  visited?: Set<string>;
}

export async function expandAssembly(
  assemblyId: string,
  opts: ExpandOptions = {},
): Promise<ExpandedLine[]> {
  const visited = opts.visited ?? new Set<string>();
  if (visited.has(assemblyId)) {
    throw new Error(`Assembly cycle detected at ${assemblyId}`);
  }
  visited.add(assemblyId);
  const multiplier = opts.qtyMultiplier ?? 1;

  const assembly = await prisma.assembly.findUnique({
    where: { id: assemblyId },
    include: {
      lines: {
        orderBy: { position: 'asc' },
        include: { product: true },
      },
    },
  });
  if (!assembly) return [];

  const out: ExpandedLine[] = [];
  for (const line of assembly.lines) {
    const qty = Number(line.quantity) * multiplier;
    if (line.subAssemblyId) {
      // Recurse with this line's qty as the multiplier so e.g. "2x bath rough-in"
      // doubles every nested line in one shot.
      const nested = await expandAssembly(line.subAssemblyId, {
        qtyMultiplier: qty,
        visited: new Set(visited),
      });
      out.push(...nested);
      continue;
    }
    if (line.product) {
      const unitPriceCents = line.unitPriceOverrideCents ?? line.product.defaultUnitPriceCents;
      out.push({
        description: line.description ?? line.product.name,
        quantity: qty,
        unit: line.product.unit ?? null,
        unitPriceCents,
        totalCents: Math.round(qty * unitPriceCents),
        category: line.category ?? line.product.category ?? null,
        notes: line.notes,
      });
      continue;
    }
    // Freeform line — description + override price are required.
    const unitPriceCents = line.unitPriceOverrideCents ?? 0;
    out.push({
      description: line.description ?? 'Unnamed item',
      quantity: qty,
      unit: null,
      unitPriceCents,
      totalCents: Math.round(qty * unitPriceCents),
      category: line.category ?? null,
      notes: line.notes,
    });
  }
  return out;
}
