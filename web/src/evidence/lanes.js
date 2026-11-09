import { visible } from "../safeText";

// Actors of the demo-hop/1 format (shared/hop-detail/README.md): label, initials, lane token (evidence.css), and the
// teaching text an actor card shows. An id this table does not know falls back to the neutral lane.
export const ACTORS = {
  browser: { label: "Browser", initials: "BR", lane: "browser", role: "The customer's browser. It signs in with a pi.flow (no redirect) and gives consent. This lab hands it the user token so you can follow it; a production app keeps tokens in the back end.", sees: "the sign-in, the consent screen and, in this lab, the user token", never: "the agent's token or any secret" },
  page: { label: "Page", initials: "PG", lane: "page", role: "The web page the agent is embedded in.", sees: "what the customer types and the agent's replies", never: "tokens or secrets" },
  agent: { label: "Agent", initials: "AG", lane: "agent", role: "The AI agent. It plans the call and asks the back end to run a tool for the customer.", sees: "the customer's request and the tool result", never: "the customer's password or token" },
  bff: { label: "BFF", initials: "BF", lane: "bff", role: "The back end for the front end. A confidential client that keeps the tokens on the server and asks for the exchange.", sees: "the user token, the agent token and the exchanged token", never: "the customer's password" },
  idp: { label: "Mock IdP", initials: "ID", lane: "idp", role: "The identity provider (mock). It signs the customer in, records consent and issues and exchanges tokens.", sees: "credentials at sign-in and every token it issues", never: "what the tool returns" },
  "mcp-as": { label: "MCP auth server", initials: "MA", lane: "mcp-as", role: "The authorization server in front of the MCP server.", sees: "the grant it redeems", never: "the user's password" },
  gateway: { label: "Gateway", initials: "GW", lane: "gateway", role: "Checks every call before a tool sees it: signature, audience, expiry, act, scope and edge policy.", sees: "the delegated token and the tool call", never: "the user password or the agent secret" },
  authorize: { label: "Authorize", initials: "AZ", lane: "authorize", role: "The policy decision point. It answers PERMIT, DENY or a step-up for each call.", sees: "subject, actor, action and context", never: "the token itself" },
  mcp: { label: "MCP tool", initials: "MC", lane: "mcp", role: "The MCP server that runs the tool. It checks the bearer again instead of trusting the gateway.", sees: "the tool call and the delegated token", never: "the user token or the agent secret" },
  a2a: { label: "A2A agent", initials: "A2", lane: "a2a", role: "A second agent reached over the agent-to-agent protocol.", sees: "the nested-act token and the message", never: "the first agent's own key" },
  hitl: { label: "Human approval", initials: "HA", lane: "hitl", role: "The human in the loop who approves a held action.", sees: "what the agent wants to do", never: "the token" },
  privilege: { label: "Privilege gateway", initials: "PV", lane: "privilege", role: "The agent gateway leg that checks the agent key and its grants.", sees: "the agent key and the call", never: "the user's password" },
  registry: { label: "Agent registry", initials: "RG", lane: "registry", role: "The list of registered agents and their owners.", sees: "agent ids and owners", never: "tokens" },
  credentials: { label: "Credential store", initials: "CS", lane: "credentials", role: "Holds the downstream credential that is swapped in for the call.", sees: "the stored credential", never: "the user token" },
};

export function actorOf(id) {
  const a = Object.hasOwn(ACTORS, id) ? ACTORS[id] : null;
  if (a) return { id, ...a };
  const label = String(id || "?");
  return { id: label, label, initials: label.replace(/[^A-Za-z0-9]/g, "").slice(0, 2).toUpperCase() || "?", lane: "neutral", role: "An actor this lab does not describe.", sees: "not described", never: "not described" };
}

// CSS custom property for an actor's lane colour (one named block in evidence.css).
export const laneVar = (id) => `var(--lane-${actorOf(id).lane})`;

// The cast in order of first appearance, so columns never move while a run is revealed.
export function actorsIn(hops) {
  const out = [];
  for (const h of hops || []) for (const id of [h.from, h.to]) if (id && !out.includes(id)) out.push(id);
  return out;
}

export const touches = (hop, id) => Boolean(hop) && (hop.from === id || hop.to === id);
export const isNote = (hop) => hop.from === hop.to;

// Verdict words: every status carries a word, never colour alone. State maps onto the app's .tag[data-state].
export const VERDICT_WORD = { ok: "done", deny: "denied", held: "held", obligation: "needs approval", skip: "not in this path" };
export const VERDICT_STATE = { ok: "ok", deny: "bad", held: "warn", obligation: "warn", skip: "info" };
export const verdictWord = (v) => VERDICT_WORD[v || "ok"] || String(v);
export const verdictState = (v) => VERDICT_STATE[v || "ok"] || "info";
export const STAGE_STATE = { pass: "ok", fail: "bad", skip: "info" };

// The screens show what the server sent. Redaction is the server's job (shared hop-detail): Mock keeps MOCK tokens raw for
// teaching (rule 4), Real redacts, secrets are always write-only. Control characters become visible escapes (safeText).
export const txt = (v) => visible(v == null ? "" : typeof v === "string" ? v : JSON.stringify(v));

// Preferences outlive a reload; storage can be missing or throw (private mode), so every access is guarded.
export function readPref(key, ok, fallback) {
  try {
    const v = window.localStorage.getItem(key);
    return v != null && ok(v) ? v : fallback;
  } catch {
    return fallback;
  }
}
export function writePref(key, value) {
  try {
    window.localStorage.setItem(key, String(value));
  } catch {
    /* storage unavailable: the choice lasts for this page only */
  }
}

// Arrow-key navigation between hops, shared by the sequence rows and the reel frames.
export function stepKey(e, n, list, onSelect) {
  const at = list.indexOf(n);
  let next = null;
  if (e.key === "ArrowDown" || e.key === "ArrowRight") next = list[Math.min(list.length - 1, at + 1)];
  else if (e.key === "ArrowUp" || e.key === "ArrowLeft") next = list[Math.max(0, at - 1)];
  else if (e.key === "Home") next = list[0];
  else if (e.key === "End") next = list[list.length - 1];
  else if (e.key === "Enter" || e.key === " ") next = n;
  if (next == null) return null;
  e.preventDefault();
  onSelect?.(next);
  return next;
}
