// Quick Config: the per-workspace display choices (brain, evidence views, text size, presenter). Mode is NOT here: the server owns it (rule 19).
// Kept in localStorage under the workspace id; storage can be missing or throw (private mode), so every access is guarded and the defaults hold.

export const DIAGRAMS = ["sequence", "reel", "topology"];
export const VIEWS = [...DIAGRAMS, "tokens"];
export const VIEW_LABEL = { sequence: "Sequence", reel: "Movie reel", topology: "Topology", tokens: "Tokens" };
export const TEXT_SIZES = [90, 100, 115, 130];
export const BRAINS = ["scripted", "llama"];
export const ROUTINGS = ["fallback", "llm-only"];
export const DEFAULTS = Object.freeze({ brain: "scripted", routing: "fallback", views: { sequence: "embedded", reel: "off", topology: "off", tokens: "embedded" }, tab: "sequence", text: 100, presenter: false });

const keyFor = (ws) => `cal.qc.${ws}`;
const isState = (v) => v === "off" || v === "embedded";

// A stored value is used only where it is one of the known choices; anything else falls back to the default.
export function cleanConfig(raw) {
  const c = { ...DEFAULTS, views: { ...DEFAULTS.views } };
  if (!raw || typeof raw !== "object") return c;
  if (raw.views && typeof raw.views === "object") for (const v of VIEWS) if (Object.hasOwn(raw.views, v) && isState(raw.views[v])) c.views[v] = raw.views[v];
  const first = DIAGRAMS.find((d) => c.views[d] === "embedded");
  for (const d of DIAGRAMS) if (d !== first && c.views[d] === "embedded") c.views[d] = "off"; // a hand-edited store with two embedded keeps the first
  if (VIEWS.includes(raw.tab)) c.tab = raw.tab;
  if (BRAINS.includes(raw.brain)) c.brain = raw.brain;
  if (ROUTINGS.includes(raw.routing)) c.routing = raw.routing;
  if (TEXT_SIZES.includes(raw.text)) c.text = raw.text;
  if (typeof raw.presenter === "boolean") c.presenter = raw.presenter;
  return c;
}

export function loadConfig(ws) {
  try { const s = window.localStorage.getItem(keyFor(ws)); return cleanConfig(s ? JSON.parse(s) : null); } catch { return cleanConfig(null); }
}
export function saveConfig(ws, c) {
  try { window.localStorage.setItem(keyFor(ws), JSON.stringify(c)); } catch { /* storage unavailable: the choice lasts for this page only */ }
}

// Only one diagram embeds at a time: embedding one moves the one that was embedded to Off. Tokens are not a diagram and always may embed.
export function setView(c, view, state) {
  const views = { ...c.views, [view]: state };
  if (state === "embedded" && DIAGRAMS.includes(view)) for (const d of DIAGRAMS) if (d !== view && views[d] === "embedded") views[d] = "off";
  let { tab } = c;
  if (state === "embedded") tab = view;
  else if (tab === view) tab = DIAGRAMS.find((d) => views[d] === "embedded") || (views.tokens === "embedded" ? "tokens" : view);
  return { ...c, views, tab };
}
// A tab click on a diagram embeds that diagram (the same rule as Quick Config); a click on Tokens just shows it.
export const chooseTab = (c, view) => (DIAGRAMS.includes(view) ? setView(c, view, "embedded") : { ...c, tab: view });
