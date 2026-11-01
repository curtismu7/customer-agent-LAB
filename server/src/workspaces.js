// Rule 13: a workspace id keeps one visitor's state apart from another's. Server state per workspace: the mode (mock or live), a counter and a short
// list of run summaries. Bounded in count (new workspaces are refused at the cap, nothing is evicted) and age (idle for an hour). Each workspace has a
// write lock (a promise chain), so two parallel writes to one workspace run one after the other; different workspaces do not wait for each other.
// The browser sends its id in X-Workspace (default "default"). Reset clears the current workspace only.
import { findCredentials } from './credentials.js';
import { refuse } from './errors.js';

export const WORKSPACE_RE = /^[a-z0-9-]{1,40}$/;
export const DEFAULT_WORKSPACE = 'default';
export const MAX_RUNS = 100;

export function workspaceFrom(req) {
  const raw = req.headers['x-workspace'];
  if (raw === undefined) return DEFAULT_WORKSPACE;
  // An id that looks like a credential (a 40-hex token, a long mixed run) is refused rather than echoed back in the `workspace` field.
  return typeof raw === 'string' && WORKSPACE_RE.test(raw) && findCredentials(raw).length === 0 ? raw : null;
}

export function createWorkspaces({ max = 500, ttlMs = 60 * 60 * 1000, now = Date.now, defaultMode = 'mock' } = {}) {
  const map = new Map(); // id -> { mode, seq, runs, at, tail }; insertion order = oldest first
  const sweep = () => {
    const t = now();
    for (const [id, v] of map) { if (t - v.at > ttlMs) map.delete(id); else break; }
  };
  // A new workspace is REFUSED at the cap: a flood of made-up ids cannot evict another visitor's state.
  const touch = (id) => {
    sweep();
    if (!map.has(id) && map.size >= max) throw refuse('too_many_workspaces', 'too many workspaces are active; an idle one expires after an hour', 429);
    const v = map.get(id) || { mode: defaultMode, seq: 0, runs: [], at: 0, tail: Promise.resolve() };
    v.at = now(); map.delete(id); map.set(id, v);
    return v;
  };
  return {
    // Runs fn(state) after every earlier write of this workspace has finished. The state is the live object; fn must be synchronous in effect.
    async write(id, fn) {
      const v = touch(id);
      const result = v.tail.then(() => fn(v));
      v.tail = result.catch(() => {});
      return result;
    },
    // Read-only look: the state if the workspace exists, else a fresh default that is not stored.
    peek(id) { sweep(); const v = map.get(id); return v ? { mode: v.mode, seq: v.seq, runs: v.runs } : { mode: defaultMode, seq: 0, runs: [] }; },
    // Clears this workspace's state in place, after any write already queued for it. A workspace that does not exist is left alone (nothing is created).
    async reset(id) {
      const v = map.get(id);
      if (!v) return;
      await this.write(id, (w) => { w.mode = defaultMode; w.seq = 0; w.runs = []; });
    },
    size() { return map.size; },
  };
}
