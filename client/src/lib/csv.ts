// Minimal CSV parser — handles quoted fields with embedded commas, escaped
// quotes ("" -> "), and CR/LF line endings. We avoid pulling in a parser
// dependency for what is, at most, a few hundred rows pasted by an admin.

export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let inQuotes = false;

  for (let i = 0; i < text.length; i++) {
    const c = text[i];

    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i += 1;
        } else {
          inQuotes = false;
        }
      } else {
        field += c;
      }
      continue;
    }

    if (c === '"') {
      inQuotes = true;
    } else if (c === ',') {
      row.push(field);
      field = '';
    } else if (c === '\r') {
      // Skip — handled by \n.
    } else if (c === '\n') {
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
    } else {
      field += c;
    }
  }
  // Trailing row without a newline.
  if (field.length > 0 || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return rows.filter((r) => r.some((cell) => cell.trim().length > 0));
}

export interface CsvHeader {
  index: number;
  name: string;
}

export function indexHeaders(headerRow: string[]): Record<string, number> {
  const out: Record<string, number> = {};
  headerRow.forEach((h, i) => {
    out[h.trim().toLowerCase()] = i;
  });
  return out;
}
