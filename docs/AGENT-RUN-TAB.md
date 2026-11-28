# The "Agent run" tab: how to add it to a -LAB app

For agents converting labs to the new demo standard. Owner-approved pattern, 2026-11-28.
Reference implementation: **customer-agent-LAB**, branch `feat/agent-run-tab`
(worktree `~/Development/customer-agent-agentrun-wt/customer-agent-LAB` — copy from there,
never re-derive). Fleet-wide applicability: `AI-DEMO-Standalone-wt/ui-audit/docs/ui-audit-2026-11-27/AGENT-TAB-ROLLOUT-PLAN.md`.

## What it is (one paragraph for your PR)

One additive nav tab that plays a run the way an agent experiences it: the customer's words,
the dancing Ping mark while the run works, the hops appearing **one at a time** in the real
shared `SequenceView`, a top-to-bottom `MovieReel` on the right, a shared-selection
`StepDetailPanel` below, then the derived reply with its outcome tag. Works for mock and real
runs alike — the tab paces the hops the engine already produced; nothing about the run changes.
Purely additive: default route, all existing tabs and views untouched.

## Gate — do not convert a lab that fails this

1. The lab vendors `shared/evidence/` (`web/src/evidence/`, byte-for-byte) and its server
   vendors `hopDetail.mjs` + `hop-catalog.json` (`server/src/vendor/`).
2. The engine produces `demo-hop/1` hops for the mode(s) the lab supports (mock via its flow
   engine; real via its live path, refusals as verdict hops, "not run" listed, never faked).
3. The lab has the shared `TopMenu`.
7 labs pass today (cohort A): customer-agent, ai-demo-standalone, appfire-agent-governance,
meridian-air, pingcli, privilege-gateway-client, privilege-owasp-lab. Everything else: first do
the work in AGENT-TAB-ROLLOUT-PLAN.md §Wave 3, or leave the lab alone.

## The five edits (customer-agent diff is the template)

### 1. `web/src/components/AgentRunView.jsx` — copy, then adapt

Copy the file from the reference branch. It is ~150 lines and self-contained: playback state
(`revealed`/`selected`/`playing`/`speed`), the chat turn (You/AI avatars), the grid with
`SequenceView` + vertical reel + `StepDetailPanel`. Adapt only:

- **Props**: the reference takes `{ run, uc, persona, mode }`. Feed it whatever holds the
  lab's current run object with `.hops` (`demo-hop/1`) and `.outcome`. If your lab keeps runs
  in a different place, map at the call site — do not fork the component.
- **The reply text**: comes from the lab's own reply derivation (`replyOf(run)` in
  customer-agent, `chat.js`). Use the lab's existing one. Never generate new copy.
- **Empty state**: keep the "run a use case first" sentence.

Non-negotiables inside the component:
- `hops.slice(0, revealed)` is the ONLY thing feeding `SequenceView`/`MovieReel` — the shared
  components are not modified, the parent just slices. This is what makes it live.
- One `selected` hop state shared by all three views; clicking anywhere syncs everywhere.
- A new run (different `traceId`) resets playback to hop 1 and autoplays.
- Real hops keep their `source` flags untouched; the header names the mode
  (REAL / LIVE / MOCK engine). Never mix mock hops into a real run's display.

### 2. The nav entry + panel wiring — `web/src/App.jsx`

```jsx
import AgentRunView from "./components/AgentRunView";
// in the nav list, right after the app's first tab:
{ id: "agentrun", label: "Agent run" },
// in the tabpanel, beside the other page conditions:
{current === "agentrun" && <AgentRunView run={...} uc={...} persona={...} mode={...} />}
```

The tab goes **after the app's primary tab** (Agent, or whatever the lab's first tab is) so the
default route and first impression are unchanged. Do not make it the default. Do not reuse an
existing view's id.

### 3. The dancing Ping mark — `web/src/components/PingSpinner.jsx` + `ping-spinner.css` + logo

Copy both files. Copy the official mark: `web/public/branding/ping-logo.png` from AI-DEMO2
(`demo_api_ui/public/branding/ping-logo.png`, commit the binary explicitly — it will not
survive a stash/patch transfer). In-chat use is `size={36}`, no rings, label with progress:

```jsx
{!done ? <PingSpinner size={36} label={`Working on it… (${revealed}/${hops.length})`} /> : <reply/>}
```

The CSS is a port of AI-DEMO2's `ping-identity-dance-inside` keyframes (lift/tilt/pulse, 1.8s,
`prefers-reduced-motion` honoured). Token colours only (`--accent`, `--text`). If the lab
already has a spinner of its own, this replaces it in this tab only — do not touch the lab's
other spinners in the same PR.

### 4. Layout CSS — append to the lab's layout stylesheet

Append the `.agentrun` block from the reference `layout.css` (grid: main + 240–300px side
column, collapses at 900px; the reel re-flowed top-to-bottom via `.agentrun__reel .rl`
overrides). Layout only: no colours, no literals, breakpoints 600/900px only — the lab CSS
rules in STANDALONE-UI-PATTERNS.md §10 apply.

### 5. Tests — update the nav assertions, add one playback test

- Existing tests that assert the exact tab list get the new label inserted after the first tab.
  Arrow-key walk tests get one more `{ArrowDown}`.
- Add one test (see the reference `App.test.jsx` "agent run tab" describe):
  empty state by default → run a use case → switch to the tab → progress counter ticks →
  outcome tag arrives → `sequence-view` and `movie-reel` testids present.

## Verify before the PR (all four, no exceptions)

```bash
cd web && npm ci && npm test          # full suite green
cd web && npm run build               # vite build clean
# lab running locally (mock): one Playwright pass
#   1. default tab loads unchanged
#   2. run a use case, open Agent run: mid-run shot (working mark + partial diagram)
#   3. done shot (reply + full diagram + reel + detail)
#   4. deny/error use case if the lab has one (refusal reply, DENY tag)
```

Paste the screenshots in the PR. Rule: verify by content, not by a success line.

## Do-not-break contract (checked in review)

- No change to any file under `web/src/evidence/` or the server engine.
- Default tab, hash routing, deep links and every existing test's meaning unchanged.
- No new colours, no restyled shared controls, no `!important`, no forced priority.
- Playback paces existing hops; a paused/slow network never invents or reorders hops.
- `prefers-reduced-motion` stops the dance; the mark stays visible.

## After wave 2 (fleet note)

Once ≥2 more labs carry the tab, promote `AgentRunView` + `PingSpinner` to
`shared/agent-run/` (with sha256 pins, the floating-dialog convention) and re-vendor —
"shared means change it once and every app gets it." Until then, copy per lab and keep the
copies byte-identical to the reference.
