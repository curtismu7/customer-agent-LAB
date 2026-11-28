import { useEffect, useRef, useState } from "react";
import SequenceView from "../evidence/SequenceView";
import MovieReel from "../evidence/MovieReel";
import StepDetailPanel from "../evidence/StepDetailPanel";
import { replyOf } from "../chat";
import { outcomeState } from "../lib";
import { Tag, SourceTag } from "./Bits";
import PingSpinner from "./PingSpinner";
import { visible } from "../safeText";

// The Agent run tab (owner, 2026-11-28): one additive view that plays a run the way an agent
// experiences it — the customer's words, the agent working, the hops appearing one at a time in
// the real SequenceView / MovieReel (vertical) / StepDetailPanel, then the reply. Additive: the
// Agent tab, its evidence column and every other view are untouched. The run itself is not
// changed — this tab paces the hops the engine already produced, mock or real alike (real hops
// keep their REAL source tags; nothing mock is added to a real run).
const SPEEDS = [{ ms: 650, label: "Run" }, { ms: 1400, label: "Steady" }, { ms: 2600, label: "Slow" }];

export default function AgentRunView({ run, uc, persona, onHop, mode }) {
  const hops = run?.hops || [];
  const [revealed, setRevealed] = useState(0);
  const [selected, setSelected] = useState(null);
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState(SPEEDS[0].ms);
  const timer = useRef(null);

  const stop = () => { clearInterval(timer.current); setPlaying(false); };
  useEffect(() => () => clearInterval(timer.current), []);

  // A new run resets the playback to the first hop and plays.
  const runKey = run?.traceId || run?.hops?.map((h) => h.n).join(",") || "";
  useEffect(() => {
    clearInterval(timer.current);
    setRevealed(hops.length ? 1 : 0);
    setSelected(hops[0]?.n ?? null);
    if (hops.length > 1) setPlaying(true); else setPlaying(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [runKey]);

  useEffect(() => {
    if (!playing) return undefined;
    timer.current = setInterval(() => {
      setRevealed((r) => {
        if (r >= hops.length) { setPlaying(false); return r; }
        setSelected(hops[r].n);
        return r + 1;
      });
    }, speed);
    return () => clearInterval(timer.current);
  }, [playing, speed, hops.length]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!run) {
    return (
      <section className="agentrun" aria-label="Agent run" data-testid="agent-run">
        <p className="muted" data-testid="agent-run-empty">Run a use case on the Agent tab (or pick one below), then this page plays it: the hops appear one at a time in the sequence, the reel and the step detail, and the reply arrives at the end.</p>
      </section>
    );
  }

  const shown = hops.slice(0, revealed);
  const done = revealed >= hops.length;
  const reply = replyOf(run);
  const said = run.useCase?.id ? `${run.useCase.id} · ${run.useCase?.title || ""}` : "Run";
  const sources = [...new Set(hops.map((h) => h.source || (h.mock ? "mock" : "real")))];

  return (
    <section className="agentrun" aria-label="Agent run" data-testid="agent-run">
      <header className="agentrun__head">
        <h2 className="evcol__title"><span className="step-num" aria-hidden="true">▶</span>Agent run · {visible(run.useCase?.id || uc?.id || "")}</h2>
        <span className="muted" data-testid="agent-run-mode">
          {run.kind === "live" ? "LIVE, identity provider only" : run.kind === "real" ? "REAL" : "MOCK engine"}
          {sources.length === 1 && sources[0] === "mock" ? " · every hop MOCK" : ""}
        </span>
        <span className="spacer" />
        <button type="button" className={playing ? undefined : "primary"} onClick={() => (playing ? stop() : setRevealed(hops.length) >= 0 && setPlaying(true))} data-testid="agent-run-toggle">
          {playing ? "Pause" : revealed >= hops.length ? "Replay" : "Play"}
        </button>
        <label className="muted">Speed{" "}
          <select aria-label="Playback speed" value={speed} onChange={(e) => setSpeed(Number(e.target.value))}>
            {SPEEDS.map((s) => <option key={s.ms} value={s.ms}>{s.label}</option>)}
          </select>
        </label>
        <span className="muted" data-testid="agent-run-progress" aria-live="polite">{Math.min(revealed, hops.length)} / {hops.length} hops</span>
      </header>

      {/* the exchange: what was asked, and (once the run has played out) the reply */}
      <div className="turns" aria-label="The exchange">
        <div className="turn">
          <div className="turn__you">
            <span className="avatar" aria-hidden="true">You</span>
            <p className="turn__said">{visible(said)}{persona ? ` (as ${visible(persona)})` : ""}</p>
          </div>
          <div className="turn__agent">
            <span className="avatar avatar--agent" aria-hidden="true">AI</span>
            <div className="turn__body" data-testid="agent-run-reply">
              {!done ? <PingSpinner size={36} label={`Working on it… (${Math.min(revealed, hops.length)}/${hops.length})`} /> : (
                <div className="turn__answer">
                  <p className="turn__who kicker">{visible(reply.who)}</p>
                  <p>{visible(reply.text)}</p>
                  <span><Tag state={outcomeState(run.outcome)} testId="agent-run-outcome">{visible(run.outcome)}</Tag>{" "}
                    <button type="button" className="turn__ev" onClick={() => setSelected(hops[0]?.n)}>See evidence →</button></span>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* the run, filling in live: one sequence diagram, the reel vertical on the right, one shared selection */}
      <div className="agentrun__grid">
        <div className="agentrun__main">
          <SequenceView hops={shown} selected={selected} onSelect={setSelected} />
          {selected != null && <StepDetailPanel hops={hops} selected={selected} onSelect={setSelected} onClose={() => setSelected(null)} />}
        </div>
        <aside className="agentrun__side" aria-label="Movie reel, top to bottom">
          <div className="agentrun__reel">
            <MovieReel hops={shown} selected={selected} onSelect={setSelected} />
          </div>
        </aside>
      </div>
    </section>
  );
}
