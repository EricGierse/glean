# Build prompt — "Glean" Chrome extension

Copy everything below the line into another AI (Claude, GPT, etc.) to have it build,
rebuild, or extend Glean. It is written to be self-contained.

---

You are an expert Chrome extension engineer and product designer. Build a complete,
production-quality **Manifest V3** Chrome extension called **Glean — a Receipt & Expense
Harvester**. It must be polished, animated, customizable, and **local-first** (no backend,
no data ever leaves the browser). Ship runnable code with no build step (vanilla JS ES
modules + CSS; no frameworks, no npm).

## Product concept
Glean gathers the receipts, invoices, and order confirmations scattered across a user's web
activity into one clean, exportable ledger. Target users: **freelancers and small businesses**
who hate bookkeeping. The value prop: "It found 47 receipts automatically and caught
deductions you'd miss." Recurring, business-budget pain → low churn.

## Monetization (implement the full paywall + trial)
- **Free**: manual capture + ledger, basic CSV export (cap 25 rows), all appearance customization.
- **Pro**: auto-capture while browsing, unlimited CSV + QuickBooks/Xero CSV + JSON export,
  custom categories, tax tracking, multi-currency, right-click capture.
- **Prices**: Pro Monthly **$9/mo**, Pro Yearly **$79/yr** (label "Save 27%").
- **Trial**: **7-day** full-Pro trial, auto-started on install, **no credit card**. After it
  expires, drop to Free. Implement an entitlement state machine: `trial → (pro | free)`.
- Keep payment/license validation as clearly-marked offline stubs (accept a demo key like
  `GLEAN-PRO-DEMO-2026` and `GLEAN-XXXX-XXXX` patterns), with TODO hooks for Stripe Payment
  Links / ExtensionPay + a backend validation endpoint.

## Capture mechanisms
1. **Manual add** (popup form).
2. **Right-click selection** → context menu → parse the selected text for an amount/currency.
3. **"Capture page"** button → content script parses the current page.
4. **Auto-capture (Pro)** → on `document_idle`, parse the page; if a receipt is detected with
   reasonable confidence, show a non-intrusive **Shadow-DOM** prompt ("Receipt detected — $X
   at Merchant · Capture / Edit / ✕"). De-dupe per page; respect a site blocklist.

**Parsing strategy** (all local, in the content script): first try **JSON-LD**
(`@type` Order/Invoice → total, seller/provider name, currency, date); then **heuristics**
(scan text lines for keywords like "total", "amount due", "you paid" and the nearest currency
amount; fall back to the largest amount on the page). Merchant from `og:site_name`/title/host.
Normalize both `1,234.56` and `1.234,56` formats.

## UX & visual quality (this matters — make it feel premium)
- Clean card-based UI, system font stack, generous spacing, soft shadows, rounded corners.
- **Smooth animations**: count-up for totals, staggered list entrance, spring-eased bottom
  **sheets** for add/edit and upgrade, toast notifications, animated toggle switches, button
  press/scale feedback, skeleton shimmer. All gated by a user **animations** setting
  (Full / Reduced / Off) and `prefers-reduced-motion`.
- **Customization** (in Options): theme (System/Light/Dark), **accent color** (presets +
  custom color picker, applied live across the UI *and* derived button/soft variants),
  animation level, density (Comfortable/Compact), default currency, date format, editable
  **categories** (name + color, Pro), capture toggles + site blocklist (Pro).
- A toolbar **badge** shows the receipt count.

## Data model
Receipt: `{ id, merchant, amount:Number, currency, date:ISO, category, note, tax:Number|null,
source:'manual'|'auto'|'selection'|'import', url, createdAt }`. Stored in
`chrome.storage.local`. Compute stats: this-month total + count (in primary currency),
all-time total, and a **month-scoped** top category for the dashboard chip.

## Architecture (vanilla, no build)
- `manifest.json` — MV3; permissions **minimal**: `storage`, `unlimitedStorage`,
  `contextMenus`, `activeTab`; content script on `http/https`; background `type: module`.
- `background.js` (module SW) — init trial, build context menus, route messages
  (`GET_ENTITLEMENTS`, `CAPTURE`, `PARSE_PAGE`), maintain badge.
- `content.js` (**classic** script, no imports) — page parser + Shadow-DOM UI; isolated styles.
- `popup.html` + `popup.js` (module) — dashboard, ledger, search/filter, add/edit sheet,
  export menu, upsell sheet.
- `options.html` + `options.js` (module) — full settings + plan management.
- `lib/` ES modules: `store.js` (storage/model/stats/reactivity via `storage.onChanged`),
  `license.js` (trial/Pro + pricing + key validation), `categories.js` (defaults + keyword
  categorizer), `csv.js` (CSV/accounting CSV/JSON + download), `util.js` (DOM `el()`, money/date
  formatting, `animateCount`, `stagger`, accent theming with `hexToRgb`/`mix`/`rgba`).
- `styles/tokens.css` (CSS custom properties, `[data-theme]` light/dark, `--accent*` injected
  at runtime, animation-gate classes `anim-off`/`anim-reduced`/`anim-force`) + `styles/base.css`
  (reset + components + keyframes).
- `icons/` — app PNGs (16/32/48/128) + scalable `logo.svg` (rounded emerald-gradient square
  with a white checkmark).

## Hard requirements
- **MV3 CSP-safe**: no inline `<script>` and no inline `on*=` handlers — wire events in JS.
- Content script must be a classic script (no ES `import`); communicate via `chrome.runtime`
  messaging. Popup/options use `<script type="module">`.
- Gracefully handle restricted pages (no content script) when using "Capture page".
- Keep it dependency-free and runnable via **Load unpacked**.

## Deliverables
All files above, plus a `README.md` (install, pricing, privacy, architecture, demo key) and a
production checklist (Stripe/ExtensionPay payments, backend license validation, and a v2 Gmail
read-only harvesting feature — note that restricted Gmail scopes require Google's **CASA**
security audit, which is both the main barrier and the competitive moat; optionally an OCR path
for image/PDF receipts).

Make it feel like a $9/mo product someone would happily pay for.
