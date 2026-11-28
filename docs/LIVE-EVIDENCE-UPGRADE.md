# The live evidence upgrade: how to apply it to a -LAB app

For agents converting labs. Owner-approved pattern, 2026-11-28 (v2 — supersedes the separate-tab
design). Reference implementation: **customer-agent-LAB**, branch `feat/agent-run-tab`
(worktree `~/Development/customer-agent-agentrun-wt/customer-agent-LAB`). Copy from there; never re-derive.

## What this is (short)

**No new tab. No new page.** The demo stays exactly as it is. Three small additions:

1. **Live evidence** — the existing evidence views (Sequence, Movie reel, Tokens) draw a run's
   hops **one at a time as the run plays**, instead of appearing all at once. A tiny
   Pause/Play/Replay control and a live count sit in the evidence header. Works for mock and
   real runs (the tab paces hops the engine already produced — mock or real alike, nothing
   invented).
2. **Dancing Ping mark** — the official Ping mark with AI-DEMO2's lift/tilt/pulse animation,
   shown in the chat while the agent works ("Working on it…"), replacing the plain text wait.
3. **Smaller evidence buttons** — the four view buttons (Sequence / Movie reel / Topology /
   Tokens) shrink to 11px chips: they name a view, they are not actions.

Everything else — nav, default route, all views, Topology, Tokens, walkthroughs — untouched.

## Gate (do not convert a lab that fails this)

1. The lab vendors `shared/evidence/` (`web/src/evidence/`, byte-for-byte) and its server
   vendors `hopDetail.mjs` + `hop-catalog.json` (`server/src/vendor/`).
2. The engine produces `demo-hop/1` hops for the mode(s) the lab supports (refusals are verdict
   hops, "not run" listed, never faked).
3. The lab has the shared `TopMenu`.

Cohort A passes today: customer-agent, ai-demo-standalone, appfire-agent-governance,
meridian-air, pingcli, privilege-gateway-client, privilege-owasp-lab. All other labs: see
`AI-DEMO-Standalone-wt/ui-audit/docs/ui-audit-2026-11-27/AGENT-TAB-ROLLOUT-PLAN.md` first.

## The edits (customer-agent diff is the template)

### 1. `web/src/components/useRevealedHops.js` — copy as-is

~35 lines. Paces `hops` (one per tick), returns `{ shown, revealed, total, playing, done,
toggle, speed, setSpeed }`. Rules baked in:

- **`prefers-reduced-motion` → instant**: the whole run shows at once, no pacing.
- **Test mode (`import.meta.env.MODE === "test"`) → instant** — otherwise every existing
  evidence assertion fails on a stalled hop 1 (this bit customer-agent; do not skip it).
- A new run key (traceId) restarts from hop 1 and plays; the hook never invents or reorders hops.

### 2. `web/src/components/PingSpinner.jsx` + `ping-spinner.css` + the logo — copy as-is

The dancing Ping mark (AI-DEMO2's `ping-identity-dance-inside` keyframes, 1.8s, reduced-motion
honoured, token colours only). Copy the official mark too:
`web/public/branding/ping-logo.png` (from AI-DEMO2 `demo_api_ui/public/branding/`).
**`git add` the PNG explicitly** — binary assets do not survive stash/patch between worktrees.

### 3. Wire the live reveal into the evidence column (`EvidenceColumn` or your lab's equivalent)

```jsx
import useRevealedHops from "./useRevealedHops";
const allHops = run?.hops || [];
const live = useRevealedHops(allHops, run?.traceId || ...);
const hops = live.shown;          // ← the ONLY change: existing views now get the slice
```

Header additions (keep them tiny, same row as the existing count):

```jsx
{run && !live.done && <PingSpinner size={22} label={`${live.revealed}/${live.total}`} />}
{run && <button className="evcol__live" aria-pressed={live.playing} onClick={live.toggle}
  data-testid="evidence-live">{live.playing ? "Pause" : live.revealed < live.total ? "Play" : "Replay"}</button>}
```

Everything downstream (SequenceView, MovieReel, StepDetailPanel, TokenView if it lists per-hop)
keeps its exact props — it just receives fewer hops until the run finishes.

### 4. The dancing Ping in the chat wait (`Turn` or your lab's reply component)

```jsx
{turn.status === "running" && <div data-testid="turn-running"><PingSpinner size={28} label="Working on it…" /></div>}
```

Keep the same testid so existing tests pass (one asserts the `<img>` exists — update the
matcher if it asserted text).

### 5. The small evidence buttons — one CSS block in the lab's layout stylesheet

```css
.evtabs { gap: 4px; }
.evtabs button { min-height: 22px; padding: 1px 8px; font-size: 11px; }
.evcol__live { min-height: 22px; padding: 1px 8px; font-size: 11px; }
.evcol__spinner .ping-spinner__label { font-size: 11px; color: var(--muted); }
```

Layout/size only: no colours, no literals (STANDALONE-UI-PATTERNS §10).

## Tests to update (customer-agent needed these)

- Any assertion on the evidence count ("· 4 hops") now sees the **revealed** count mid-play —
  with test-mode instant reveal they still see the full count. No change needed if you keep the
  test-mode rule; assertions on the spinner's `<img>` need `toBeInTheDocument()`.
- Add one test: run a use case → evidence header shows the Play/Pause/Replay control and the
  spinner while `!done`.

## Verify before the PR (all four, no exceptions)

```bash
cd web && npm ci && npm test          # full suite green
cd web && npm run build               # vite build clean
# lab running locally: one Playwright pass —
#   1. run a use case: mid-run shot (dancing Ping in the chat, evidence header spinner + Pause, partial diagram)
#   2. done: Replay button, full diagram, small view buttons
#   3. the four view buttons are visibly small (clip a screenshot of the header)
#   4. existing views still work: click a hop → detail panel; Topology and Tokens tabs still render
```

Paste the screenshots in the PR.

## Do-not-break contract

- No new nav entry, no route change, no new page.
- No change to any file under `web/src/evidence/` or the server engine.
- All four view buttons stay; only their size changes.
- `prefers-reduced-motion` → no pacing, no dance (mark visible, static).
- Real hops keep their source flags; mock never mixed into a real run.
- One PR per lab; revert = close the PR.

## Fleet note

After the second lab carries this, promote `useRevealedHops` + `PingSpinner` to
`shared/live-evidence/` (sha256 pins, the floating-dialog convention) and re-vendor —
"shared means change it once and every app gets it."
