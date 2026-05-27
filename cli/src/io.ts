/** Output helpers — stream writers + table formatting. Leaf module. */

export function write(stream: { write: (s: string) => void }, text: string): void {
  stream.write(text);
}

export function writeLine(stream: { write: (s: string) => void }, text: string): void {
  stream.write(`${text}\n`);
}

export function writeJson(stream: { write: (s: string) => void }, value: unknown): void {
  writeLine(stream, JSON.stringify(value, null, 2));
}

/** Render an array of row objects as a fixed-width aligned table. */
export function formatTable(rows: any[], columns: string[]): string {
  if (rows.length === 0) return '';
  const widths: Record<string, number> = {};
  for (const column of columns) {
    widths[column] = Math.max(
      column.length,
      ...rows.map((row) => String(row[column] ?? '').length),
    );
  }
  const line = (row: any) => columns.map((column) => String(row[column] ?? '').padEnd(widths[column])).join('  ').trimEnd();
  return [
    line(Object.fromEntries(columns.map((column) => [column, column]))),
    columns.map((column) => '-'.repeat(widths[column])).join('  '),
    ...rows.map(line),
  ].join('\n');
}

/** Prefix each non-empty line of a chunk with `[label]` and write it. */
export function prefixChunk(stream: { write: (s: string) => void }, label: string, chunk: { toString: () => string }): void {
  const text = chunk.toString();
  for (const line of text.split(/\r?\n/)) {
    if (line.length > 0) writeLine(stream, `[${label}] ${line}`);
  }
}
