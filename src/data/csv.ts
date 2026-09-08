/**
 * Minimal RFC-4180-ish CSV reader.
 *
 * Handles quoted fields, "" escapes inside quotes, and CRLF or LF line
 * endings. Returns one object per data row, keyed by the trimmed header names.
 * Rows that are entirely empty are dropped.
 */
export function parseCsv(text: string): Array<Record<string, string>> {
  const s = text.replace(/^﻿/, ""); // strip UTF-8 BOM
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;

  const endField = (): void => {
    row.push(field);
    field = "";
  };
  const endRow = (): void => {
    endField();
    rows.push(row);
    row = [];
  };

  for (let i = 0; i < s.length; i++) {
    const c = s.charAt(i);
    if (inQuotes) {
      if (c === '"') {
        if (s.charAt(i + 1) === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += c;
      }
      continue;
    }
    if (c === '"') inQuotes = true;
    else if (c === ",") endField();
    else if (c === "\n") endRow();
    else if (c === "\r") {
      if (s.charAt(i + 1) === "\n") i++;
      endRow();
    } else field += c;
  }
  if (field !== "" || row.length > 0) endRow();

  const headerRow = rows.shift();
  if (!headerRow) return [];
  const headers = headerRow.map((h) => h.trim());

  return rows
    .filter((r) => r.some((v) => v.trim() !== ""))
    .map((r) => {
      const obj: Record<string, string> = {};
      headers.forEach((h, idx) => {
        obj[h] = (r[idx] ?? "").trim();
      });
      return obj;
    });
}
