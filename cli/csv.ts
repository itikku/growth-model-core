// Minimal CSV reading and writing (commas, double quotes, a header row). No dependencies.
import { readFileSync, writeFileSync } from 'node:fs';

export function readCsv(path: string): Record<string, string>[] {
  const text = readFileSync(path, 'utf8').replace(/\r\n/g, '\n').trim();
  const rows: string[][] = [];
  let row: string[] = [], cell = '', quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"' && text[i + 1] === '"') { cell += '"'; i++; }
      else if (ch === '"') quoted = false;
      else cell += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ',') { row.push(cell); cell = ''; }
    else if (ch === '\n') { row.push(cell); rows.push(row); row = []; cell = ''; }
    else cell += ch;
  }
  row.push(cell);
  rows.push(row);
  const [header, ...body] = rows;
  return body.filter((r) => r.length > 1 || r[0] !== '').map((r) => Object.fromEntries(header.map((h, i) => [h.trim(), (r[i] ?? '').trim()])));
}

export function writeCsv(path: string, header: string[], rows: (string | number | undefined)[][]): void {
  const esc = (v: string | number | undefined) => {
    const s = v === undefined ? '' : String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  writeFileSync(path, [header.join(','), ...rows.map((r) => r.map(esc).join(','))].join('\n') + '\n');
}
