// Glean — storage layer (chrome.storage.local). Local-first: nothing leaves the device.
import { DEFAULT_CATEGORIES } from "./categories.js";
import { uid } from "./util.js";

const KEYS = { settings: "glean_settings", license: "glean_license", receipts: "glean_receipts" };

export const DEFAULT_SETTINGS = {
  theme: "system",          // system | light | dark
  accent: "#10b981",
  animations: "full",       // full | reduced | off
  density: "comfortable",   // comfortable | compact
  currency: "USD",
  dateFormat: "medium",     // medium | short | iso
  autoCapture: true,        // show in-page "found a receipt" prompt (Pro)
  captureToast: true,
  geminiApiKey: "",         // user's Gemini API key for AI receipt scan (Pro)
  blocklist: [],            // hostnames to never scan
  categories: DEFAULT_CATEGORIES.map(({ id, name, color, keywords }) => ({ id, name, color, keywords })),
  onboarded: false,
};

const area = chrome.storage.local;

async function read(key, fallback) {
  const r = await area.get(key);
  return r[key] === undefined ? fallback : r[key];
}

/* ---------- Settings ---------- */
export async function getSettings() {
  const s = await read(KEYS.settings, {});
  return { ...DEFAULT_SETTINGS, ...s, categories: s.categories?.length ? s.categories : DEFAULT_SETTINGS.categories };
}
export async function saveSettings(patch) {
  const cur = await getSettings();
  const next = { ...cur, ...patch };
  await area.set({ [KEYS.settings]: next });
  return next;
}

/* ---------- Receipts ---------- */
export async function getReceipts() {
  return read(KEYS.receipts, []);
}
async function setReceipts(list) {
  await area.set({ [KEYS.receipts]: list });
  return list;
}
export async function addReceipt(partial) {
  const list = await getReceipts();
  const r = {
    id: uid(),
    merchant: (partial.merchant || "Unknown merchant").trim(),
    amount: Number(partial.amount) || 0,
    currency: partial.currency || (await getSettings()).currency,
    date: partial.date || new Date().toISOString().slice(0, 10),
    category: partial.category || "other",
    note: partial.note || "",
    tax: partial.tax != null ? Number(partial.tax) : null,
    source: partial.source || "manual",
    url: partial.url || "",
    createdAt: Date.now(),
  };
  // de-dupe: same merchant + amount + date captured automatically
  const dupe = list.find(
    (x) => x.source !== "manual" && x.merchant === r.merchant &&
      Math.abs(x.amount - r.amount) < 0.005 && x.date === r.date
  );
  if (dupe) return { receipt: dupe, duplicate: true };
  await setReceipts([r, ...list]);
  return { receipt: r, duplicate: false };
}
export async function updateReceipt(id, patch) {
  const list = await getReceipts();
  const next = list.map((r) => (r.id === id ? { ...r, ...patch, amount: patch.amount != null ? Number(patch.amount) : r.amount } : r));
  return setReceipts(next);
}
export async function deleteReceipt(id) {
  const list = await getReceipts();
  return setReceipts(list.filter((r) => r.id !== id));
}
export async function clearReceipts() {
  return setReceipts([]);
}
export async function importReceipts(arr, { replace = false } = {}) {
  const cur = replace ? [] : await getReceipts();
  const cleaned = arr.filter((r) => r && (r.amount != null)).map((r) => ({
    id: r.id || uid(), merchant: r.merchant || "Unknown", amount: Number(r.amount) || 0,
    currency: r.currency || "USD", date: r.date || new Date().toISOString().slice(0, 10),
    category: r.category || "other", note: r.note || "", tax: r.tax ?? null,
    source: r.source || "import", url: r.url || "", createdAt: r.createdAt || Date.now(),
  }));
  return setReceipts([...cleaned, ...cur]);
}

/* ---------- License ---------- */
export async function getLicense() {
  return read(KEYS.license, null);
}
export async function saveLicense(patch) {
  const cur = (await getLicense()) || {};
  const next = { ...cur, ...patch };
  await area.set({ [KEYS.license]: next });
  return next;
}

/* ---------- Reactivity ---------- */
export function onChanged(cb) {
  const handler = (changes, areaName) => {
    if (areaName !== "local") return;
    const relevant = Object.keys(changes).some((k) => Object.values(KEYS).includes(k));
    if (relevant) cb(changes);
  };
  chrome.storage.onChanged.addListener(handler);
  return () => chrome.storage.onChanged.removeListener(handler);
}

/* ---------- Stats ---------- */
export function computeStats(receipts, primaryCurrency = "USD") {
  const now = new Date();
  const mKey = now.getFullYear() + "-" + now.getMonth();
  let monthTotal = 0, monthCount = 0, allTotal = 0;
  const byCat = {}; // this-month spend per category, in the primary currency
  for (const r of receipts) {
    const match = r.currency === primaryCurrency;
    if (match) allTotal += r.amount;
    const d = new Date(r.date);
    if (!isNaN(d) && d.getFullYear() + "-" + d.getMonth() === mKey) {
      monthCount++;
      if (match) { monthTotal += r.amount; byCat[r.category] = (byCat[r.category] || 0) + r.amount; }
    }
  }
  const topCategory = Object.entries(byCat).sort((a, b) => b[1] - a[1])[0]?.[0] || null;
  return { count: receipts.length, monthTotal, monthCount, allTotal, byCat, topCategory };
}

export { KEYS };
