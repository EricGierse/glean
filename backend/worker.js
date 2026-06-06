// Glean scan proxy — Cloudflare Worker.
//
// Holds your ONE paid Gemini key server-side so every client scans with no key and no
// free-tier limits. Clients POST { base64, mimeType }; this returns the parsed JSON.
//
// Deploy in ~3 min: see backend/README.md.  Your key lives in the GEMINI_API_KEY secret,
// never in the extension. Cost is ~$0.0002 per scan (pay-as-you-go on your Google billing).

const MODEL = "gemini-2.0-flash";

const DEFAULT_CATS = [
  { id: "software", name: "Software & SaaS" }, { id: "advertising", name: "Advertising" },
  { id: "travel", name: "Travel" }, { id: "meals", name: "Meals & Entertainment" },
  { id: "office", name: "Office & Supplies" }, { id: "hardware", name: "Hardware & Equipment" },
  { id: "fees", name: "Fees & Banking" }, { id: "education", name: "Education" },
  { id: "utilities", name: "Utilities & Internet" }, { id: "other", name: "Other" },
];

// Build the parser prompt so the AI classifies into the caller's OWN categories (by id).
function buildPrompt(categories) {
  let cats = (Array.isArray(categories) ? categories : [])
    .filter((c) => c && c.id)
    .map((c) => ({ id: String(c.id), name: String(c.name || c.id) }));
  if (!cats.length) cats = DEFAULT_CATS;
  if (!cats.some((c) => c.id === "other")) cats.push({ id: "other", name: "Other" });
  const choices = cats.map((c) => `"${c.id}" = ${c.name}`).join(", ");
  return `You are a precise receipt parser. Read the receipt in the image and reply with ONLY compact JSON (no prose, no markdown) using exactly these keys:
{"merchant": string, "amount": number, "currency": string (ISO 4217 like USD), "date": string (YYYY-MM-DD), "category": string, "confidence": number between 0 and 1}
"amount" is the grand total actually paid.
"category" MUST be exactly one of these ids based on what was purchased: ${choices}. Pick the single best fit; use "other" only if nothing matches.
If a field is unreadable, give your best guess.`;
}

export default {
  async fetch(request, env) {
    const cors = {
      "Access-Control-Allow-Origin": "*", // TODO: lock to your extension id: chrome-extension://<id>
      "Access-Control-Allow-Methods": "POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type, Authorization",
    };
    if (request.method === "OPTIONS") return new Response(null, { headers: cors });
    if (request.method !== "POST") return json({ error: "POST only" }, 405, cors);

    // TODO (recommended): verify the caller is a paying user before spending your quota.
    //   • Check an Authorization token issued by your auth/Stripe backend, AND
    //   • cap scans per user per month with Cloudflare KV (e.g. 300/mo) to stop abuse.

    let body;
    try { body = await request.json(); } catch { return json({ error: "bad json" }, 400, cors); }
    const { base64, mimeType, categories } = body || {};
    if (!base64) return json({ error: "no image" }, 400, cors);

    let r;
    try {
      r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent?key=${env.GEMINI_API_KEY}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [{ parts: [{ text: buildPrompt(categories) }, { inline_data: { mime_type: mimeType || "image/jpeg", data: base64 } }] }],
          generationConfig: { temperature: 0, responseMimeType: "application/json" },
        }),
      });
    } catch {
      return json({ error: "upstream network" }, 502, cors);
    }
    if (!r.ok) {
      let detail = "";
      try { detail = (await r.json())?.error?.message || ""; } catch { /* ignore */ }
      return json({ error: "gemini", status: r.status, detail: detail.slice(0, 300) }, 502, cors);
    }

    const data = await r.json().catch(() => null);
    const text = data?.candidates?.[0]?.content?.parts?.[0]?.text || "{}";
    return new Response(text, { headers: { ...cors, "Content-Type": "application/json" } });
  },
};

function json(obj, status, cors) {
  return new Response(JSON.stringify(obj), { status, headers: { ...cors, "Content-Type": "application/json" } });
}
