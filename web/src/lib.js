// Labels and small pure helpers shared by the components. No colours here: state words go to data-state attributes and the stylesheet maps them to tokens.

export const TRACK_LABELS = {
  foundations: "Foundations",
  learn: "Learn",
  controls: "Controls",
  hitl: "Human in the loop",
  demo: "Demos",
  attacks: "Attacks",
  tools: "Tools",
  nhi: "Federated identity (NHI)",
};

export const NEEDS_LABELS = {
  idp: "identity provider",
  gw: "gateway",
  authz: "policy decision",
  mfa: "step-up (MFA)",
  llm: "language model",
  privilege: "Privilege",
  bff: "app backend (BFF)",
  a2a: "agent to agent",
};

// Extra pages a use case can open (the manifest's `opens` field). They are not in the side nav until a run brings one in, and Reset removes them.
// `kinds` picks which hops of the run belong on that page (prefix match when it ends in a dash); an empty match shows every hop.
export const EXTRAS = {
  consent: { label: "Consent and step-up", about: "The product shows the consent and step-up screens on their own page. Here you see the sign-in, consent and actor-token hops of your run.", kinds: ["sign-in", "consent", "actor-token"] },
  approval: { label: "Human approval", about: "The product holds a risky write until a person approves it. Here you see the hops that decide, hold and release it.", kinds: ["authorize-decision", "tool-held", "hitl-receipt", "ciba-authorize", "ciba-poll"] },
  a2a: { label: "Agent to agent", about: "The product shows agent-to-agent calls on their own page. Here you see the agent-card, delegation and trust hops of your run.", kinds: ["a2a-", "verified-trust-issuance", "personal-agent-lookup", "id-jag-", "privilege-gateway-leg"] },
  "group-board": { label: "Group policy", about: "The product shows which group may use a sensitive tool on a group-policy board. Here you see the decision and the tool hops of your run.", kinds: ["authorize-decision", "tool-refused", "tool-dispatched"] },
  obo: { label: "On behalf of", about: "The product shows the on-behalf-of exchange on its own page. Here you see the token-exchange hops of your run.", kinds: ["token-exchange", "actor-token", "id-jag-", "exchange-skipped"] },
  "learning-link": { label: "Learning page", about: "This use case is a guided page in the product. The lab does not recompute it; it shows the page the product would open, as a plain label.", kinds: ["guided"] },
};

export const extraHops = (opens, hops) => {
  const spec = Object.hasOwn(EXTRAS, opens) ? EXTRAS[opens].kinds : [];
  const hit = hops.filter((h) => spec.some((k) => (k.endsWith("-") ? h.kind.startsWith(k) : h.kind === k)));
  return hit.length ? hit : hops;
};

// Hop counts count the hops that ran; the not-in-path ones (verdict skip) are named as "+M not in this run" wherever a total is shown.
export const ranCount = (hops) => (hops || []).filter((h) => h.verdict !== "skip").length;
export const notRunText = (hops, sep = " · ") => { const m = (hops || []).length - ranCount(hops); return m > 0 ? `${sep}+${m} not in this run` : ""; };

// An outcome word to a state. The word is always shown, so colour never carries the meaning alone.
export function outcomeState(outcome) {
  const o = String(outcome || "");
  if (o.startsWith("DENY") || o === "PERMIT_THEN_DENY") return "bad";
  if (o === "STEP_UP" || o === "HITL_REQUIRED" || o === "CIBA") return "warn";
  if (o === "PERMIT" || o === "DELEGATE_AND_EXECUTE" || o === "LIVE_OK" || o === "REAL_PERMIT") return "ok";
  if (o === "REAL_HOLD") return "warn";
  if (o.startsWith("REAL_")) return "bad";
  if (o.startsWith("LIVE_")) return "bad";
  return "info";
}

export const verdictState = (v) => (v === "ok" ? "ok" : v === "held" ? "warn" : v ? "bad" : "info");

// What the trigger of a use case is, as plain text. A link is a path inside the AI-DEMO2 product: shown as a label, never as a link.
export function triggerText(t) {
  if (!t) return "";
  if (t.type === "chip") return `chat chip: "${t.text}"`;
  if (t.type === "attack") return `staged attack: ${t.sim}`;
  if (t.type === "link") return `AI-DEMO2 page (label only): ${t.path}`;
  if (t.type === "edu") return `AI-DEMO2 panel (label only): ${t.panel}${t.tab ? ` / ${t.tab}` : ""}`;
  return String(t.type);
}

export const HOP_RE = /^[a-z0-9-]+$/;

// Search text for one use case, lower-cased.
export const haystack = (u) => `${u.id} ${u.title} ${u.track} ${u.buyerStory} ${u.expectedOutcome} ${u.needs.join(" ")} ${u.flag || ""} ${triggerText(u.trigger)}`.toLowerCase();

// A fresh W3C traceparent for the browser's call (rule 14). The server continues this trace, so the run's trace id is the one the browser started.
export function newTraceparent() {
  const bytes = new Uint8Array(24);
  const c = typeof window !== "undefined" && window.crypto && window.crypto.getRandomValues ? window.crypto : { getRandomValues: (a) => a.map(() => Math.floor(Math.random() * 256)) };
  c.getRandomValues(bytes);
  bytes[0] |= 1; bytes[16] |= 1; // never an all-zero id
  const h = (a) => [...a].map((b) => b.toString(16).padStart(2, "0")).join("");
  return `00-${h(bytes.slice(0, 16))}-${h(bytes.slice(16))}-01`;
}

// The hosted build (mock only): the note beside its disabled Real button.
export const HOSTED_REAL_NOTE = "Mock only on the hosted copy. Run the lab locally for Real.";
