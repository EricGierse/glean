// Glean — AI receipt scanning via Google Gemini 2.0 Flash (the headline Pro feature).
//
// TWO modes:
//   1) PRODUCTION (best client experience): set SCAN_PROXY_URL to your deployed backend
//      (see /backend). Your server holds ONE paid Gemini key, so every client scans with
//      NO key to enter and NO free-tier limits. You pay ~$0.0002/scan.
//   2) DEV / personal: leave SCAN_PROXY_URL empty and the user pastes their own Gemini key
//      in Settings (per-user free-tier limits apply). Good for testing only.
//
// Free key to test: https://aistudio.google.com/apikey

// ⬇️ Set this to your deployed Worker URL to give clients the keyless, no-limits experience.
export const SCAN_PROXY_URL = "https://glean-worker.ericbottchergierse.workers.dev";

const ENDPOINT = "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent";

// Fallback category set (matches lib/categories.js) used only if the caller doesn't
// pass the user's live categories. The AI is always told to pick one of these ids.
const DEFAULT_CATS = [
  { id: "software", name: "Software & SaaS" }, { id: "advertising", name: "Advertising" },
  { id: "travel", name: "Travel" }, { id: "meals", name: "Meals & Entertainment" },
  { id: "office", name: "Office & Supplies" }, { id: "hardware", name: "Hardware & Equipment" },
  { id: "fees", name: "Fees & Banking" }, { id: "education", name: "Education" },
  { id: "utilities", name: "Utilities & Internet" }, { id: "other", name: "Other" },
];

// Normalise whatever the caller passes into a clean [{id,name}] list with an "other" fallback.
function cleanCats(categories) {
  const list = (Array.isArray(categories) ? categories : [])
    .filter((c) => c && c.id)
    .map((c) => ({ id: String(c.id), name: String(c.name || c.id) }));
  const cats = list.length ? list : DEFAULT_CATS;
  if (!cats.some((c) => c.id === "other")) cats.push({ id: "other", name: "Other" });
  return cats;
}

// Build the parser prompt so the AI classifies into the user's OWN categories (by id).
function buildPrompt(cats) {
  const choices = cats.map((c) => `"${c.id}" = ${c.name}`).join(", ");
  return `You are a precise receipt parser. Read the receipt in the image and reply with ONLY compact JSON (no prose, no markdown) using exactly these keys:
{"merchant": string, "amount": number, "currency": string (ISO 4217 like USD), "date": string (YYYY-MM-DD), "category": string, "confidence": number between 0 and 1}
"amount" is the grand total actually paid.
"category" MUST be exactly one of these ids based on what was purchased: ${choices}. Pick the single best fit; use "other" only if nothing matches.
If a field is unreadable, give your best guess.`;
}

export async function scanReceipt({ base64, mimeType = "image/jpeg", apiKey, categories }) {
  const cats = cleanCats(categories);
  const validIds = cats.map((c) => c.id);

  // Mode 1: backend proxy (clients need no key, no free-tier limits).
  // We send the category list so the server-side prompt classifies into the user's set.
  if (SCAN_PROXY_URL) {
    let res;
    try {
      res = await fetch(SCAN_PROXY_URL, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ base64, mimeType, categories: cats }),
      });
    } catch { return { ok: false, error: "network" }; }
    if (!res.ok) return { ok: false, error: "api", status: res.status };
    const text = await res.text().catch(() => "");
    const parsed = tryParse(text);
    return parsed ? { ok: true, receipt: normalize(parsed, validIds) } : { ok: false, error: "parse", raw: text };
  }

  // Mode 2: direct call with a key (dev/personal only; production uses SCAN_PROXY_URL)
  if (!apiKey) {
    console.warn("[Glean] Scanning needs SCAN_PROXY_URL set in lib/scan.js — deploy backend/ (see backend/README.md).");
    return { ok: false, error: "no-key" };
  }
  const body = {
    contents: [{ parts: [{ text: buildPrompt(cats) }, { inline_data: { mime_type: mimeType, data: base64 } }] }],
    generationConfig: { temperature: 0, responseMimeType: "application/json" },
  };
  let res;
  try {
    res = await fetch(`${ENDPOINT}?key=${encodeURIComponent(apiKey)}`, {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
    });
  } catch { return { ok: false, error: "network" }; }
  if (!res.ok) {
    let detail = "";
    try { detail = (await res.json())?.error?.message || ""; } catch { /* ignore */ }
    return { ok: false, error: "api", status: res.status, detail };
  }
  let text = "";
  try {
    const data = await res.json();
    text = data?.candidates?.[0]?.content?.parts?.[0]?.text || "";
  } catch { return { ok: false, error: "parse" }; }
  const parsed = tryParse(text);
  return parsed ? { ok: true, receipt: normalize(parsed, validIds) } : { ok: false, error: "parse", raw: text };
}

function tryParse(text) {
  try { return JSON.parse(text); } catch { /* try to extract */ }
  const m = text.match(/\{[\s\S]*\}/);
  if (m) { try { return JSON.parse(m[0]); } catch { /* ignore */ } }
  return null;
}

function normalize(p, validIds = DEFAULT_CATS.map((c) => c.id)) {
  let cat = String(p.category || "other").toLowerCase().trim();
  if (!validIds.includes(cat)) cat = "other";
  let date = String(p.date || "").slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) date = new Date().toISOString().slice(0, 10);
  return {
    merchant: String(p.merchant || "Unknown merchant").trim().slice(0, 80),
    amount: Math.abs(Number(p.amount)) || 0,
    currency: String(p.currency || "USD").toUpperCase().slice(0, 3),
    date,
    category: cat,
    confidence: Math.max(0, Math.min(1, Number(p.confidence) || 0)),
    source: "scan",
  };
}

// File (from <input type=file>) → { base64, mimeType } for scanReceipt().
export function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => {
      const s = String(r.result);
      resolve({ base64: s.slice(s.indexOf(",") + 1), mimeType: file.type || "image/jpeg" });
    };
    r.onerror = reject;
    r.readAsDataURL(file);
  });
}

export function scanErrorMessage(res) {
  switch (res.error) {
    case "no-key": return "Receipt scanning isn't set up yet";
    case "network": return "Network error — check your connection";
    case "api": return res.status === 400 || res.status === 403 ? "Invalid or unauthorized API key" : `Scan service error (${res.status})`;
    case "parse": return "Couldn't read that receipt — try a clearer photo";
    default: return "Scan failed — try again";
  }
}
