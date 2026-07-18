// Section 7.13 — the ONE CSV-generation utility (Law 10: no duplicated
// logic). RFC 4180 quoting: any field containing a comma, quote, or
// newline is wrapped in quotes with internal quotes doubled.
function escapeCsvField(value: unknown): string {
  const str = value === null || value === undefined ? "" : String(value);
  if (/[",\n\r]/.test(str)) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

export type CsvColumn<T> = {
  header: string;
  value: (row: T) => unknown;
};

/**
 * Renders `rows` as a CSV string using `\r\n` line endings (the RFC 4180
 * convention, and what every spreadsheet tool expects). Every export
 * route (Section 7.13's WYSIWYG export test) builds its columns from the
 * exact same row objects the corresponding screen renders, so "export
 * rows === screen rows for an identical filter" holds by construction.
 */
export function toCsv<T>(rows: T[], columns: CsvColumn<T>[]): string {
  const header = columns.map((c) => escapeCsvField(c.header)).join(",");
  const lines = rows.map((row) => columns.map((c) => escapeCsvField(c.value(row))).join(","));
  return [header, ...lines].join("\r\n");
}
