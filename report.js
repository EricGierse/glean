// Glean — printable expense report (Pro). Opens as its own tab, reads receipts from
// chrome.storage, and renders a clean document the user can Print → Save as PDF.

import { getReceipts, getSettings, computeStats } from "./lib/store.js";
import { categoryById } from "./lib/categories.js";
import { categoryBreakdown } from "./lib/insights.js";
import { formatMoney, formatDate, escapeHtml } from "./lib/util.js";

const $ = (s) => document.querySelector(s);

(async function () {
  const [receipts, settings] = [await getReceipts(), await getSettings()];
  const cur = settings.currency;
  const cats = settings.categories;
  const stats = computeStats(receipts, cur);

  // sort newest first for the table
  const rows = [...receipts].sort((a, b) => new Date(b.date) - new Date(a.date));

  // date range across all receipts
  const dates = receipts.map((r) => r.date).filter(Boolean).sort();
  const range = dates.length ? `${formatDate(dates[0])} – ${formatDate(dates[dates.length - 1])}` : "No receipts yet";
  $("#docRange").textContent = range;
  document.title = `Glean Expense Report — ${new Date().toISOString().slice(0, 10)}`;

  // summary (totals in the primary currency)
  const taxTotal = receipts.reduce((s, r) => s + (r.currency === cur && r.tax != null ? Number(r.tax) : 0), 0);
  $("#sTotal").textContent = formatMoney(stats.allTotal, cur);
  $("#sCount").textContent = String(receipts.length);
  $("#sTax").textContent = formatMoney(taxTotal, cur);
  $("#fTotal").textContent = formatMoney(stats.allTotal, cur);

  // category chips
  const brk = categoryBreakdown(receipts, cur, cats);
  $("#cats").innerHTML = brk.items.length
    ? brk.items.map((it) =>
        `<span class="cat"><span class="dot" style="background:${it.color}"></span>${escapeHtml(it.name)} <b>${formatMoney(it.total, cur)}</b> · ${(it.pct * 100).toFixed(0)}%</span>`
      ).join("")
    : `<span class="cat">No data yet</span>`;

  // table rows
  $("#rows").innerHTML = rows.map((r) => {
    const c = categoryById(r.category, cats);
    return `<tr>
      <td>${escapeHtml(formatDate(r.date))}</td>
      <td class="merch">${escapeHtml(r.merchant || "—")}${r.note ? `<div style="font-weight:400;color:#8a94a2;font-size:11px;margin-top:2px">${escapeHtml(r.note)}</div>` : ""}</td>
      <td><span class="pill"><span class="dot" style="background:${c.color}"></span>${escapeHtml(c.name)}</span></td>
      <td class="num">${r.tax != null ? escapeHtml(formatMoney(r.tax, r.currency)) : "—"}</td>
      <td class="num">${escapeHtml(formatMoney(r.amount, r.currency))}</td>
    </tr>`;
  }).join("") || `<tr><td colspan="5" style="text-align:center;color:#8a94a2;padding:24px">No receipts to report yet.</td></tr>`;

  $("#genAt").textContent = `Generated ${new Date().toLocaleString()}`;

  $("#printBtn").onclick = () => window.print();
  $("#closeBtn").onclick = () => window.close();
})();
