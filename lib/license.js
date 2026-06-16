// Glean — Pro entitlement logic.
//
// Billing model:
//   • Pro Monthly — $4 / mo    • Pro Yearly — $30 / yr  (~37% off · 4 months free)
//   • There is NO free standalone trial. New users land on the Free tier.
//   • When you SUBSCRIBE (monthly or yearly), your first 3 days are free
//     (Stripe `trial_period_days: 3`), then billing begins. You cannot use
//     Pro for 3 days without starting a paid subscription.
//
// Free tier = manual capture + basic CSV. Pro unlocks auto-capture, AI receipt scan,
// unlimited/QuickBooks export, custom categories, tax & multi-currency.
//
// NOTE: validation here is offline/demo. In production the source of truth is your
// backend (Stripe subscription status synced into the extension). See AI_PROMPT.md.

import { getLicense, saveLicense } from "./store.js";

export const FREE_TRIAL_DAYS = 3; // first days free on a NEW paid subscription (Stripe trial)

export const PRICING = {
  monthly: { id: "monthly", label: "Monthly", price: 4, per: "month", note: "3 days free, then billed monthly" },
  yearly: { id: "yearly", label: "Yearly", price: 30, per: "year", note: "4 months free vs monthly", badge: "4 months free" },
};

export const CHECKOUT_URL = "https://glean.app/upgrade"; // TODO: real Stripe Checkout link (set trial_period_days: 3)
export const DEMO_KEY = "GLEAN-PRO-DEMO-2026";            // works offline for testing

const DAY = 86400000;

export async function initLicense() {
  const cur = await getLicense();
  if (cur && cur.status) return cur;
  // No auto-trial: new installs are Free until they start a paid subscription.
  return saveLicense({ status: "free", installedAt: Date.now() });
}

export function getEntitlements(license) {
  if (license && license.status === "pro") {
    const now = Date.now();
    const inFreeWindow = !!license.trialEndsAt && now < license.trialEndsAt;
    const freeDaysLeft = inFreeWindow ? Math.max(1, Math.ceil((license.trialEndsAt - now) / DAY)) : 0;
    return { tier: "pro", isPro: true, plan: license.plan || "pro", inFreeWindow, freeDaysLeft };
  }
  return { tier: "free", isPro: false, inFreeWindow: false, freeDaysLeft: 0 };
}

// Called when a paid subscription begins (production: Stripe webhook → backend → synced here).
// Grants Pro immediately; the first FREE_TRIAL_DAYS are free before the first charge.
export async function subscribe(plan = "monthly") {
  const now = Date.now();
  return saveLicense({ status: "pro", plan, subscribedAt: now, trialEndsAt: now + FREE_TRIAL_DAYS * DAY });
}

export function validateKey(key) {
  const k = (key || "").trim().toUpperCase();
  if (k === DEMO_KEY) return { ok: true, plan: "pro" };
  if (/^GLEAN-[A-Z0-9]{3,}-[A-Z0-9]{3,}(-[A-Z0-9]{2,})?$/.test(k)) return { ok: true, plan: "pro" };
  return { ok: false, error: "That doesn't look like a valid Glean key." };
}

export async function activateKey(key) {
  const res = validateKey(key);
  if (!res.ok) return res;
  // Activated via key/checkout = already paying → no free window.
  await saveLicense({ status: "pro", plan: res.plan, key: key.trim(), activatedAt: Date.now() });
  return { ok: true, plan: res.plan };
}

export async function deactivate() {
  return saveLicense({ status: "free" });
}

export async function getEntitlementsNow() {
  return getEntitlements(await getLicense());
}
