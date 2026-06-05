// Glean scan proxy — Cloudflare Worker.
//
// Holds your ONE paid Gemini key server-side so every client scans with no key and no
// free-tier limits. Clients POST { base64, mimeType }; this returns the parsed JSON.
//
// Deploy in ~3 min: see backend/README.md.  Your key lives in the GEMINI_API_KEY secret,
// never in the extension. Cost is ~$0.0002 per scan (pay-as-you-go on your Google billing).

const MODEL = "gemini-2.0-flash";
const VALID = ["software", "advertising", "travel", "meals", "office", "hardware", "fees", "education", "utilities", "other"];
const PROMPT = `You are a precise receipt parser. Read the receipt in the image and reply with ONLY compact JSON (no prose, no markdown) using exactly these keys:
{"merchant": string, "amount": number, "currency": string (ISO 4217 like USD), "date": string (YYYY-MM-DD), "category": one of ${JSON.stringify(VALID)}, "confidence": number between 0 and 1}
"amount" is the grand total actually paid. "category" is your best classification of what was purchased. If a field is unreadable, give your best guess.`;

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
    const { base64, mimeType } = body || {};
    if (!base64) return json({ error: "no image" }, 400, cors);

    let r;
    try {
      r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent?key=${env.GEMINI_API_KEY}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [{ parts: [{ text: PROMPT }, { inline_data: { mime_type: mimeType || "image/jpeg", data: base64 } }] }],
          generationConfig: { temperature: 0, responseMimeType: "application/json" },
        }),
      });
    } catch {
      return json({ error: "upstream network" }, 502, cors);
    }
    if (!r.ok) return json({ error: "gemini", status: r.status }, 502, cors);

    const data = await r.json().catch(() => null);
    const text = data?.candidates?.[0]?.content?.parts?.[0]?.text || "{}";
    return new Response(text, { headers: { ...cors, "Content-Type": "application/json" } });
  },
};

function json(obj, status, cors) {
  return new Response(JSON.stringify(obj), { status, headers: { ...cors, "Content-Type": "application/json" } });
}
