// Glean — local analytics: streaks, duplicates, monthly series, category breakdown,
// smart amount-search parsing, and tiny theme-aware SVG charts. All pure functions,
// computed on-device from the receipts array (nothing leaves the browser).

import { categoryById } from "./categories.js";
import { escapeHtml } from "./util.js";

const DAY = 86400000;
const dayDiff = (a, b) => Math.round((new Date(b) - new Date(a)) / DAY);
const monthKey = (d) => d.getFullYear() + "-" + d.getMonth();
const todayISO = () => new Date().toISOString().slice(0, 10);

/* ---------- Logging streak (free) ---------- */
// current = consecutive days up to the most recent activity (alive if last log was
// today or yesterday); best = longest run ever. Deduped to unique dates first.
export function computeStreak(receipts) {
  const days = [...new Set(receipts.map((r) => r.date).filter(Boolean))].sort();
  if (!days.length) return { current: 0, best: 0 };
  let best = 1, run = 1;
  for (let i = 1; i < days.length; i++) {
    if (dayDiff(days[i - 1], days[i]) === 1) { run++; best = Math.max(best, run); }
    else run = 1;
  }
  let current = 1;
  for (let i = days.length - 1; i > 0; i--) {
    if (dayDiff(days[i - 1], days[i]) === 1) current++; else break;
  }
  if (dayDiff(days[days.length - 1], todayISO()) > 1) current = 0; // streak broken
  return { current, best };
}

/* ---------- Duplicate detection (free) ---------- */
// Flags receipts sharing merchant + currency + amount within a 7-day window.
// Grouped by key first so it stays cheap even with many receipts.
export function findDuplicates(receipts, windowDays = 7) {
  const groups = new Map();
  for (const r of receipts) {
    const key = (r.merchant || "").trim().toLowerCase() + "|" + r.currency + "|" + Math.round(Number(r.amount) * 100);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(r);
  }
  const dupes = new Set();
  for (const group of groups.values()) {
    if (group.length < 2) continue;
    const sorted = group.filter((r) => r.date).sort((a, b) => new Date(a.date) - new Date(b.date));
    for (let i = 1; i < sorted.length; i++) {
      if (Math.abs(dayDiff(sorted[i - 1].date, sorted[i].date)) <= windowDays) {
        dupes.add(sorted[i - 1].id); dupes.add(sorted[i].id);
      }
    }
  }
  return dupes;
}

/* ---------- Smart amount search (free) ---------- */
// Turns ">50", "under 20", "10-40" into a predicate. Returns null for plain text
// so the caller falls back to normal merchant/note search.
export function parseAmountQuery(q) {
  const s = (q || "").trim().toLowerCase().replace(/[$,]/g, "");
  let m;
  if ((m = s.match(/^(>=|<=|>|<)\s*(\d+(?:\.\d+)?)$/))) {
    const v = +m[2], op = m[1];
    const test = op === ">" ? (a) => a > v : op === "<" ? (a) => a < v : op === ">=" ? (a) => a >= v : (a) => a <= v;
    return { test, label: `${op} ${v}` };
  }
  if ((m = s.match(/^(?:over|above|more than)\s*(\d+(?:\.\d+)?)$/))) { const v = +m[1]; return { test: (a) => a > v, label: `> ${v}` }; }
  if ((m = s.match(/^(?:under|below|less than)\s*(\d+(?:\.\d+)?)$/))) { const v = +m[1]; return { test: (a) => a < v, label: `< ${v}` }; }
  if ((m = s.match(/^(\d+(?:\.\d+)?)\s*-\s*(\d+(?:\.\d+)?)$/))) { const lo = +m[1], hi = +m[2]; return { test: (a) => a >= lo && a <= hi, label: `${lo}–${hi}` }; }
  return null;
}

/* ---------- Monthly spend series (Pro chart) ---------- */
export function monthlySeries(receipts, currency, months = 6) {
  const now = new Date();
  const out = [];
  for (let i = months - 1; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    out.push({ key: monthKey(d), label: d.toLocaleDateString(undefined, { month: "short" }), total: 0 });
  }
  const idx = new Map(out.map((o, i) => [o.key, i]));
  for (const r of receipts) {
    if (r.currency !== currency) continue;
    const d = new Date(r.date);
    if (isNaN(d)) continue;
    const k = monthKey(d);
    if (idx.has(k)) out[idx.get(k)].total += Number(r.amount) || 0;
  }
  return out;
}

/* ---------- Category breakdown (Pro chart) ---------- */
export function categoryBreakdown(receipts, currency, categories, { monthOnly = false } = {}) {
  const mKey = monthKey(new Date());
  const totals = new Map();
  let sum = 0;
  for (const r of receipts) {
    if (r.currency !== currency) continue;
    if (monthOnly) {
      const d = new Date(r.date);
      if (isNaN(d) || monthKey(d) !== mKey) continue;
    }
    totals.set(r.category, (totals.get(r.category) || 0) + (Number(r.amount) || 0));
    sum += Number(r.amount) || 0;
  }
  const items = [...totals.entries()].map(([id, total]) => {
    const c = categoryById(id, categories);
    return { id, name: c.name, color: c.color, total, pct: sum ? total / sum : 0 };
  }).sort((a, b) => b.total - a.total);
  return { items, total: sum };
}

// Top N categories with the remainder folded into a grey "Other" slice.
export function topCategories(breakdown, n = 6) {
  const top = breakdown.items.slice(0, n);
  const rest = breakdown.items.slice(n);
  if (rest.length) {
    const total = rest.reduce((s, i) => s + i.total, 0);
    top.push({ id: "_rest", name: "Other", color: "#9aa3af", total, pct: breakdown.total ? total / breakdown.total : 0 });
  }
  return top;
}

/* ---------- Tiny SVG charts (theme-aware via CSS vars) ---------- */
export function barChartSVG(series, fmt) {
  const W = 320, H = 150, pad = 18, gap = 10;
  const max = Math.max(1, ...series.map((s) => s.total));
  const n = series.length;
  const bw = (W - pad * 2 - gap * (n - 1)) / n;
  const baseY = H - 22;
  let out = `<line x1="${pad}" y1="${baseY + 0.5}" x2="${W - pad}" y2="${baseY + 0.5}" stroke="var(--border)" stroke-width="1"/>`;
  series.forEach((s, i) => {
    const h = Math.max(2, (s.total / max) * (baseY - 14));
    const x = pad + i * (bw + gap), y = baseY - h;
    const last = i === n - 1;
    out += `<rect x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${bw.toFixed(1)}" height="${h.toFixed(1)}" rx="5" fill="var(--accent)" opacity="${last ? 1 : 0.5}"><title>${escapeHtml(s.label)}: ${escapeHtml(fmt(s.total))}</title></rect>`;
    out += `<text x="${(x + bw / 2).toFixed(1)}" y="${H - 6}" text-anchor="middle" font-size="10" fill="var(--text-faint)">${escapeHtml(s.label)}</text>`;
  });
  return `<svg viewBox="0 0 ${W} ${H}" width="100%" height="auto" role="img" aria-label="Spending over time">${out}</svg>`;
}

export function donutSVG(items) {
  const R = 46, C = 2 * Math.PI * R, cx = 60, cy = 60, sw = 16;
  let off = 0, segs = "";
  for (const it of items) {
    if (it.pct <= 0) continue;
    const len = it.pct * C;
    segs += `<circle cx="${cx}" cy="${cy}" r="${R}" fill="none" stroke="${it.color}" stroke-width="${sw}" stroke-linecap="butt" stroke-dasharray="${len.toFixed(2)} ${(C - len).toFixed(2)}" stroke-dashoffset="${(-off).toFixed(2)}" transform="rotate(-90 ${cx} ${cy})"><title>${escapeHtml(it.name)}: ${(it.pct * 100).toFixed(0)}%</title></circle>`;
    off += len;
  }
  if (!segs) segs = `<circle cx="${cx}" cy="${cy}" r="${R}" fill="none" stroke="var(--surface-3)" stroke-width="${sw}"/>`;
  return `<svg viewBox="0 0 120 120" width="116" height="116" role="img" aria-label="Spending by category">${segs}</svg>`;
}
