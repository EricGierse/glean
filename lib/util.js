// Glean — shared helpers (ES module, used by popup + options)

export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

export function el(tag, props = {}, ...children) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (k === "class") node.className = v;
    else if (k === "html") node.innerHTML = v;
    else if (k === "dataset") Object.assign(node.dataset, v);
    else if (k.startsWith("on") && typeof v === "function") node.addEventListener(k.slice(2), v);
    else if (v !== null && v !== undefined && v !== false) node.setAttribute(k, v);
  }
  for (const c of children.flat()) {
    if (c == null || c === false) continue;
    node.append(c.nodeType ? c : document.createTextNode(c));
  }
  return node;
}

export const uid = () =>
  "r_" + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);

export function escapeHtml(s = "") {
  return String(s).replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

const CURRENCY_SYMBOLS = {
  USD: "$", EUR: "€", GBP: "£", BRL: "R$", JPY: "¥",
  CAD: "C$", AUD: "A$", INR: "₹", CHF: "CHF", MXN: "MX$",
};
export const currencySymbol = (c) => CURRENCY_SYMBOLS[c] || (c ? c + " " : "$");

export function formatMoney(amount, currency = "USD") {
  const n = Number(amount) || 0;
  try {
    return new Intl.NumberFormat(undefined, {
      style: "currency", currency, maximumFractionDigits: 2,
    }).format(n);
  } catch {
    return currencySymbol(currency) + n.toFixed(2);
  }
}

export function formatDate(iso, fmt = "medium") {
  if (!iso) return "—";
  const d = new Date(iso);
  if (isNaN(d)) return "—";
  if (fmt === "iso") return d.toISOString().slice(0, 10);
  if (fmt === "short") return d.toLocaleDateString(undefined, { month: "numeric", day: "numeric", year: "2-digit" });
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}

export const todayISO = () => new Date().toISOString().slice(0, 10);

export function relativeDay(iso) {
  const d = new Date(iso);
  const days = Math.round((Date.now() - d.getTime()) / 86400000);
  if (days <= 0) return "Today";
  if (days === 1) return "Yesterday";
  if (days < 7) return days + " days ago";
  return formatDate(iso, "short");
}

export function debounce(fn, ms = 200) {
  let t;
  return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); };
}

// Animated number count-up (respects reduced-motion / anim-off automatically via duration)
export function animateCount(node, to, { duration = 700, format = (v) => v.toFixed(0) } = {}) {
  const noAnim = document.documentElement.classList.contains("anim-off");
  const from = Number(node.dataset.value || 0);
  node.dataset.value = to;
  if (noAnim || duration <= 0 || from === to) { node.textContent = format(to); return; }
  const start = performance.now();
  const ease = (t) => 1 - Math.pow(1 - t, 3);
  function frame(now) {
    const t = Math.min(1, (now - start) / duration);
    node.textContent = format(from + (to - from) * ease(t));
    if (t < 1) requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
}

// Stagger entrance animation across a set of freshly-rendered nodes
export function stagger(nodes, step = 32) {
  nodes.forEach((n, i) => {
    n.classList.add("enter");
    n.style.animationDelay = i * step + "ms";
  });
}

/* ----- color helpers (for custom accent) ----- */
export function hexToRgb(hex) {
  const h = hex.replace("#", "");
  const v = h.length === 3 ? h.split("").map((c) => c + c).join("") : h;
  return [0, 2, 4].map((i) => parseInt(v.slice(i, i + 2), 16));
}
export function mix(hex, withHex, amt) {
  const a = hexToRgb(hex), b = hexToRgb(withHex);
  const c = a.map((v, i) => Math.round(v + (b[i] - v) * amt));
  return "#" + c.map((v) => v.toString(16).padStart(2, "0")).join("");
}
export function rgba(hex, alpha) {
  const [r, g, b] = hexToRgb(hex);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

// Apply an accent color across the document (derives strong + soft variants)
export function applyAccent(hex) {
  const root = document.documentElement.style;
  root.setProperty("--accent", hex);
  root.setProperty("--accent-strong", mix(hex, "#000000", 0.18));
  root.setProperty("--accent-soft", rgba(hex, 0.12));
  // pick readable contrast for accent buttons
  const [r, g, b] = hexToRgb(hex);
  const lum = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  root.setProperty("--accent-contrast", lum > 0.62 ? "#10241c" : "#ffffff");
}
