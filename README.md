# Glean — Receipt & Expense Harvester 🌿

> *Glean (verb): to gather what's been left scattered.* Glean quietly collects the
> receipts, invoices and order confirmations scattered across the web into one clean,
> exportable ledger — built for freelancers and small businesses who hate bookkeeping.

A polished, **local-first** Manifest V3 Chrome extension. No account, no servers, no
data leaving your browser.

---

## ✨ What it does

- **Capture receipts four ways**
  - **Add** — quick manual entry.
  - **Right-click → "Capture selection as a receipt"** — highlight a total anywhere.
  - **Capture page** — parses the current order/invoice page (JSON-LD + heuristics).
  - **Auto-capture** *(Pro)* — a gentle prompt appears when Glean detects a receipt as you browse.
- **A clean ledger** — searchable, filterable, category-tagged, with this-month and all-time totals.
- **Export** — CSV, a **QuickBooks/Xero-friendly** accounting CSV, or a full JSON backup.
- **Auto-categorization** — vendors are sorted into Software, Travel, Meals, etc.
- **Beautiful & customizable** — light/dark/system themes, 8 accent colors + custom picker,
  full/reduced/off animations, comfortable/compact density.

## 💸 Pricing

| | **Free** | **Pro** |
|---|---|---|
| Manual capture & ledger | ✅ | ✅ |
| Basic CSV export | ✅ (25 rows) | ✅ unlimited |
| Themes, accent, animations | ✅ | ✅ |
| Auto-capture while browsing | — | ✅ |
| QuickBooks / JSON export | — | ✅ |
| Custom categories, tax, multi-currency | — | ✅ |

- **Pro Monthly — $5/mo** · **Pro Yearly — $44/yr** (save 27%)
- **3-day free trial** — granted only when you start a Pro subscription (no standalone trial; the first 3 days of a paid plan are free via Stripe `trial_period_days`).

---

## 🚀 Install (load unpacked)

1. Open `chrome://extensions`.
2. Toggle **Developer mode** (top-right).
3. Click **Load unpacked** and select this folder (`Glean`).
4. Pin Glean and click the icon. New installs start on the **Free** plan.

### Try Pro / Free states
- Unlock Pro with the offline demo key in **Upgrade → "Have a license key?"** or **Settings → Plan**:
  ```
  GLEAN-PRO-DEMO-2026
  ```
- In **Settings → Plan**, **Deactivate** drops you back to Free to test the paywall.

---

## 🔒 Privacy

Everything is stored in `chrome.storage.local` on your device. Glean has **no backend**,
makes **no network requests** with your data, and requests the minimum permissions
(`storage`, `unlimitedStorage`, `contextMenus`, `activeTab`). "Capture page" and
auto-capture parse the page **in the content script, locally**.

---

## 🧱 Architecture

```
manifest.json          MV3 config (minimal permissions)
background.js          service worker — trial init, right-click capture, badge, messaging
content.js             page parser (JSON-LD + heuristics) + Shadow-DOM capture prompt
popup.html / popup.js  main UI — dashboard, ledger, add/edit sheet, export, upsell
options.html/.js       full settings — appearance, money, categories, capture, data, plan
lib/
  store.js             chrome.storage wrapper, receipt model, stats, reactivity
  license.js           trial/Pro state machine, pricing, key validation
  categories.js        default categories + keyword auto-categorizer
  csv.js               CSV / accounting CSV / JSON export + download
  util.js              DOM, formatting, count-up & stagger animations, accent theming
styles/
  tokens.css           design tokens + light/dark theming + animation gates
  base.css             reset, components (buttons, switch, sheet, toast…), keyframes
icons/                 generated PNG app icons + scalable logo.svg
```

**Data model** (one receipt): `{ id, merchant, amount, currency, date, category, note, tax, source, url, createdAt }`.

---

## ✅ Testing

No build step. With Node absent, the logic was verified using macOS's bundled
JavaScriptCore (`jsc`):

- **Parse check** — all 9 JS files parse as ES modules / classic script.
- **Logic suite** — 24 assertions covering the entitlement state machine, month-scoped
  stats, CSV escaping, category guessing and JSON round-trips. All green.

---

## 🛣️ From MVP to production

This is a complete, working MVP. To ship commercially:

1. **Payments** — wire the upgrade buttons to **Stripe Payment Links** or **ExtensionPay**,
   and validate license keys against a backend in `lib/license.js` (`validateKey`/`activateKey`
   are offline stubs today).
2. **Gmail harvesting** *(the killer v2 feature)* — read-only Gmail API to pull historical
   receipts. ⚠️ Restricted scopes require Google's **CASA security audit** (~$500–4k/yr) — a
   real barrier that also keeps competitors out.
3. **Image/PDF receipts** — OCR for screenshots and attached PDFs.
4. **Store listing** — privacy policy, screenshots, demo video.

See `AI_PROMPT.md` for a complete spec you can hand to another AI to extend or rebuild Glean.
