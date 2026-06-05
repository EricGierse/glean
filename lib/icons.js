// Glean — inline SVG icons. Sized with 1em (set font-size on the parent),
// colored with currentColor. Use via el("span",{html: ICONS.crown}) or innerHTML.
const wrap = (inner, fill = "none") =>
  `<svg viewBox="0 0 24 24" width="1em" height="1em" fill="${fill}" ${fill === "none" ? 'stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"' : ""} style="display:inline-block;vertical-align:-0.14em">${inner}</svg>`;

export const ICONS = {
  crown: wrap('<path d="M2.6 8.3l4.2 3.1L11 4.6a1.2 1.2 0 0 1 2 0l4.2 6.8 4.2-3.1c.8-.6 1.9.2 1.6 1.2l-2.2 7.9a1.2 1.2 0 0 1-1.2.9H6.4a1.2 1.2 0 0 1-1.2-.9L3 9.5c-.3-1 .8-1.8 1.6-1.2z"/><path d="M7 20.5h10" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/>', "currentColor"),
  sparkle: wrap('<path d="M12 2c.45 3.9 2.6 6.05 6.5 6.5-3.9.45-6.05 2.6-6.5 6.5-.45-3.9-2.6-6.05-6.5-6.5C9.4 8.05 11.55 5.9 12 2z"/><path d="M19 14c.2 1.6 1.1 2.5 2.7 2.7-1.6.2-2.5 1.1-2.7 2.7-.2-1.6-1.1-2.5-2.7-2.7 1.6-.2 2.5-1.1 2.7-2.7z"/>', "currentColor"),
  scan: wrap('<path d="M4 8V6a2 2 0 0 1 2-2h2"/><path d="M16 4h2a2 2 0 0 1 2 2v2"/><path d="M20 16v2a2 2 0 0 1-2 2h-2"/><path d="M8 20H6a2 2 0 0 1-2-2v-2"/><rect x="7.5" y="9" width="9" height="6" rx="1"/>'),
  camera: wrap('<path d="M3 8a2 2 0 0 1 2-2h2l1.2-1.6A1 1 0 0 1 9 4h6a1 1 0 0 1 .8.4L17 6h2a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><circle cx="12" cy="13" r="3.2"/>'),
  sprout: wrap('<path d="M12 22V11"/><path d="M12 12C12 8.5 9.2 6 5.2 6 5.2 9.5 8 12 12 12z"/><path d="M12 13.5c0-2.9 2.6-5 6.3-5 0 2.9-2.6 5-6.3 5z"/>'),
  fileText: wrap('<path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"/><path d="M14 3v5h5M9 13h6M9 17h4"/>'),
  chart: wrap('<path d="M5 21V10M12 21V4M19 21v-8"/><path d="M3 21h18"/>'),
  archive: wrap('<rect x="3" y="4" width="18" height="4" rx="1"/><path d="M5 8v11a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V8"/><path d="M10 12h4"/>'),
  lock: wrap('<rect x="4.5" y="11" width="15" height="9" rx="2"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/>'),
  check: wrap('<path d="M4 12.5l5 5L20 6" stroke-width="2.4"/>'),
  zap: wrap('<path d="M13 2L4.5 13.2c-.4.5 0 1.3.7 1.3H11l-1 7.5 8.5-11.2c.4-.5 0-1.3-.7-1.3H12l1-7.5z"/>', "currentColor"),
  gear: wrap('<circle cx="12" cy="12" r="3"/><path d="M19.4 13.5a1.7 1.7 0 0 0 .3 1.9l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-2.9 1.2V21a2 2 0 0 1-4 0v-.2a1.7 1.7 0 0 0-2.9-1.1l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0-1.2-2.9H3a2 2 0 0 1 0-4h.2a1.7 1.7 0 0 0 1.1-2.9l-.1-.1A2 2 0 1 1 7 4.2l.1.1a1.7 1.7 0 0 0 1.9.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 0 1 4 0v.2a1.7 1.7 0 0 0 2.9 1.1l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.9V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 0 1 0 4h-.2a1.7 1.7 0 0 0-1.4.5z"/>'),
};

export const icon = (name) => ICONS[name] || "";
