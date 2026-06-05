// Glean — background service worker (MV3). Owns trial init, the right-click capture,
// the toolbar badge, and message routing from content scripts / popup.
import { initLicense, getEntitlements } from "./lib/license.js";
import { getLicense, getSettings, getReceipts, addReceipt, onChanged } from "./lib/store.js";
import { guessCategory } from "./lib/categories.js";

const BADGE_COLOR = "#059669";

chrome.runtime.onInstalled.addListener(async ({ reason }) => {
  await initLicense();
  await getSettings(); // materialize defaults via merge on first read
  buildMenus();
  updateBadge();
  if (reason === "install") {
    chrome.tabs.create({ url: chrome.runtime.getURL("options.html#welcome") });
  }
});

chrome.runtime.onStartup?.addListener(() => { buildMenus(); updateBadge(); });

function buildMenus() {
  chrome.contextMenus.removeAll(() => {
    chrome.contextMenus.create({
      id: "glean-capture-selection",
      title: 'Capture selection as a receipt in Glean',
      contexts: ["selection"],
    });
    chrome.contextMenus.create({
      id: "glean-capture-page",
      title: "Glean: capture a receipt from this page",
      contexts: ["page"],
    });
  });
}

chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  if (info.menuItemId === "glean-capture-selection") {
    const parsed = parseText(info.selectionText || "");
    const settings = await getSettings();
    const merchant = parsed.merchant || hostnameOf(tab?.url) || (tab?.title || "Unknown merchant").slice(0, 60);
    const res = await addReceipt({
      merchant,
      amount: parsed.amount || 0,
      currency: parsed.currency || settings.currency,
      category: guessCategory(`${merchant} ${info.selectionText || ""}`, settings.categories),
      source: "selection",
      url: tab?.url || "",
      note: (info.selectionText || "").slice(0, 140),
    });
    toast(tab?.id, res.duplicate ? "Already captured" : `Captured ${merchant}`);
  } else if (info.menuItemId === "glean-capture-page") {
    // Delegate to the content script's page parser.
    try {
      const r = await chrome.tabs.sendMessage(tab.id, { type: "GLEAN_PARSE_PAGE" });
      if (r?.receipt && r.receipt.amount) {
        const settings = await getSettings();
        const res = await addReceipt({ ...r.receipt, category: r.receipt.category || guessCategory(r.receipt.merchant, settings.categories) });
        toast(tab.id, res.duplicate ? "Already captured" : `Captured ${res.receipt.merchant}`);
      } else {
        toast(tab.id, "No receipt found on this page");
      }
    } catch {
      toast(tab.id, "Can't read this page");
    }
  }
});

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  (async () => {
    if (msg?.type === "GLEAN_GET_ENTITLEMENTS") {
      const ent = getEntitlements(await getLicense());
      const s = await getSettings();
      sendResponse({ ent, autoCapture: s.autoCapture, captureToast: s.captureToast, blocklist: s.blocklist });
    } else if (msg?.type === "GLEAN_CAPTURE") {
      const settings = await getSettings();
      const res = await addReceipt({
        ...msg.payload,
        category: msg.payload.category || guessCategory(`${msg.payload.merchant} ${msg.payload.note || ""}`, settings.categories),
        url: msg.payload.url || sender?.tab?.url || "",
      });
      sendResponse({ ok: true, ...res });
    } else {
      sendResponse({ ok: false });
    }
  })();
  return true; // async response
});

onChanged((changes) => { if (changes.glean_receipts) updateBadge(); });

async function updateBadge() {
  const list = await getReceipts();
  const n = list.length;
  chrome.action.setBadgeBackgroundColor({ color: BADGE_COLOR });
  chrome.action.setBadgeText({ text: n ? (n > 999 ? "999+" : String(n)) : "" });
}

function toast(tabId, text) {
  if (!tabId) return;
  chrome.tabs.sendMessage(tabId, { type: "GLEAN_TOAST", text }).catch(() => {});
}

/* ---- tiny text parser for right-click selections ---- */
const SYMBOL_TO_CODE = { "$": "USD", "€": "EUR", "£": "GBP", "R$": "BRL", "¥": "JPY", "₹": "INR" };
function parseText(text) {
  const out = {};
  const m = text.match(/(R\$|[$€£¥₹])\s?([0-9]{1,3}(?:[.,][0-9]{3})*(?:[.,][0-9]{2})?)/);
  if (m) {
    out.currency = SYMBOL_TO_CODE[m[1]] || "USD";
    out.amount = normalizeAmount(m[2]);
  } else {
    const m2 = text.match(/\b([0-9]+[.,][0-9]{2})\b/);
    if (m2) out.amount = normalizeAmount(m2[1]);
  }
  return out;
}
function normalizeAmount(s) {
  // handle 1.234,56 and 1,234.56
  if (/,\d{2}$/.test(s)) s = s.replace(/\./g, "").replace(",", ".");
  else s = s.replace(/,/g, "");
  return Number(s) || 0;
}
function hostnameOf(url) {
  try { return new URL(url).hostname.replace(/^www\./, ""); } catch { return ""; }
}
