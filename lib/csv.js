/**
 * lib/csv.js
 * Shared customer CSV parser — PapaParse-based, RFC-4180 compliant.
 * Used by both Installer and Enterprise import endpoints.
 *
 * Server-side (Node.js): accepts a string of CSV text.
 * Client-side: import and call parseCustomerCsvText(text) from the textarea.
 *
 * Install: npm install papaparse
 */

// PapaParse is a required production dependency — npm install papaparse
import Papa from "papaparse";

/**
 * Parse a CSV string into validated customer rows.
 * @param {string} text  Raw CSV text (from textarea paste or file read)
 * @returns {{ rows, errors, fields, invalidRows }}
 */
export function parseCustomerCsv(text) {
  const result = Papa.parse(text.trim(), {
      header:         true,
      skipEmptyLines: true,
      transformHeader: h => h.trim().toLowerCase().replace(/\s+/g, "_"),
    });

    const rows       = result.data;
    const parseErrors = result.errors.map(e => ({ row: e.row + 2, message: e.message }));
    const fields     = result.meta.fields || [];

    const invalidRows = rows
      .map((row, i) => ({ ...row, _rowNumber: i + 2 }))
      .filter(row => !String(row.email || "").trim().includes("@"));

    return { rows, errors: parseErrors, fields, invalidRows };
}

/** Validate that parsed rows have required fields. Returns array of error messages. */
export function validateCustomerRows(rows, required = ["email"]) {
  const errors = [];
  for (const row of rows) {
    for (const field of required) {
      if (!String(row[field] || "").trim()) {
        errors.push({ rowNumber: row._rowNumber, field, message: `Missing required field: ${field}` });
      }
    }
  }
  return errors;
}
