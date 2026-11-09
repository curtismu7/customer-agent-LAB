import { useEffect, useMemo, useRef, useState } from "react";
import { actorOf, laneVar, readPref, stepKey, txt, verdictWord, writePref } from "./lanes";
import "./evidence.css";

// The movie reel: one frame per hop (number, lane, short title, ONE fact, status word), ported from AI-DEMO2's
// TokenChainNodeRail and TokenChainFilmstrip. Presentational: a frame click calls onSelect(n); the parent shows the
// step detail. Run walks the frames on a timer and stops on the last one (it never loops).
export const SPEEDS = [
  { ms: 400, label: "Run" },
  { ms: 900, label: "Fast" },
  { ms: 1800, label: "Steady" },
  { ms: 3200, label: "Slow" },
];
const K = { density: "cal.ev.reel.density", speed: "cal.ev.reel.speed" };

export default function MovieReel({ hops = [], selected = null, onSelect }) {
  const [density, setDensity] = useState(() => readPref(K.density, (v) => v === "detailed" || v === "compact", "detailed"));
  const [speed, setSpeed] = useState(() => Number(readPref(K.speed, (v) => SPEEDS.some((s) => String(s.ms) === v), SPEEDS[0].ms)));
  const [running, setRunning] = useState(false);
  const [showSkipped, setShowSkipped] = useState(false);
  useEffect(() => writePref(K.density, density), [density]);
  useEffect(() => writePref(K.speed, speed), [speed]);

  const skipped = hops.filter((h) => h.verdict === "skip");
  const shown = useMemo(() => (showSkipped ? hops : hops.filter((h) => h.verdict !== "skip")), [hops, showSkipped]);
  const ns = shown.map((h) => h.n);
  const atEnd = ns.length > 0 && selected === ns[ns.length - 1];

  // The tick reads live values through a ref, so a re-render does not tear down and restart the timer.
  const tick = useRef(null);
  tick.current = () => {
    const at = ns.indexOf(selected);
    if (at >= ns.length - 1) { setRunning(false); return; }
    onSelect?.(ns[at + 1]);
  };
  useEffect(() => {
    if (!running) return undefined;
    const t = setInterval(() => tick.current?.(), speed);
    return () => clearInterval(t);
  }, [running, speed]);
  const toggleRun = () => {
    if (running) { setRunning(false); return; }
    if (atEnd || !ns.includes(selected)) onSelect?.(ns[0]);
    setRunning(true);
  };

  const frames = useRef({});
  const onKey = (e, n) => {
    const next = stepKey(e, n, ns, onSelect);
    if (next != null && next !== n) frames.current[next]?.focus();
  };

  if (!hops.length) return <p className="ev-empty" data-testid="reel-empty">Run a use case to fill the reel.</p>;
  const tabN = ns.includes(selected) ? selected : ns[0];

  return (
    <section className="ev-root rl-wrap" aria-label="Movie reel" data-testid="movie-reel">
      <div className="sq-bar" role="toolbar" aria-label="Movie reel controls">
        <button type="button" className="primary" onClick={toggleRun} data-state={running ? "running" : "paused"}>{running ? "Pause" : atEnd ? "Replay" : "Run"}</button>
        <label className="sq-speed">Speed{" "}
          <select aria-label="Walk-through speed" value={speed} onChange={(e) => setSpeed(Number(e.target.value))}>
            {SPEEDS.map((s) => <option key={s.ms} value={s.ms}>{s.label}</option>)}
          </select>
        </label>
        <span className="sq-grp" role="group" aria-label="Density">
          <button type="button" aria-pressed={density === "detailed"} onClick={() => setDensity("detailed")}>Detailed</button>
          <button type="button" aria-pressed={density === "compact"} onClick={() => setDensity("compact")}>Compact</button>
        </span>
        <span className="ev-muted">{shown.length} {shown.length === 1 ? "step" : "steps"}</span>
      </div>
      <ol className="rl" data-density={density} aria-label="Movie reel, click a frame">
        {shown.map((h) => {
          const on = h.n === selected;
          const lane = actorOf(h.to);
          return (
            <li key={h.n}>
              <button type="button" className="rl-f" ref={(el) => { frames.current[h.n] = el; }} style={{ "--lane": laneVar(h.to) }}
                data-verdict={h.verdict || "ok"} aria-current={on ? "step" : undefined} tabIndex={h.n === tabN ? 0 : -1}
                aria-label={`Step ${h.n}, ${txt(h.title)}, ${lane.label}, ${verdictWord(h.verdict)}`} title={txt(h.narrative || h.title)}
                data-testid={`frame-${h.n}`} onClick={() => onSelect?.(h.n)} onKeyDown={(e) => onKey(e, h.n)}>
                <span className="rl-f__n">{h.n}</span>
                <span className="rl-f__l">{lane.label}</span>
                <b className="rl-f__t">{txt(h.title)}</b>
                {density === "detailed" && h.fact && <span className="rl-f__fact">{txt(h.fact)}</span>}
                <span className="rl-f__st">{verdictWord(h.verdict)}</span>
              </button>
            </li>
          );
        })}
      </ol>
      {skipped.length > 0 && (
        <div className="rl-more">
          <button type="button" className="ev-chipbtn" aria-expanded={showSkipped} onClick={() => setShowSkipped((v) => !v)}>
            {showSkipped ? `− ${skipped.length} hops not in this run` : `+ ${skipped.length} hops not in this run`}
          </button>
          <span className="ev-muted">{skipped.map((h) => txt(h.title)).join(", ")} did not run. {showSkipped ? "They are shown faint." : "Click to show them faint."}</span>
        </div>
      )}
    </section>
  );
}
