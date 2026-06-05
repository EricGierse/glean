// Glean — export helpers (CSV / QuickBooks-style / JSON) + browser download.
import { categoryById } from "./categories.js";

const esc = (v) => {
  const s = v == null ? "" : String(v);
  return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
};

function rowsToCsv(headers, rows) {
  return [headers.join(","), ...rows.map((r) => r.map(esc).join(","))].join("\r\n");
}

// Full ledger export
export function toCSV(receipts, categories) {
  const headers = ["Date", "Merchant", "Category", "Amount", "Currency", "Tax", "Source", "Note", "URL"];
  const rows = receipts.map((r) => [
    r.date, r.merchant, categoryById(r.category, categories).name,
    Number(r.amount).toFixed(2), r.currency, r.tax != null ? Number(r.tax).toFixed(2) : "",
    r.source, r.note, r.url,
  ]);
  return rowsToCsv(headers, rows);
}

// QuickBooks / Xero friendly (Date, Vendor, Category, Amount, Tax, Currency, Memo)
export function toAccountingCSV(receipts, categories) {
  const headers = ["Date", "Vendor", "Category", "Amount", "Tax Amount", "Currency", "Memo"];
  const rows = receipts.map((r) => [
    r.date, r.merchant, categoryById(r.category, categories).name,
    Number(r.amount).toFixed(2), r.tax != null ? Number(r.tax).toFixed(2) : "0.00",
    r.currency, r.note || `Imported from Glean`,
  ]);
  return rowsToCsv(headers, rows);
}

export function toJSON(receipts) {
  return JSON.stringify({ app: "Glean", version: 1, exportedAt: new Date().toISOString(), receipts }, null, 2);
}

export function download(filename, content, mime = "text/csv;charset=utf-8") {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1500);
}

export const stamp = () => new Date().toISOString().slice(0, 10);
