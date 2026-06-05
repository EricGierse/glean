// Glean — default expense categories (tuned for freelancers & small businesses).
// Each: id, name, color, and keyword hints used by the auto-categorizer.

export const DEFAULT_CATEGORIES = [
  { id: "software", name: "Software & SaaS", color: "#6366f1", keywords: ["subscription", "saas", "license", "app", "plan", "hosting", "domain", "cloud", "github", "figma", "notion", "adobe", "slack", "zoom"] },
  { id: "advertising", name: "Advertising", color: "#ec4899", keywords: ["ads", "ad ", "campaign", "boost", "promote", "meta ads", "google ads", "sponsor"] },
  { id: "travel", name: "Travel", color: "#0ea5e9", keywords: ["flight", "hotel", "airbnb", "uber", "lyft", "taxi", "train", "rental", "booking", "airlines", "lodging"] },
  { id: "meals", name: "Meals & Entertainment", color: "#f59e0b", keywords: ["restaurant", "cafe", "coffee", "doordash", "ubereats", "grubhub", "lunch", "dinner", "bar"] },
  { id: "office", name: "Office & Supplies", color: "#14b8a6", keywords: ["office", "supplies", "staples", "paper", "desk", "chair", "stationery"] },
  { id: "hardware", name: "Hardware & Equipment", color: "#8b5cf6", keywords: ["laptop", "monitor", "keyboard", "phone", "camera", "apple store", "best buy", "device", "ssd"] },
  { id: "fees", name: "Fees & Banking", color: "#64748b", keywords: ["fee", "interest", "stripe", "paypal", "transaction", "wire", "bank", "processing"] },
  { id: "education", name: "Education", color: "#22c55e", keywords: ["course", "udemy", "coursera", "book", "training", "conference", "ticket", "workshop"] },
  { id: "utilities", name: "Utilities & Internet", color: "#ef4444", keywords: ["internet", "phone bill", "electric", "utility", "wifi", "mobile", "verizon", "att"] },
  { id: "other", name: "Other", color: "#94a3b8", keywords: [] },
];

export function guessCategory(text = "", categories = DEFAULT_CATEGORIES) {
  const t = text.toLowerCase();
  let best = "other";
  let bestHits = 0;
  for (const c of categories) {
    let hits = 0;
    for (const k of c.keywords || []) if (t.includes(k)) hits++;
    if (hits > bestHits) { bestHits = hits; best = c.id; }
  }
  return best;
}

export const categoryById = (id, cats = DEFAULT_CATEGORIES) =>
  cats.find((c) => c.id === id) || cats.find((c) => c.id === "other") || { id: "other", name: "Other", color: "#94a3b8" };
