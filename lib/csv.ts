// Minimal RFC-4180 CSV writer with spreadsheet formula-injection protection.

/**
 * Escapes a single cell.
 *
 * Excel, Google Sheets and LibreOffice all execute a cell that begins with
 * `=`, `+`, `-` or `@` as a formula. Since these values come from user-supplied
 * file names and free-text notes, an exported report could otherwise run code
 * on whoever opens it. Prefixing with an apostrophe neutralises it while still
 * displaying the original text.
 */
export function csvCell(value: unknown): string {
  if (value === null || value === undefined) return '';

  let s = Array.isArray(value) ? value.join(' | ') : String(value);

  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;

  if (/[",\n\r]/.test(s)) s = `"${s.replace(/"/g, '""')}"`;

  return s;
}

export function toCsv(headers: string[], rows: unknown[][]): string {
  const lines = [headers.map(csvCell).join(',')];
  for (const row of rows) lines.push(row.map(csvCell).join(','));
  // CRLF + a UTF-8 BOM so Excel opens accented characters correctly.
  return '﻿' + lines.join('\r\n') + '\r\n';
}

/** Safe `Content-Disposition` filename (quotes and control chars stripped). */
export function attachmentHeader(filename: string): string {
  const safe = filename.replace(/[^\w.\- ]+/g, '_').slice(0, 120);
  return `attachment; filename="${safe}"`;
}
