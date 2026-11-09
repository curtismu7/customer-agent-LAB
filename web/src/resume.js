// Resume: the chat, the selected use case, the vertical and the persona are kept in sessionStorage per workspace, so a visitor who hands a use
// case off to another app (same tab) and comes Back finds the conversation where it was.
//
// What is stored (the safe option): ids and the text the page already shows. Each turn keeps what was said, the use case id, the vertical, how it
// was chosen, its status, the brain note and, for a finished run, only its outcome word (for example PERMIT). The run itself (its tokens, hops,
// requests and responses) is NEVER stored: a restored turn says "run it again to see the evidence". No token of any kind, mock or live, is written.
// Every read is checked field by field (anything unknown is dropped) and every access is guarded: storage can be missing or throw.

import { PROXY_PATHS } from "./handoff";

const keyFor = (ws) => `cal.resume.${ws}`;
const ID = /^[A-Za-z0-9.-]{1,40}$/;
const isId = (v) => typeof v === "string" && ID.test(v);
const OUTCOME = /^[A-Z][A-Z_]{1,30}$/;
export const MAX_TURNS = 30;
export const MAX_BYTES = 32 * 1024;
const HOW = ["picked", "exact", "close", "llm"];
const STATUS = ["done", "handoff", "nomatch", "note"];
const str = (v, n) => (typeof v === "string" ? v.slice(0, n) : "");

// One live turn -> what is stored. A turn that is still running is stored as done without an outcome (it is re-run on demand).
export function slimTurn(t) {
  if (!t || typeof t !== "object") return null;
  if (t.status === "note") return { status: "note", said: str(t.said, 200) };
  const out = { said: str(t.said, 400), status: STATUS.includes(t.status) ? t.status : "done" };
  const ucId = t.uc?.id ?? t.ucId;
  if (isId(ucId)) out.ucId = ucId;
  if (isId(t.vertical)) out.vertical = t.vertical;
  if (HOW.includes(t.how)) out.how = t.how;
  if (["chip", "typed", "starter"].includes(t.source)) out.source = t.source;
  if (t.brainNote) out.brainNote = str(t.brainNote, 300);
  if (t.preview === true) out.preview = true;
  const outcome = t.result?.ok ? t.result.body?.run?.outcome : t.outcome;
  if (typeof outcome === "string" && OUTCOME.test(outcome)) out.outcome = outcome;
  if (t.result && !t.result.ok) out.refused = true;
  else if (t.refused === true) out.refused = true;
  return out;
}

// A stored turn -> a turn the page can show (restored: true, no run). Anything that does not check out is dropped.
export function cleanTurn(raw) {
  if (!raw || typeof raw !== "object") return null;
  const t = slimTurn(raw);
  if (!t || (t.status === "note" ? !t.said : !t.said && !t.ucId)) return null;
  return { ...t, restored: true };
}

// The stored state, or null. `turns` get fresh ids from 1.
export function loadResume(ws) {
  let raw;
  try { const s = window.sessionStorage.getItem(keyFor(ws)); if (!s || s.length > MAX_BYTES) return null; raw = JSON.parse(s); } catch { return null; }
  if (!raw || typeof raw !== "object") return null;
  const turns = (Array.isArray(raw.turns) ? raw.turns : []).slice(-MAX_TURNS).map(cleanTurn).filter(Boolean).map((t, i) => ({ ...t, id: i + 1 }));
  return {
    turns,
    selectedId: isId(raw.selectedId) ? raw.selectedId : null,
    vertical: isId(raw.vertical) ? raw.vertical : null,
    persona: isId(raw.persona) ? raw.persona : null,
  };
}

// Saves the state, dropping the oldest turns until it fits the size cap. Storage failures are ignored (the chat lasts for this page only).
export function saveResume(ws, { turns = [], selectedId, vertical, persona }) {
  const base = { v: 1, selectedId: isId(selectedId) ? selectedId : null, vertical: isId(vertical) ? vertical : null, persona: isId(persona) ? persona : null };
  let slim = turns.map(slimTurn).filter(Boolean).slice(-MAX_TURNS);
  let s = JSON.stringify({ ...base, turns: slim });
  while (s.length > MAX_BYTES && slim.length) { slim = slim.slice(1); s = JSON.stringify({ ...base, turns: slim }); }
  try { window.sessionStorage.setItem(keyFor(ws), s); } catch { /* storage unavailable */ }
}

// ?returned=<app>&uc=<id>: the visitor came Back from another app. Returns { app, uc } when both are ids and the app is one this page hands off to
// (PROXY_PATHS), else null. Always removes the two parameters from the address bar (history.replaceState), keeping the path, other params and hash.
export function takeReturn() {
  let q;
  try { q = new URLSearchParams(window.location.search); } catch { return null; }
  if (!q.has("returned") && !q.has("uc")) return null;
  const app = q.getAll("returned").length === 1 ? q.get("returned") : null;
  const uc = q.getAll("uc").length === 1 ? q.get("uc") : null;
  q.delete("returned"); q.delete("uc");
  try {
    const rest = q.toString();
    window.history.replaceState(window.history.state, "", `${window.location.pathname}${rest ? `?${rest}` : ""}${window.location.hash}`);
  } catch { /* ignore */ }
  return isId(app) && isId(uc) && Object.hasOwn(PROXY_PATHS, app) ? { app, uc } : null;
}
