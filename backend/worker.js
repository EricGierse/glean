// Glean backend — Cloudflare Worker.
//
// Two responsibilities, routed by path:
//   • POST /              (or /scan)   → AI receipt scan via Gemini (your key, server-side)
//   • POST /auth/request  { email }    → email a 6-digit verification code (stateless OTP)
//   • POST /auth/verify   { email, code, exp, sig } → check code, return a session token
//
// Secrets (set with `wrangler secret put <NAME>`):
//   GEMINI_API_KEY  – paid Google Generative Language key (required for scanning)
//   AUTH_SECRET     – random 64-hex string; signs the OTP + session tokens (required for auth)
//   RESEND_API_KEY  – optional; when set, codes are emailed via Resend (https://resend.com)
//   MAIL_FROM       – optional; e.g. "Glean <login@yourdomain.com>" (defaults to resend.dev)
//   DEV_AUTH        – optional; "1" returns the code in the response so you can test without email
//
// The OTP is STATELESS: /auth/request returns { exp, sig } (an HMAC of email+code+exp); the
// client sends them back with the code to /auth/verify, which re-derives the HMAC. No DB/KV.

const MODEL = "gemini-2.0-flash";
const CODE_TTL_MS = 10 * 60 * 1000;        // codes valid for 10 minutes
const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

const DEFAULT_CATS = [
  { id: "software", name: "Software & SaaS" }, { id: "advertising", name: "Advertising" },
  { id: "travel", name: "Travel" }, { id: "meals", name: "Meals & Entertainment" },
  { id: "office", name: "Office & Supplies" }, { id: "hardware", name: "Hardware & Equipment" },
  { id: "fees", name: "Fees & Banking" }, { id: "education", name: "Education" },
  { id: "utilities", name: "Utilities & Internet" }, { id: "other", name: "Other" },
];

const CORS = {
  "Access-Control-Allow-Origin": "*", // TODO: lock to chrome-extension://<your-id> before launch
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
};

export default {
  async fetch(request, env) {
    if (request.method === "OPTIONS") return new Response(null, { headers: CORS });
    if (request.method !== "POST") return json({ error: "POST only" }, 405);

    const path = new URL(request.url).pathname.replace(/\/+$/, "");
    let body;
    try { body = await request.json(); } catch { return json({ error: "bad json" }, 400); }

    if (path === "/auth/request") return authRequest(body, env);
    if (path === "/auth/verify") return authVerify(body, env);
    return scan(body, env); // "" (root) or "/scan"
  },
};

/* ===================== AI receipt scan ===================== */
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

async function scan(body, env) {
  const { base64, mimeType, categories } = body || {};
  if (!base64) return json({ error: "no image" }, 400);
  if (!env.GEMINI_API_KEY) return json({ error: "no-key" }, 500);

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
  } catch { return json({ error: "upstream network" }, 502); }

  if (!r.ok) {
    let detail = "";
    try { detail = (await r.json())?.error?.message || ""; } catch { /* ignore */ }
    return json({ error: "gemini", status: r.status, detail: detail.slice(0, 300) }, 502);
  }
  const data = await r.json().catch(() => null);
  const text = data?.candidates?.[0]?.content?.parts?.[0]?.text || "{}";
  return new Response(text, { headers: { ...CORS, "Content-Type": "application/json" } });
}

/* ===================== Email verification (stateless OTP) ===================== */
async function authRequest(body, env) {
  if (!env.AUTH_SECRET) return json({ error: "auth not configured" }, 500);
  const email = String(body?.email || "").trim().toLowerCase();
  if (!EMAIL_RE.test(email)) return json({ ok: false, error: "Enter a valid email address" }, 400);

  const code = genCode();
  const exp = Date.now() + CODE_TTL_MS;
  const sig = await hmacHex(env.AUTH_SECRET, `${email}.${code}.${exp}`);
  const { sent, reason } = await sendCodeEmail(env, email, code);

  const res = { ok: true, exp, sig, emailed: sent };
  if (!sent) res.emailError = reason; // surface why email failed (never contains secrets)
  if (env.DEV_AUTH === "1") res.devCode = code;
  return json(res, 200);
}

async function authVerify(body, env) {
  if (!env.AUTH_SECRET) return json({ error: "auth not configured" }, 500);
  const email = String(body?.email || "").trim().toLowerCase();
  const code = String(body?.code || "").trim();
  const exp = Number(body?.exp || 0);
  const sig = String(body?.sig || "");
  if (!EMAIL_RE.test(email) || !/^\d{6}$/.test(code)) return json({ ok: false, error: "invalid" }, 400);
  if (Date.now() > exp) return json({ ok: false, error: "expired" }, 400);

  const expected = await hmacHex(env.AUTH_SECRET, `${email}.${code}.${exp}`);
  if (!safeEq(expected, sig)) return json({ ok: false, error: "invalid" }, 401);

  // Issue a stateless session token the backend can later verify (e.g. to gate scans).
  const iat = Date.now();
  const tsig = await hmacHex(env.AUTH_SECRET, `${email}.${iat}`);
  const token = b64url(`${email}|${iat}|${tsig}`);
  return json({ ok: true, token, user: { email, name: email.split("@")[0] } }, 200);
}

async function sendCodeEmail(env, email, code) {
  if (!env.RESEND_API_KEY) return { sent: false, reason: "no-key" };
  const from = env.MAIL_FROM || "Glean <onboarding@resend.dev>";
  const html = `
    <div style="font-family:-apple-system,Segoe UI,Roboto,sans-serif;max-width:420px;margin:auto;padding:8px">
      <div style="font-size:20px;font-weight:800;color:#0A9B70">Glean</div>
      <p style="color:#444;font-size:14px">Enter this code to finish signing in:</p>
      <div style="font-size:34px;font-weight:800;letter-spacing:8px;background:#E9FBF3;color:#0A9B70;
                  padding:16px;border-radius:12px;text-align:center">${code}</div>
      <p style="color:#888;font-size:12px">This code expires in 10 minutes. If you didn't request it, ignore this email.</p>
    </div>`;
  try {
    const r = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: "Bearer " + env.RESEND_API_KEY, "Content-Type": "application/json" },
      body: JSON.stringify({ from, to: [email], subject: `${code} is your Glean code`,
        html, text: `Your Glean verification code is ${code}. It expires in 10 minutes.` }),
    });
    if (r.ok) return { sent: true };
    const d = await r.json().catch(() => ({}));
    return { sent: false, reason: d?.name || d?.message || `resend-${r.status}` };
  } catch (e) { return { sent: false, reason: e?.message || "network" }; }
}

/* ===================== helpers ===================== */
function genCode() {
  const a = new Uint32Array(1); crypto.getRandomValues(a);
  return String(a[0] % 1000000).padStart(6, "0");
}
async function hmacHex(secret, msg) {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(msg));
  return [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, "0")).join("");
}
function safeEq(a, b) {
  if (a.length !== b.length) return false;
  let r = 0; for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return r === 0;
}
function b64url(s) { return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, ""); }
function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), { status, headers: { ...CORS, "Content-Type": "application/json" } });
}
