# Glean scan backend (Cloudflare Worker)

This tiny proxy holds your **one paid Gemini key** so every client scans receipts with
**no key to enter and no free-tier limits** — the best client experience. You pay
pay-as-you-go (~$0.0002 per scan), comfortably covered by the $4/mo Pro price.

Hosting is **free** on Cloudflare's Workers free plan (100k requests/day).

---

## Deploy in ~3 minutes

**Prereqs:** a [Cloudflare account](https://dash.cloudflare.com/sign-up) (free) and Node installed.

1. Install the CLI and log in:
   ```bash
   npm install -g wrangler
   wrangler login
   ```

2. From this `backend/` folder, create `wrangler.toml`:
   ```toml
   name = "glean-scan"
   main = "worker.js"
   compatibility_date = "2024-11-01"
   ```

3. Add your **paid** Gemini key as a secret (never committed, never in the extension):
   ```bash
   wrangler secret put GEMINI_API_KEY
   # paste your AIza... key when prompted
   ```

4. Deploy:
   ```bash
   wrangler deploy
   ```
   You'll get a URL like `https://glean-scan.<your-subdomain>.workers.dev`.

5. Put that URL in the extension: open `lib/scan.js` and set
   ```js
   export const SCAN_PROXY_URL = "https://glean-scan.<your-subdomain>.workers.dev";
   ```
   Reload the extension. Done — clients now scan with **no key and no limits**.

> Make sure billing is enabled on the Google Cloud project your key belongs to
> (https://console.cloud.google.com/billing) so you're on the paid tier (higher limits +
> your users' images are **not** used for training). Set a budget alert.

---

## Before public launch (recommended hardening)

- **Lock CORS** to your extension id (replace `*` with `chrome-extension://<your-id>`).
- **Verify the caller is a paying user**: have the extension send a token from your
  auth/Stripe backend and check it in the Worker before spending quota.
- **Cap usage per user** (e.g. 300 scans/month) with Cloudflare KV to stop abuse — generous
  enough that real users never notice, low enough that no one can run up your bill.
