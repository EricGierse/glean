// Glean — authentication (session gate). Users must sign in before using the popup.
//
// Sign-in providers: Google, Apple, Email.
//   • Google: real via chrome.identity.getAuthToken when you set an OAuth client_id in
//     manifest.json ("oauth2"). Until then it falls back to a working demo session.
//   • Apple: real path is chrome.identity.launchWebAuthFlow + a backend code exchange
//     (needs the $99/yr Apple Developer Program). Demo session for now.
//   • Email: real path POSTs to your backend (magic link / password). Demo session now.
//
// The session is stored locally. Replace the demo branches with calls to your backend so
// the account is real (and so it can carry the Stripe subscription + scan quota).

const KEY = "glean_auth";
const area = chrome.storage.local;

export async function getSession() {
  const r = await area.get(KEY);
  return r[KEY] || null;
}
async function setSession(s) { await area.set({ [KEY]: s }); return s; }
export async function signOut() { await area.remove(KEY); }

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

export async function signInWithApple() {
  // TODO production: chrome.identity.launchWebAuthFlow → Apple → backend exchanges the code.
  return { ok: true, demo: true, session: await setSession({ provider: "apple", email: "you@privaterelay.appleid.com", name: "Apple user", at: Date.now(), demo: true }) };
}

export async function signInWithEmail(email) {
  const e = (email || "").trim();
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(e)) return { ok: false, error: "Enter a valid email address" };
  // TODO production: POST to your backend to send a magic link / verify a password.
  return { ok: true, demo: true, session: await setSession({ provider: "email", email: e, name: e.split("@")[0], at: Date.now(), demo: true }) };
}

export const providerLabel = (p) => ({ google: "Google", apple: "Apple", email: "Email" }[p] || "account");
