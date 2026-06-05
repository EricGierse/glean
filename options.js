// Glean — options/settings controller
import { $, $$, el, applyAccent, escapeHtml, debounce, uid } from "./lib/util.js";
import { getSettings, saveSettings, getReceipts, importReceipts, clearReceipts, getLicense, onChanged } from "./lib/store.js";
import { DEFAULT_CATEGORIES } from "./lib/categories.js";
import { getEntitlements, activateKey, deactivate, PRICING, CHECKOUT_URL } from "./lib/license.js";
import { toCSV, toAccountingCSV, toJSON, download, stamp } from "./lib/csv.js";
import { ICONS } from "./lib/icons.js";
import { getSession, signOut, providerLabel } from "./lib/auth.js";

const CURRENCIES = ["USD", "EUR", "GBP", "BRL", "JPY", "CAD", "AUD", "INR", "CHF", "MXN"];
const ACCENTS = [
  { name: "Emerald", color: "#10b981" }, { name: "Teal", color: "#14b8a6" },
  { name: "Sky", color: "#0ea5e9" }, { name: "Indigo", color: "#6366f1" },
  { name: "Violet", color: "#8b5cf6" }, { name: "Pink", color: "#ec4899" },
  { name: "Amber", color: "#f59e0b" }, { name: "Rose", color: "#ef4444" },
];

let settings, ent;

init();

async function init() {
  settings = await getSettings();
  ent = getEntitlements(await getLicense());
  applyAppearance(settings);
  if (location.hash === "#welcome") $("#welcome").classList.remove("hidden");

  buildCurrency();
  buildSwatches();
  renderSegments();
  renderToggles();
  renderBlocklist();
  renderCategories();
  renderPlan();
  renderAccount();
  applyGating();
  wire();

  onChanged((c) => { if (c.glean_license) reloadLicense(); });
}

async function reloadLicense() {
  ent = getEntitlements(await getLicense());
  renderPlan();
  applyGating();
}

/* ---------- Appearance ---------- */
function applyAppearance(s) {
  const root = document.documentElement;
  const dark = s.theme === "dark" || (s.theme === "system" && matchMedia("(prefers-color-scheme: dark)").matches);
  root.dataset.theme = dark ? "dark" : "light";
  applyAccent(s.accent);
  root.classList.toggle("anim-off", s.animations === "off");
  root.classList.toggle("anim-reduced", s.animations === "reduced");
  root.classList.toggle("anim-force", s.animations === "full");
}

async function update(patch) {
  settings = await saveSettings(patch);
  applyAppearance(settings);
}

const setSeg = (id, val) => $$(`#${id} button`).forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.v === val)));

function renderSegments() {
  setSeg("seg-theme", settings.theme);
  setSeg("seg-anim", settings.animations);
  setSeg("seg-density", settings.density);
}

function buildCurrency() {
  const sel = $("#sel-currency");
  sel.innerHTML = CURRENCIES.map((c) => `<option value="${c}">${c}</option>`).join("");
  sel.value = settings.currency;
  $("#sel-date").value = settings.dateFormat;
}

function buildSwatches() {
  const host = $("#swatches");
  host.innerHTML = "";
  ACCENTS.forEach((a) => {
    const sw = el("button", { class: "swatch", title: a.name, style: `background:${a.color}`, "data-color": a.color });
    sw.onclick = async () => { await update({ accent: a.color }); markSwatches(); };
    host.appendChild(sw);
  });
  const custom = el("button", { class: "swatch custom", title: "Custom color", "data-custom": "1" });
  const picker = el("input", { type: "color", value: settings.accent });
  picker.oninput = () => applyAccent(picker.value);                       // live preview while dragging
  picker.onchange = async () => { await update({ accent: picker.value }); markSwatches(); };
  custom.appendChild(picker);
  host.appendChild(custom);
  markSwatches();
}

// Move the selected ring on the EXISTING swatches (no rebuild) so the highlight
// transitions smoothly and never lags a pick behind the chosen colour.
function markSwatches() {
  const acc = (settings.accent || "").toLowerCase();
  const isPreset = ACCENTS.some((a) => a.color.toLowerCase() === acc);
  $$("#swatches .swatch").forEach((sw) => {
    const pressed = sw.dataset.custom ? !isPreset : (sw.dataset.color || "").toLowerCase() === acc;
    sw.setAttribute("aria-pressed", String(pressed));
  });
  const cp = $("#swatches .custom input");
  if (cp) cp.value = settings.accent;
}

/* ---------- Toggles & blocklist ---------- */
function renderToggles() {
  $("#tg-auto").checked = settings.autoCapture && ent.isPro;
  $("#tg-toast").checked = settings.captureToast;
}
function renderBlocklist() {
  $("#ta-block").value = (settings.blocklist || []).join("\n");
}

/* ---------- Categories ---------- */
function renderCategories() {
  const list = $("#catList");
  list.innerHTML = "";
  $("#cat-lock").hidden = ent.isPro;
  settings.categories.forEach((c, i) => {
    const row = el("div", { class: "cat-row" + (ent.isPro ? "" : " pro-only") });
    const color = el("input", { type: "color", value: c.color });
    const name = el("input", { type: "text", value: c.name });
    const del = el("button", { class: "icon-btn del", title: "Delete" });
    del.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6"/></svg>`;
    if (ent.isPro) {
      color.oninput = debounce(() => saveCats(settings.categories.map((x, j) => j === i ? { ...x, color: color.value } : x)), 80);
      name.onchange = () => saveCats(settings.categories.map((x, j) => j === i ? { ...x, name: name.value.trim() || x.name } : x));
      del.onclick = () => { if (c.id === "other") return toast("The Other category can't be removed"); saveCats(settings.categories.filter((_, j) => j !== i)); };
    } else {
      [color, name].forEach((n) => (n.disabled = true));
      row.onclick = () => goPro("Editing categories is a Pro feature");
    }
    if (c.id === "other") del.style.visibility = "hidden";
    row.append(color, name, del);
    list.appendChild(row);
  });
}
async function saveCats(cats) { settings = await saveSettings({ categories: cats }); renderCategories(); }

/* ---------- Plan ---------- */
function renderPlan() {
  const badge = $("#planBadge");
  badge.className = "badge " + (ent.tier === "pro" ? "badge-pro" : "badge-free");
  badge.innerHTML = ent.tier === "pro" ? `${ICONS.crown} ${ent.inFreeWindow ? `Pro · ${ent.freeDaysLeft}d free` : "Pro"}` : "Free";

  const box = $("#planBox");
  const status = ent.tier === "pro"
    ? { pi: ICONS.crown, t: ent.inFreeWindow ? `Glean Pro — ${ent.freeDaysLeft} day${ent.freeDaysLeft === 1 ? "" : "s"} free left` : "Glean Pro is active",
        s: ent.inFreeWindow ? "Your first 3 days are free. Cancel before then and you won't be charged." : "Thanks for supporting Glean. Every feature is unlocked." }
    : { pi: ICONS.sprout, t: "You're on the Free plan", s: "Manual capture + basic CSV. Start a 3-day free trial to unlock AI scan, inbox sync & exports." };

  const m = PRICING.monthly, y = PRICING.yearly;
  box.innerHTML = `
    <div class="plan-status">
      <div class="pi" style="color:var(--accent-strong)">${status.pi}</div>
      <div class="row-main"><div class="row-label">${status.t}</div><div class="row-desc">${status.s}</div></div>
      ${ent.tier === "pro" ? '<button class="btn btn-ghost btn-sm" id="p-deact">Deactivate</button>' : ""}
    </div>
    ${ent.tier === "pro" ? "" : `
    <div class="row-desc" style="padding:2px 0 12px">Start a <b>3-day free trial</b> — cancel anytime, no charge during the trial.</div>
    <div class="plan-cards">
      <button class="plan-card card featured" id="p-year">
        <span class="badge badge-pro featured-tag">${ICONS.crown} ${y.badge}</span>
        <div class="price">$${y.price}<span>/year</span></div>
        <div class="pnote">${y.note}</div>
      </button>
      <button class="plan-card card" id="p-month">
        <div class="price">$${m.price}<span>/month</span></div>
        <div class="pnote">${m.note}</div>
      </button>
    </div>
    <div class="row" style="border-top:none;padding-bottom:0">
      <div class="row-main" style="flex:1">
        <input id="p-key" type="text" placeholder="Have a license key? GLEAN-XXXX-XXXX">
      </div>
      <button class="btn btn-ghost" id="p-activate">Activate</button>
    </div>`}`;

  if (ent.tier === "pro") {
    $("#p-deact").onclick = async () => { await deactivate(); toast("Switched to Free (test mode)"); };
  } else {
    $("#p-year").onclick = () => chrome.tabs.create({ url: `${CHECKOUT_URL}?plan=yearly` });
    $("#p-month").onclick = () => chrome.tabs.create({ url: `${CHECKOUT_URL}?plan=monthly` });
    $("#p-activate").onclick = async () => {
      const res = await activateKey($("#p-key").value);
      toast(res.ok ? "Pro unlocked" : (res.error || "Invalid key"));
    };
  }
}

/* ---------- Pro gating ---------- */
function applyGating() {
  renderToggles();
  $("#tg-auto").closest(".row").classList.toggle("pro-only", !ent.isPro);
  $("#ta-block").closest(".row").classList.toggle("pro-only", !ent.isPro);
}

/* ---------- Wiring ---------- */
function wire() {
  $$("#seg-theme button").forEach((b) => (b.onclick = () => { update({ theme: b.dataset.v }); setSeg("seg-theme", b.dataset.v); }));
  $$("#seg-anim button").forEach((b) => (b.onclick = () => { update({ animations: b.dataset.v }); setSeg("seg-anim", b.dataset.v); }));
  $$("#seg-density button").forEach((b) => (b.onclick = () => { update({ density: b.dataset.v }); setSeg("seg-density", b.dataset.v); }));

  $("#sel-currency").onchange = (e) => update({ currency: e.target.value });
  $("#sel-date").onchange = (e) => update({ dateFormat: e.target.value });

  $("#tg-auto").onchange = (e) => {
    if (!ent.isPro) { e.target.checked = false; return goPro("Auto-capture is a Pro feature"); }
    update({ autoCapture: e.target.checked });
  };
  $("#tg-toast").onchange = (e) => update({ captureToast: e.target.checked });
  $("#ta-block").addEventListener("input", debounce((e) => {
    if (!ent.isPro) return goPro("Site rules are a Pro feature");
    update({ blocklist: e.target.value.split("\n").map((s) => s.trim()).filter(Boolean) });
  }, 400));

  $("#catAdd").onclick = () => {
    if (!ent.isPro) return goPro("Custom categories are a Pro feature");
    saveCats([...settings.categories.filter((c) => c.id !== "other"), { id: "cat_" + uid().slice(2, 7), name: "New category", color: "#10b981", keywords: [] }, ...settings.categories.filter((c) => c.id === "other")]);
  };
  $("#catReset").onclick = async () => {
    if (!confirm("Reset categories to the Glean defaults?")) return;
    await saveCats(DEFAULT_CATEGORIES.map(({ id, name, color, keywords }) => ({ id, name, color, keywords })));
    toast("Categories reset");
  };

  $("#exp-csv").onclick = async () => exportData("csv");
  $("#exp-acc").onclick = async () => exportData("acc");
  $("#exp-json").onclick = async () => exportData("json");
  $("#imp-json").onclick = () => $("#imp-file").click();
  $("#imp-file").onchange = importFromFile;
  $("#clear-all").onclick = async () => {
    const list = await getReceipts();
    if (!list.length) return toast("No receipts to delete");
    if (!confirm(`Delete all ${list.length} receipts? This can't be undone.`)) return;
    await clearReceipts();
    toast("All receipts deleted");
  };
  const out = $("#acc-signout");
  if (out) out.onclick = async () => { await signOut(); toast("Signed out"); renderAccount(); };
}

async function exportData(kind) {
  const list = await getReceipts();
  if (!list.length) return toast("No receipts to export");
  if (!ent.isPro && kind !== "csv") return goPro("Advanced export is a Pro feature");
  const rows = ent.isPro ? list : list.slice(0, 25);
  if (kind === "csv") { download(`glean-${stamp()}.csv`, toCSV(rows, settings.categories)); toast(ent.isPro || list.length <= 25 ? "Exported CSV" : `Exported 25 of ${list.length}`); }
  else if (kind === "acc") { download(`glean-accounting-${stamp()}.csv`, toAccountingCSV(list, settings.categories)); toast("Accounting CSV ready"); }
  else { download(`glean-backup-${stamp()}.json`, toJSON(list), "application/json"); toast("Backup saved"); }
}

function importFromFile(e) {
  const file = e.target.files?.[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = async () => {
    try {
      const data = JSON.parse(reader.result);
      const arr = Array.isArray(data) ? data : data.receipts || [];
      if (!arr.length) return toast("No receipts found in file");
      await importReceipts(arr);
      toast(`Imported ${arr.length} receipts`);
    } catch { toast("Couldn't read that file"); }
    e.target.value = "";
  };
  reader.readAsText(file);
}

async function renderAccount() {
  const s = await getSession();
  const name = $("#acc-name");
  if (!name) return;
  if (s) {
    name.textContent = s.name || "Signed in";
    $("#acc-email").textContent = `${s.email} · via ${providerLabel(s.provider)}${s.demo ? " (demo)" : ""}`;
    $("#acc-signout").hidden = false;
  } else {
    name.textContent = "Not signed in";
    $("#acc-email").textContent = "Sign in from the Glean popup to use Glean.";
    $("#acc-signout").hidden = true;
  }
}

function goPro(reason) {
  toast(reason);
  document.querySelector(".section").scrollIntoView({ behavior: "smooth", block: "start" });
  const card = $("#planBox .featured");
  if (card) { card.classList.remove("pop"); void card.offsetWidth; card.classList.add("pop"); }
}

function toast(text) {
  const t = el("div", { class: "toast" }, text);
  $("#toastHost").appendChild(t);
  setTimeout(() => { t.classList.add("out"); setTimeout(() => t.remove(), 240); }, 2200);
}
