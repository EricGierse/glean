/* Glean — content script (classic, no imports). Detects receipts on the page and
   offers a one-click capture via an isolated Shadow-DOM prompt. All parsing is local. */
(() => {
  if (window.top !== window.self) return; // top frame only

  const SYMBOL_TO_CODE = { "$": "USD", "€": "EUR", "£": "GBP", "R$": "BRL", "¥": "JPY", "₹": "INR" };
  const AMOUNT_RE = /(R\$|[$€£¥₹])\s?(\d{1,3}(?:[.,]\d{3})*(?:[.,]\d{2})?|\d+(?:[.,]\d{2})?)/g;
  const TOTAL_WORDS = ["grand total", "total paid", "amount paid", "you paid", "amount due", "order total", "total due", "total"];

  function normalizeAmount(s) {
    if (/,\d{2}$/.test(s)) s = s.replace(/\./g, "").replace(",", ".");
    else s = s.replace(/,/g, "");
    return Number(s) || 0;
  }
  const hostname = () => location.hostname.replace(/^www\./, "");

  /* ---------- Parsing ---------- */
  function parseJsonLd() {
    const scripts = document.querySelectorAll('script[type="application/ld+json"]');
    const nodes = [];
    scripts.forEach((s) => {
      try {
        let data = JSON.parse(s.textContent);
        const push = (d) => { if (d && typeof d === "object") nodes.push(d); };
        if (Array.isArray(data)) data.forEach(push);
        else { push(data); if (Array.isArray(data["@graph"])) data["@graph"].forEach(push); }
      } catch { /* ignore */ }
    });
    for (const n of nodes) {
      const types = [].concat(n["@type"] || []).map((t) => String(t).toLowerCase());
      if (types.some((t) => t.includes("order"))) {
        const spec = n.priceSpecification || {};
        const amount = num(n.total ?? n.orderTotal ?? spec.price);
        if (amount != null) return finalize({
          merchant: name(n.seller || n.merchant || n.broker),
          amount, currency: n.priceCurrency || spec.priceCurrency,
          date: dateOnly(n.orderDate), confidence: "high",
        });
      }
      if (types.some((t) => t.includes("invoice"))) {
        const due = n.totalPaymentDue || {};
        const amount = num(due.price ?? n.total);
        if (amount != null) return finalize({
          merchant: name(n.provider || n.broker || n.seller),
          amount, currency: due.priceCurrency,
          date: dateOnly(n.paymentDueDate || n.invoiceDate), confidence: "high",
        });
      }
    }
    return null;
  }

  function parseHeuristic() {
    const text = (document.body?.innerText || "").slice(0, 200000);
    const lines = text.split("\n").map((l) => l.trim()).filter(Boolean);
    let best = null; // {amount, currency, rank}
    for (const line of lines) {
      const low = line.toLowerCase();
      const wordIdx = TOTAL_WORDS.findIndex((w) => low.includes(w));
      if (wordIdx === -1) continue;
      const m = [...line.matchAll(AMOUNT_RE)].pop();
      if (!m) continue;
      const rank = TOTAL_WORDS.length - wordIdx; // earlier word = stronger
      if (!best || rank > best.rank) {
        best = { amount: normalizeAmount(m[2]), currency: SYMBOL_TO_CODE[m[1]] || "USD", rank };
      }
    }
    if (!best) {
      // fall back to the largest currency amount on the page
      const all = [...text.matchAll(AMOUNT_RE)].map((m) => ({ amount: normalizeAmount(m[2]), currency: SYMBOL_TO_CODE[m[1]] || "USD" }));
      if (!all.length) return null;
      best = all.sort((a, b) => b.amount - a.amount)[0];
      best.low = true;
    }
    return finalize({
      merchant: metaMerchant(), amount: best.amount, currency: best.currency,
      date: pageDate(), confidence: best.low ? "low" : "medium",
    });
  }

  function finalize({ merchant, amount, currency, date, confidence }) {
    if (amount == null || !(amount > 0)) return null;
    return {
      merchant: (merchant || hostname() || "Unknown merchant").slice(0, 80),
      amount, currency: currency || "USD",
      date: date || new Date().toISOString().slice(0, 10),
      source: "auto", url: location.href, confidence,
    };
  }

  const num = (v) => { const n = Number(String(v ?? "").replace(/[^0-9.]/g, "")); return isFinite(n) && n > 0 ? n : null; };
  const name = (o) => (typeof o === "string" ? o : o?.name || o?.legalName || "") || "";
  const dateOnly = (v) => { const d = new Date(v); return isNaN(d) ? null : d.toISOString().slice(0, 10); };
  function metaMerchant() {
    const og = document.querySelector('meta[property="og:site_name"]')?.content;
    if (og) return og;
    const t = (document.title || "").split(/[|\-–—:]/)[0].trim();
    return t && t.length < 50 ? t : hostname();
  }
  function pageDate() {
    const t = document.querySelector("time[datetime]")?.getAttribute("datetime");
    const d = t && dateOnly(t);
    return d || new Date().toISOString().slice(0, 10);
  }
  function parsePage() { return parseJsonLd() || parseHeuristic(); }

  /* ---------- Messaging ---------- */
  chrome.runtime.onMessage.addListener((msg, _s, sendResponse) => {
    if (msg?.type === "GLEAN_PARSE_PAGE") { sendResponse({ receipt: parsePage() }); return; }
    if (msg?.type === "GLEAN_TOAST") { showToast(msg.text); sendResponse?.({ ok: true }); return; }
  });

  /* ---------- Auto-capture flow ---------- */
  chrome.runtime.sendMessage({ type: "GLEAN_GET_ENTITLEMENTS" }, (res) => {
    if (chrome.runtime.lastError || !res) return;
    if (!res.ent?.isPro || !res.autoCapture) return;
    if ((res.blocklist || []).some((h) => hostname().includes(h))) return;
    setTimeout(() => {
      const r = parsePage();
      if (!r || r.confidence === "low") return;
      const key = "glean_seen_" + btoa(unescape(encodeURIComponent(r.merchant + r.amount + location.pathname))).slice(0, 24);
      if (sessionStorage.getItem(key)) return;
      sessionStorage.setItem(key, "1");
      if (res.captureToast !== false) showPrompt(r);
    }, 1200);
  });

  /* ---------- Shadow-DOM UI ---------- */
  let host, root;
  function ensureRoot() {
    if (root) return root;
    host = document.createElement("div");
    host.id = "glean-host";
    host.style.cssText = "all:initial; position:fixed; z-index:2147483647;";
    document.documentElement.appendChild(host);
    root = host.attachShadow({ mode: "open" });
    root.innerHTML = `<style>
      :host{ all:initial; }
      *{ box-sizing:border-box; font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,system-ui,sans-serif; }
      .wrap{ position:fixed; right:18px; bottom:18px; display:flex; flex-direction:column; gap:10px; align-items:flex-end; }
      .card{ width:300px; background:#fff; color:#131820; border-radius:16px; padding:14px;
        box-shadow:0 18px 46px rgba(8,12,18,.28); border:1px solid #eceef1;
        animation:gin .42s cubic-bezier(.34,1.4,.5,1) both; }
      .card.out{ animation:gout .22s ease forwards; }
      .top{ display:flex; align-items:center; gap:9px; margin-bottom:9px; }
      .logo{ width:26px; height:26px; border-radius:7px; flex:none; }
      .ttl{ font-size:13px; font-weight:800; letter-spacing:-.01em; }
      .x{ margin-left:auto; border:none; background:transparent; cursor:pointer; color:#8b94a2; font-size:17px; line-height:1; padding:4px; border-radius:6px; }
      .x:hover{ background:#f1f3f5; color:#131820; }
      .merch{ font-size:14px; font-weight:700; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
      .amt{ font-size:22px; font-weight:800; letter-spacing:-.02em; margin:2px 0 12px; }
      .amt small{ color:#8b94a2; font-size:12px; font-weight:600; margin-left:6px; }
      .btns{ display:flex; gap:8px; }
      button.act{ flex:1; font:inherit; font-weight:700; font-size:13px; padding:9px; border-radius:9px; cursor:pointer; border:1px solid transparent; transition:transform .12s ease, filter .2s ease; }
      button.act:active{ transform:scale(.96); }
      .primary{ background:linear-gradient(135deg,#10b981,#059669); color:#fff; box-shadow:0 4px 14px -3px #10b981; }
      .primary:hover{ filter:brightness(1.05); }
      .ghost{ background:#f1f3f5; color:#131820; max-width:96px; }
      .ghost:hover{ background:#e9edf1; }
      .ok{ display:flex; align-items:center; gap:8px; font-weight:700; font-size:13.5px; color:#059669; }
      .toast{ background:#131820; color:#fff; padding:10px 15px; border-radius:999px; font-size:13px; font-weight:700;
        box-shadow:0 14px 36px rgba(8,12,18,.4); animation:gin .42s cubic-bezier(.34,1.4,.5,1) both; }
      .toast.out{ animation:gout .22s ease forwards; }
      @keyframes gin{ from{ opacity:0; transform:translateY(16px) scale(.96);} to{ opacity:1; transform:none;} }
      @keyframes gout{ to{ opacity:0; transform:translateY(12px);} }
      @media (prefers-reduced-motion: reduce){ .card,.toast{ animation-duration:.001ms; } }
    </style><div class="wrap" id="wrap"></div>`;
    return root;
  }

  const LOGO = chrome.runtime.getURL("icons/logo.svg");
  const fmt = (a, c) => { try { return new Intl.NumberFormat(undefined, { style: "currency", currency: c }).format(a); } catch { return c + " " + a.toFixed(2); } };

  function showPrompt(r) {
    ensureRoot();
    const wrap = root.getElementById("wrap");
    const card = document.createElement("div");
    card.className = "card";
    card.innerHTML = `
      <div class="top">
        <img class="logo" src="${LOGO}" alt="">
        <span class="ttl">Receipt detected</span>
        <button class="x" title="Dismiss">✕</button>
      </div>
      <div class="merch"></div>
      <div class="amt"></div>
      <div class="btns">
        <button class="act primary">Capture receipt</button>
        <button class="act ghost">Edit…</button>
      </div>`;
    card.querySelector(".merch").textContent = r.merchant;
    card.querySelector(".amt").innerHTML = `${fmt(r.amount, r.currency)}<small>${r.confidence === "medium" ? "auto-detected" : "detected"}</small>`;
    const close = (then) => { card.classList.add("out"); setTimeout(() => { card.remove(); then && then(); }, 200); };
    card.querySelector(".x").onclick = () => close();
    card.querySelector(".ghost").onclick = () => { chrome.runtime.sendMessage({ type: "GLEAN_CAPTURE", payload: r }); openPopupHint(card); };
    card.querySelector(".primary").onclick = (e) => {
      const btn = e.currentTarget; btn.textContent = "Saving…"; btn.disabled = true;
      chrome.runtime.sendMessage({ type: "GLEAN_CAPTURE", payload: r }, (res) => {
        card.querySelector(".btns").outerHTML = `<div class="ok">✓ ${res?.duplicate ? "Already saved" : "Saved to Glean"}</div>`;
        setTimeout(() => close(), 1400);
      });
    };
    wrap.appendChild(card);
  }

  function openPopupHint(card) {
    card.querySelector(".btns").outerHTML = `<div class="ok">✓ Saved — open Glean to edit</div>`;
    setTimeout(() => { card.classList.add("out"); setTimeout(() => card.remove(), 200); }, 1600);
  }

  function showToast(text) {
    ensureRoot();
    const wrap = root.getElementById("wrap");
    const t = document.createElement("div");
    t.className = "toast";
    t.textContent = text;
    wrap.appendChild(t);
    setTimeout(() => { t.classList.add("out"); setTimeout(() => t.remove(), 240); }, 2200);
  }
})();
