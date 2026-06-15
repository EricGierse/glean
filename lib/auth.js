// Glean — authentication (session gate). Users must sign in before using the popup.
//
// Providers:
//   • Email (fully functional): we POST to the Worker, which emails a 6-digit code and
//     returns a signed {exp, sig}. The user types the code; /auth/verify re-derives the
//     HMAC and returns a session token. No password, no DB. If the backend is unreachable
//     OR not configured, email falls back to a local demo session (any 6 digits).
//   • Google: real via chrome.identity.getAuthToken once you set oauth2.client_id in
//     manifest.json. Until then it falls back to a working demo session.
//
// The session is stored locally (with the backend token when present).

import { SCAN_PROXY_URL } from "./scan.js";

const KEY = "glean_auth";
const area = chrome.storage.local;
const API = SCAN_PROXY_URL; // same Worker also hosts /auth/*
const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

export async function getSession() {
  const r = await area.get(KEY);
  return r[KEY] || null;
}
async function setSession(s) { await area.set({ [KEY]: s }); return s; }
export async function signOut() { await area.remove(KEY); }

/* ---------- Google ---------- */
export async function signInWithGoogle() {
  try {
    if (chrome.identity && chrome.identity.getAuthToken) {
      const token = await new Promise((resolve, reject) =>
        chrome.identity.getAuthToken({ interactive: true }, (t) =>
          chrome.runtime.lastError ? reject(chrome.runtime.lastError) : resolve(t)));
      if (token) {
        const info = await (await fetch("https://www.googleapis.com/oauth2/v3/userinfo", {
          headers: { Authorization: "Bearer " + token },
        })).json();
        return { ok: true, session: await setSession({ provider: "google", email: info.email, name: info.name || info.email, picture: info.picture, at: Date.now() }) };
      }
    }
  } catch (e) {
    console.warn("[Glean] Google sign-in fell back to demo (set oauth2.client_id in manifest.json):", e?.message || e);
  }
  return { ok: true, demo: true, session: await setSession({ provider: "google", email: "you@gmail.com", name: "Google user", at: Date.now(), demo: true }) };
}

/* ---------- Email: step 1 — request a code ---------- */
export async function requestEmailCode(email) {
  const e = (email || "").trim().toLowerCase();
  if (!EMAIL_RE.test(e)) return { ok: false, error: "Enter a valid email address" };
  if (!API) return { ok: true, demo: true, email: e }; // no backend → demo flow
  try {
    const res = await fetch(`${API}/auth/request`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: e }),
    });
    const d = await res.json().catch(() => ({}));
    if (!res.ok || !d.ok) return { ok: false, error: d.error || "Couldn't send the code — try again" };
    return { ok: true, email: e, exp: d.exp, sig: d.sig, emailed: d.emailed, devCode: d.devCode };
  } catch { return { ok: false, error: "Network error — check your connection" }; }
}

/* ---------- Email: step 2 — verify the code ---------- */
export async function verifyEmailCode({ email, code, exp, sig, demo } = {}) {
  const e = (email || "").trim().toLowerCase();
  const c = (code || "").trim();
  if (!/^\d{6}$/.test(c)) return { ok: false, error: "Enter the 6-digit code" };
  if (demo || !API) {
    return { ok: true, demo: true, session: await setSession({ provider: "email", email: e, name: e.split("@")[0], at: Date.now(), demo: true }) };
  }
  try {
    const res = await fetch(`${API}/auth/verify`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: e, code: c, exp, sig }),
    });
    const d = await res.json().catch(() => ({}));
    if (!res.ok || !d.ok) {
      return { ok: false, error: d.error === "expired" ? "That code expired — tap Resend" : "Incorrect code — try again" };
    }
    return { ok: true, session: await setSession({ provider: "email", email: d.user.email, name: d.user.name, token: d.token, at: Date.now() }) };
  } catch { return { ok: false, error: "Network error — check your connection" }; }
}

export const providerLabel = (p) => ({ google: "Google", apple: "Apple", email: "Email" }[p] || "account");
