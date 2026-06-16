// Glean — popup controller
import { $, el, formatMoney, relativeDay, todayISO, animateCount, stagger, debounce, applyAccent, escapeHtml } from "./lib/util.js";
import { getSettings, getReceipts, addReceipt, updateReceipt, deleteReceipt, getLicense, computeStats, onChanged } from "./lib/store.js";
import { getEntitlements, activateKey, PRICING, CHECKOUT_URL } from "./lib/license.js";
import { categoryById } from "./lib/categories.js";
import { toCSV, toAccountingCSV, toJSON, download, stamp } from "./lib/csv.js";
import { ICONS } from "./lib/icons.js";
import { scanReceipt, fileToBase64, scanErrorMessage } from "./lib/scan.js";
import { getSession, signInWithGoogle, requestEmailCode, verifyEmailCode } from "./lib/auth.js";

const CURRENCIES = ["USD", "EUR", "GBP", "BRL", "JPY", "CAD", "AUD", "INR", "CHF", "MXN"];

let settings, ent, receipts = [];
const filter = { q: "", cat: "" };

init();

async function init() {
  settings = await getSettings();
  applyAppearance(settings);
  const session = await getSession();
  if (!session) { showAuth(); return; }       // 🔒 must sign in first
  $("#app").classList.remove("hidden");
  ent = getEntitlements(await getLicense());
  receipts = await getReceipts();
  buildCategoryFilter();
  renderAll();
  wire();
  onChanged(debounce(refresh, 100));
  matchMedia("(prefers-color-scheme: dark)").addEventListener("change", () => settings.theme === "system" && applyAppearance(settings));
  maybeShowUpsellPopup();
}

/* ---------- Auth gate ---------- */
function showAuth() {
  $("#authView").classList.remove("hidden");
  $("#app").classList.add("hidden");
  let mode = "signup";
  let pending = null; // { email, exp, sig, demo } between the email step and the code step

  const applyMode = () => {
    $("#authTitle").textContent = mode === "signup" ? "Create your account" : "Welcome back";
    $("#authSub").textContent = mode === "signup" ? "Sign up to start capturing receipts." : "Log in to your Glean account.";
    $("#authToggleText").textContent = mode === "signup" ? "Already have an account?" : "New to Glean?";
    $("#authToggle").textContent = mode === "signup" ? "Log in" : "Create one";
  };
  applyMode();
  $("#authToggle").onclick = () => { mode = mode === "signup" ? "login" : "signup"; applyMode(); };

  const showPanel = (which) => {
    $("#authMain").classList.toggle("hidden", which !== "main");
    $("#authCode").classList.toggle("hidden", which !== "code");
  };

  // OAuth providers (reload on success so init() finds the new session)
  const oauth = (btn, fn) => async () => {
    btn.disabled = true;
    try { const r = await fn(); if (r?.ok) location.reload(); else if (r?.error) toast(r.error); }
    finally { btn.disabled = false; }
  };
  $("#authGoogle").onclick = oauth($("#authGoogle"), signInWithGoogle);

  // Email — step 1: send a code
  const sendCode = async () => {
    const btn = $("#authEmailBtn"); btn.disabled = true;
    try {
      const r = await requestEmailCode($("#authEmail").value);
      if (!r.ok) return toast(r.error);
      pending = { email: r.email, exp: r.exp, sig: r.sig, demo: r.demo };
      $("#codeEmail").textContent = r.email;
      $("#codeInput").value = "";
      const dev = $("#codeDev");
      if (r.devCode) { dev.textContent = `Testing mode — your code is ${r.devCode}`; dev.classList.remove("hidden"); }
      else if (r.demo) { dev.textContent = "Demo mode — enter any 6 digits to continue"; dev.classList.remove("hidden"); }
      else if (r.emailed === false) { dev.textContent = "Email sending isn't set up yet — enter any 6 digits"; dev.classList.remove("hidden"); pending.demo = true; }
      else { dev.classList.add("hidden"); }
      showPanel("code");
      setTimeout(() => $("#codeInput").focus(), 60);
    } finally { btn.disabled = false; }
  };
  $("#authEmailBtn").onclick = sendCode;
  $("#authEmail").addEventListener("keydown", (e) => { if (e.key === "Enter") sendCode(); });

  // Email — step 2: verify the code
  const verify = async () => {
    const btn = $("#codeVerify"), input = $("#codeInput"); btn.disabled = true;
    try {
      const r = await verifyEmailCode({ ...pending, code: input.value });
      if (r.ok) { location.reload(); return; }
      toast(r.error);
      input.value = ""; input.classList.remove("shake"); void input.offsetWidth; input.classList.add("shake"); input.focus();
    } finally { btn.disabled = false; }
  };
  $("#codeVerify").onclick = verify;
  $("#codeInput").addEventListener("input", (e) => {
    e.target.value = e.target.value.replace(/\D/g, "").slice(0, 6);
    if (e.target.value.length === 6) verify(); // auto-submit when complete
  });
  $("#codeInput").addEventListener("keydown", (e) => { if (e.key === "Enter") verify(); });
  $("#codeResend").onclick = sendCode;
  $("#codeChange").onclick = () => showPanel("main");
  $("#codeBack").onclick = () => showPanel("main");
}

async function refresh() {
  settings = await getSettings();
  ent = getEntitlements(await getLicense());
  receipts = await getReceipts();
  applyAppearance(settings);
  renderAll();
}

function renderAll() { renderPlan(); renderStats(); renderList(); renderUpsell(); }

/* ---------- Appearance ---------- */
function applyAppearance(s) {
  const root = document.documentElement;
  const dark = s.theme === "dark" || (s.theme === "system" && matchMedia("(prefers-color-scheme: dark)").matches);
  root.dataset.theme = dark ? "dark" : "light";
  applyAccent(s.accent);
  root.classList.toggle("anim-off", s.animations === "off");
  root.classList.toggle("anim-reduced", s.animations === "reduced");
  root.classList.toggle("anim-force", s.animations === "full");
  $("#app").classList.toggle("density-compact", s.density === "compact");
}

/* ---------- Renderers ---------- */
function renderPlan() {
  const b = $("#planBadge");
  b.className = "badge";
  if (ent.tier === "pro") { b.classList.add("badge-pro"); b.innerHTML = `${ICONS.crown} ${ent.inFreeWindow ? `Pro · ${ent.freeDaysLeft}d free` : "Pro"}`; }
  else { b.classList.add("badge-free"); b.textContent = "Free"; }
}

function renderStats() {
  const s = computeStats(receipts, settings.currency);
  animateCount($("#monthTotal"), s.monthTotal, { format: (v) => formatMoney(v, settings.currency) });
  animateCount($("#allTotal"), s.allTotal, { duration: 500, format: (v) => formatMoney(v, settings.currency) });
  $("#monthCount").textContent = `${s.monthCount} ${s.monthCount === 1 ? "receipt" : "receipts"}`;
  const top = $("#topCat");
  if (s.topCategory) {
    const cat = categoryById(s.topCategory, settings.categories);
    top.hidden = false;
    top.innerHTML = `<span class="dot" style="background:${cat.color}"></span>${escapeHtml(cat.name)}`;
  } else top.hidden = true;
}

function applyFilter(list) {
  return list.filter((r) => {
    if (filter.cat && r.category !== filter.cat) return false;
    if (filter.q) {
      const hay = `${r.merchant} ${r.note} ${r.url}`.toLowerCase();
      if (!hay.includes(filter.q.toLowerCase())) return false;
    }
    return true;
  });
}

function renderList() {
  const list = $("#list");
  const filtered = applyFilter(receipts);
  const active = filter.q || filter.cat;
  $("#listTitle").textContent = active ? "Results" : "Recent";
  $("#listCount").textContent = filtered.length ? `${filtered.length}` : "";
  list.innerHTML = "";

  if (!filtered.length) {
    $("#empty").classList.remove("hidden");
    const e = $("#empty");
    if (receipts.length && active) {
      e.querySelector("h3").textContent = "No matches";
      e.querySelector("p").innerHTML = "Try a different search or category filter.";
    } else {
      e.querySelector("h3").textContent = "No receipts yet";
      e.querySelector("p").innerHTML = "Hit <b>Add</b>, right-click any total on a page, or open a receipt and use <b>Capture page</b>.";
    }
    return;
  }
  $("#empty").classList.add("hidden");

  const nodes = filtered.map((r) => {
    const cat = categoryById(r.category, settings.categories);
    return el("div", { class: "item", onclick: () => openSheet(r) },
      el("span", { class: "cat-dot", style: `background:${cat.color}` }),
      el("div", { class: "item-main" },
        el("div", { class: "item-merch" }, r.merchant),
        el("div", { class: "item-meta" },
          el("span", { class: "chip" }, cat.name),
          el("span", { class: "faint" }, relativeDay(r.date)))),
      el("div", { class: "item-amt num" }, formatMoney(r.amount, r.currency)));
  });
  nodes.forEach((n) => list.appendChild(n));
  stagger(nodes);
}

function renderUpsell() {
  const u = $("#upsell");
  if (ent.tier === "pro") { u.classList.add("hidden"); return; }
  u.classList.remove("hidden");
  $("#upsellTitle").textContent = "Unlock Glean Pro";
  $("#upsellSub").textContent = `3 days free, then $${PRICING.monthly.price}/mo — AI scan, auto-capture & more`;
  $("#upsellBtn").textContent = "Start free trial";
}

function buildCategoryFilter() {
  const sel = $("#filterCat");
  sel.querySelectorAll("option:not([value=''])").forEach((o) => o.remove());
  settings.categories.forEach((c) => sel.append(el("option", { value: c.id }, c.name)));
}

/* ---------- Wiring ---------- */
function wire() {
  $("#settingsBtn").onclick = () => chrome.runtime.openOptionsPage();
  $("#addBtn").onclick = () => openSheet(null);
  $("#captureBtn").onclick = captureCurrentPage;
  $("#scanBtn").onclick = () => scanFlow();
  $("#exportBtn").onclick = exportFlow;
  $("#upsellBtn").onclick = () => openUpsell();
  $("#search").addEventListener("input", debounce((e) => { filter.q = e.target.value; renderList(); }, 160));
  $("#filterCat").addEventListener("change", (e) => { filter.cat = e.target.value; renderList(); });
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") [...document.querySelectorAll(".sheet-backdrop")].pop()?._close?.();
  });
}

async function captureCurrentPage() {
  if (!ent.isPro) return openUpsell("Capture page is a Pro feature");
  const btn = $("#captureBtn");
  btn.disabled = true;
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    const res = await chrome.tabs.sendMessage(tab.id, { type: "GLEAN_PARSE_PAGE" });
    if (res?.receipt && res.receipt.amount > 0) {
      openSheet({ ...res.receipt, _prefill: true });
    } else {
      toast("No receipt found on this page");
    }
  } catch {
    toast("Can't read this page — try Add instead");
  } finally {
    btn.disabled = false;
  }
}

/* ---------- AI receipt scan (Pro) — the headline Pro feature ---------- */
function pickImage() {
  return new Promise((resolve) => {
    const inp = el("input", { type: "file", accept: "image/*" });
    inp.style.display = "none";
    inp.onchange = () => { resolve(inp.files && inp.files[0] ? inp.files[0] : null); inp.remove(); };
    document.body.appendChild(inp);
    inp.click();
  });
}
function openScanning() {
  const node = el("div");
  node.innerHTML = `<div style="display:flex;flex-direction:column;align-items:center;gap:13px;padding:22px 6px 10px">
    <div class="scan-spinner"></div>
    <div style="font-weight:700">Reading your receipt…</div>
    <div class="muted" style="font-size:12px">Gemini is extracting the price &amp; category</div>
  </div>`;
  return mountSheet(node);
}
function fillSheet(node, r) {
  const set = (sel, v) => { const x = node.querySelector(sel); if (x && v != null && v !== "") x.value = v; };
  set("#f-merchant", r.merchant);
  set("#f-amount", r.amount || "");
  set("#f-date", r.date);
  const cat = node.querySelector("#f-category"); if (cat) cat.value = r.category;
  if (ent.isPro) { const cur = node.querySelector("#f-currency"); if (cur) cur.value = r.currency; }
  toast("Scanned — review & save");
}
async function scanFlow(targetNode) {
  if (!ent.isPro) return openUpsell("AI receipt scan is a Pro feature");
  const file = await pickImage();
  if (!file) return;
  const scanning = openScanning();
  try {
    const { base64, mimeType } = await fileToBase64(file);
    const res = await scanReceipt({ base64, mimeType, apiKey: settings.geminiApiKey, categories: settings.categories });
    scanning.close();
    if (!res.ok) return toast(scanErrorMessage(res));
    if (targetNode && document.body.contains(targetNode)) fillSheet(targetNode, res.receipt);
    else openSheet({ ...res.receipt, _prefill: true, _scanned: true });
  } catch {
    scanning.close();
    toast("Scan failed — try again");
  }
}

function exportFlow() {
  if (!receipts.length) return toast("Nothing to export yet");
  if (ent.isPro) return openExportMenu();
  const capped = receipts.slice(0, 25);
  download(`glean-${stamp()}.csv`, toCSV(capped, settings.categories));
  toast(receipts.length > 25 ? `Exported 25 of ${receipts.length} · Pro exports all` : "Exported CSV");
}

/* ---------- Sheets ---------- */
function mountSheet(node) {
  const host = $("#sheetHost");
  const backdrop = el("div", { class: "sheet-backdrop" });
  const sheet = el("div", { class: "sheet" });
  sheet.appendChild(node);
  backdrop.appendChild(sheet);
  const close = () => { sheet.classList.add("sheet-closing"); backdrop.classList.add("backdrop-closing"); setTimeout(() => backdrop.remove(), 220); };
  backdrop._close = close;
  backdrop.addEventListener("click", (e) => { if (e.target === backdrop) close(); });
  host.appendChild(backdrop);
  return { close, sheet };
}

function currencyOptions(sel) {
  return CURRENCIES.map((c) => `<option value="${c}" ${c === sel ? "selected" : ""}>${c}</option>`).join("");
}
function categoryOptions(sel) {
  return settings.categories.map((c) => `<option value="${c.id}" ${c.id === sel ? "selected" : ""}>${escapeHtml(c.name)}</option>`).join("");
}

function openSheet(receipt) {
  const isEdit = !!(receipt && receipt.id);
  const isPro = ent.isPro;
  const r = receipt || {};
  const cur = r.currency || settings.currency;
  const node = el("div");
  node.innerHTML = `
    <h3>${isEdit ? "Edit receipt" : r._prefill ? (r._scanned ? "Confirm scanned receipt" : "Confirm receipt") : "Add receipt"}</h3>
    ${isEdit ? "" : (r._scanned
      ? `<div class="scan-hint">${ICONS.sparkle} AI read this — verify the details${r.confidence ? " · " + Math.round(r.confidence * 100) + "% sure" : ""}</div>`
      : `<button class="btn btn-block scan-inline" id="f-scan" type="button">${ICONS.scan} Scan a photo with AI${isPro ? "" : ' <span class="lock">PRO</span>'}</button>`)}
    <div class="field">
      <label>Merchant</label>
      <input id="f-merchant" type="text" placeholder="e.g. Figma" value="${escapeHtml(r.merchant || "")}">
    </div>
    <div class="grid2">
      <div class="field">
        <label>Amount</label>
        <input id="f-amount" type="number" step="0.01" inputmode="decimal" placeholder="0.00" value="${r.amount ?? ""}">
      </div>
      <div class="field ${isPro ? "" : "field-locked"}" id="cur-wrap">
        <label>Currency ${isPro ? "" : '<span class="lock">PRO</span>'}</label>
        <select id="f-currency">${currencyOptions(isPro ? cur : settings.currency)}</select>
      </div>
    </div>
    <div class="grid2">
      <div class="field">
        <label>Date</label>
        <input id="f-date" type="date" value="${r.date || todayISO()}">
      </div>
      <div class="field">
        <label>Category</label>
        <select id="f-category">${categoryOptions(r.category || "other")}</select>
      </div>
    </div>
    <div class="field ${isPro ? "" : "field-locked"}" id="tax-wrap">
      <label>Tax amount ${isPro ? '<span class="faint">(optional)</span>' : '<span class="lock">PRO</span>'}</label>
      <input id="f-tax" type="number" step="0.01" placeholder="0.00" value="${r.tax ?? ""}">
    </div>
    <div class="field">
      <label>Note</label>
      <textarea id="f-note" placeholder="Optional note">${escapeHtml(r.note || "")}</textarea>
    </div>
    <div class="sheet-actions">
      ${isEdit ? '<button class="btn btn-danger" id="f-delete">Delete</button>' : ""}
      <span class="spacer"></span>
      <button class="btn btn-ghost" id="f-cancel">Cancel</button>
      <button class="btn btn-primary" id="f-save">${isEdit ? "Save" : "Add receipt"}</button>
    </div>`;

  const { close } = mountSheet(node);

  if (!isPro) {
    node.querySelector("#cur-wrap").onclick = () => openUpsell("Multi-currency is a Pro feature");
    node.querySelector("#tax-wrap").onclick = () => openUpsell("Tax tracking is a Pro feature");
  }
  const fScan = node.querySelector("#f-scan");
  if (fScan) fScan.onclick = () => (ent.isPro ? scanFlow(node) : openUpsell("AI receipt scan is a Pro feature"));
  node.querySelector("#f-cancel").onclick = close;
  if (isEdit) node.querySelector("#f-delete").onclick = async () => { await deleteReceipt(receipt.id); close(); toast("Receipt deleted"); };
  node.querySelector("#f-save").onclick = async () => {
    const amount = Number(node.querySelector("#f-amount").value);
    if (!(amount > 0)) { const a = node.querySelector("#f-amount"); a.focus(); a.style.borderColor = "var(--danger)"; return toast("Enter an amount"); }
    const data = {
      merchant: node.querySelector("#f-merchant").value.trim() || "Unknown merchant",
      amount,
      currency: isPro ? node.querySelector("#f-currency").value : settings.currency,
      date: node.querySelector("#f-date").value || todayISO(),
      category: node.querySelector("#f-category").value,
      note: node.querySelector("#f-note").value.trim(),
      tax: isPro && node.querySelector("#f-tax").value !== "" ? Number(node.querySelector("#f-tax").value) : null,
    };
    if (isEdit) await updateReceipt(receipt.id, data);
    else await addReceipt({ ...data, source: r._prefill ? "auto" : "manual", url: r.url || "" });
    close();
    toast(isEdit ? "Saved" : "Receipt added ✓");
  };
  setTimeout(() => node.querySelector("#f-merchant").focus(), 60);
}

function openExportMenu() {
  const node = el("div");
  node.innerHTML = `
    <h3>Export</h3>
    <div style="display:flex;flex-direction:column;gap:9px">
      <button class="btn btn-ghost btn-block" id="x-csv">${ICONS.fileText} All receipts — CSV</button>
      <button class="btn btn-ghost btn-block" id="x-acc">${ICONS.chart} Accounting / QuickBooks — CSV</button>
      <button class="btn btn-ghost btn-block" id="x-json">${ICONS.archive} Full backup — JSON</button>
    </div>`;
  const { close } = mountSheet(node);
  node.querySelector("#x-csv").onclick = () => { download(`glean-${stamp()}.csv`, toCSV(receipts, settings.categories)); close(); toast(`Exported ${receipts.length} receipts`); };
  node.querySelector("#x-acc").onclick = () => { download(`glean-accounting-${stamp()}.csv`, toAccountingCSV(receipts, settings.categories)); close(); toast("Accounting CSV ready"); };
  node.querySelector("#x-json").onclick = () => { download(`glean-backup-${stamp()}.json`, toJSON(receipts), "application/json"); close(); toast("Backup saved"); };
}

function openUpsell(reason) {
  const m = PRICING.monthly, y = PRICING.yearly;
  const node = el("div");
  node.innerHTML = `
    <h3 style="display:flex;align-items:center;gap:8px"><span class="li-ic" style="font-size:18px">${ICONS.crown}</span> Glean Pro</h3>
    <p class="muted" style="margin:-2px 0 12px;font-size:12.5px">${reason ? escapeHtml(reason) + " · " : ""}3 days free, then $${m.price}/mo. Cancel anytime — no charge during the trial.</p>
    <ul style="list-style:none;display:flex;flex-direction:column;gap:9px;margin-bottom:16px;font-size:13px">
      <li style="display:flex;gap:9px;align-items:center"><span class="li-ic">${ICONS.scan}</span> AI receipt-photo scanning</li>
      <li style="display:flex;gap:9px;align-items:center"><span class="li-ic">${ICONS.check}</span> Auto-capture receipts as you browse</li>
      <li style="display:flex;gap:9px;align-items:center"><span class="li-ic">${ICONS.check}</span> Unlimited CSV / QuickBooks / JSON export</li>
      <li style="display:flex;gap:9px;align-items:center"><span class="li-ic">${ICONS.check}</span> Custom categories, tax &amp; multi-currency</li>
    </ul>
    <div style="display:flex;gap:10px;margin-bottom:14px">
      <button class="plan card" id="plan-year" style="flex:1;padding:13px;text-align:left;cursor:pointer;border-color:var(--accent);position:relative">
        <div class="badge badge-pro" style="position:absolute;top:-9px;right:10px">${y.badge}</div>
        <div style="font-weight:800;font-size:15px">$${y.price}<span class="faint" style="font-size:12px;font-weight:600">/yr</span></div>
        <div class="faint" style="font-size:11.5px">${y.note}</div>
      </button>
      <button class="plan card" id="plan-month" style="flex:1;padding:13px;text-align:left;cursor:pointer">
        <div style="font-weight:800;font-size:15px">$${m.price}<span class="faint" style="font-size:12px;font-weight:600">/mo</span></div>
        <div class="faint" style="font-size:11.5px">${m.note}</div>
      </button>
    </div>
    <div class="field" style="margin-bottom:12px">
      <label>Have a license key?</label>
      <div style="display:flex;gap:8px">
        <input id="f-key" type="text" placeholder="GLEAN-XXXX-XXXX" style="flex:1">
        <button class="btn btn-ghost" id="f-activate">Activate</button>
      </div>
    </div>
    <button class="btn btn-block" id="u-close">Maybe later</button>`;
  const { close } = mountSheet(node);
  const goCheckout = (plan) => chrome.tabs.create({ url: `${CHECKOUT_URL}?plan=${plan}` });
  node.querySelector("#plan-year").onclick = () => goCheckout("yearly");
  node.querySelector("#plan-month").onclick = () => goCheckout("monthly");
  node.querySelector("#u-close").onclick = close;
  node.querySelector("#f-activate").onclick = async () => {
    const res = await activateKey(node.querySelector("#f-key").value);
    if (res.ok) { close(); toast("Pro unlocked 🎉"); refresh(); }
    else toast(res.error || "Invalid key");
  };
}

/* ---------- Timed Pro promo popup ---------- */
// Shows an illustrated upgrade popup to Free users "from time to time" — never on the
// very first open, then at most once every few days so it informs without nagging.
const UPSELL_META_KEY = "glean_upsell_meta";
const UPSELL_GAP_MS = 3 * 86400000; // at most once every 3 days

async function maybeShowUpsellPopup() {
  if (ent.tier === "pro") return;
  let meta = {};
  try { meta = (await chrome.storage.local.get(UPSELL_META_KEY))[UPSELL_META_KEY] || {}; } catch { return; }
  const opens = (meta.opens || 0) + 1;
  const now = Date.now();
  const due = opens >= 2 && (!meta.lastShown || now - meta.lastShown > UPSELL_GAP_MS);
  try { await chrome.storage.local.set({ [UPSELL_META_KEY]: { opens, lastShown: due ? now : (meta.lastShown || 0) } }); } catch { /* ignore */ }
  if (due) setTimeout(() => { if (!document.querySelector(".sheet-backdrop")) showProPopup(); }, 700);
}

function showProPopup() {
  if (ent.tier === "pro") return;
  const m = PRICING.monthly, y = PRICING.yearly;
  const feat = (ic, t) => `<li><span class="pf-ic">${ic}</span><span>${t}</span></li>`;
  const node = el("div", { class: "promo" });
  node.innerHTML = `
    <div class="promo-hero">
      <span class="promo-spark s1">${ICONS.sparkle}</span>
      <span class="promo-spark s2">${ICONS.sparkle}</span>
      <span class="promo-spark s3">${ICONS.sparkle}</span>
      <div class="promo-crown">${ICONS.crown}</div>
      <div class="promo-word">Glean <b>Pro</b></div>
      <div class="promo-tag">Your receipts, on autopilot</div>
    </div>
    <h3 class="promo-h">Unlock everything Glean can do</h3>
    <ul class="promo-feats">
      ${feat(ICONS.scan, "<b>AI receipt scan</b> — snap a photo, done")}
      ${feat(ICONS.zap, "Auto-capture receipts as you browse")}
      ${feat(ICONS.chart, "Unlimited CSV / QuickBooks / JSON export")}
      ${feat(ICONS.archive, "Custom categories, tax &amp; multi-currency")}
    </ul>
    <div class="promo-cards">
      <button class="promo-card" id="pp-year" type="button">
        <span class="badge badge-pro promo-tagpill">${ICONS.crown} ${y.badge}</span>
        <div class="promo-price">$${y.price}<span>/yr</span></div>
        <div class="promo-note">3 days free · ≈ $${(y.price / 12).toFixed(2)}/mo</div>
      </button>
      <button class="promo-card" id="pp-month" type="button">
        <div class="promo-price">$${m.price}<span>/mo</span></div>
        <div class="promo-note">3 days free</div>
      </button>
    </div>
    <button class="btn btn-primary btn-block btn-lg" id="pp-start">${ICONS.sparkle} Start 3-day free trial</button>
    <div class="promo-foot">
      <a id="pp-key">Have a license key?</a>
      <a id="pp-later">Maybe later</a>
    </div>`;
  const { close } = mountSheet(node);

  let plan = "yearly";
  const cards = { yearly: node.querySelector("#pp-year"), monthly: node.querySelector("#pp-month") };
  const selPlan = (p) => { plan = p; cards.yearly.classList.toggle("on", p === "yearly"); cards.monthly.classList.toggle("on", p === "monthly"); };
  selPlan("yearly");
  cards.yearly.onclick = () => selPlan("yearly");
  cards.monthly.onclick = () => selPlan("monthly");
  node.querySelector("#pp-start").onclick = () => chrome.tabs.create({ url: `${CHECKOUT_URL}?plan=${plan}` });
  node.querySelector("#pp-key").onclick = () => { close(); setTimeout(() => openUpsell(), 230); };
  node.querySelector("#pp-later").onclick = close;
}

/* ---------- Toast ---------- */
function toast(text) {
  const t = el("div", { class: "toast" }, text);
  $("#toastHost").appendChild(t);
  setTimeout(() => { t.classList.add("out"); setTimeout(() => t.remove(), 240); }, 2000);
}
