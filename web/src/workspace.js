// Rule 13: each browser tab gets its own workspace id, kept in sessionStorage, and sends it as X-Workspace on every API call that touches server
// state. Storage can be blocked, so a failure falls back to a per-load id.
const KEY = "cal.workspace";
let memo = null;

// Tests only: forget the id held in memory so the next call picks a new one.
export const forgetWorkspace = () => { memo = null; };

export function workspaceId() {
  if (memo) return memo;
  try { const saved = window.sessionStorage.getItem(KEY); if (saved && /^[a-z0-9-]{1,40}$/.test(saved)) return (memo = saved); } catch { /* blocked */ }
  const bytes = new Uint8Array(8);
  (window.crypto || { getRandomValues: (a) => a.map(() => Math.floor(Math.random() * 256)) }).getRandomValues(bytes);
  bytes[0] = 0xa0 | (bytes[0] & 0x0f); // the first hex digit is a letter, so the id is never 16 digits (which could pass for a card number to the server's credential check)
  memo = `w-${[...bytes].map((b) => b.toString(16).padStart(2, "0")).join("")}`;
  try { window.sessionStorage.setItem(KEY, memo); } catch { /* blocked */ }
  return memo;
}

export const workspaceFetch = (url, opts = {}) => fetch(url, { ...opts, headers: { "content-type": "application/json", ...(opts.headers || {}), "x-workspace": workspaceId() } });
