import { useEffect, useRef, useState } from "react";

// Reveal a run's hops one at a time (owner, 2026-11-28): the evidence views (sequence, reel,
// tokens) draw the hops that exist so far, so a run fills in live. Paces the hops the engine
// already produced — mock or real alike — never invents or reorders one. Reset by the run key
// (a different run starts over); Pause/Replay and the speed stay in the caller's hands.
const DEFAULT_MS = 650;
// Reduced motion means no pacing: the whole run is shown at once (the dancing mark's rule, applied to the reveal).
const instant = () => typeof window !== "undefined" && (
  (window.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches) ||
  import.meta.env?.MODE === "test"
);
export default function useRevealedHops(hops = [], runKey = "") {
  const [revealed, setRevealed] = useState(hops.length);
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState(DEFAULT_MS);
  const timer = useRef(null);
  useEffect(() => () => clearInterval(timer.current), []);

  // A new run (or the first) plays from the first hop; a cleared run shows nothing.
  useEffect(() => {
    clearInterval(timer.current);
    if (!hops.length) { setRevealed(0); setPlaying(false); return; }
    if (instant()) { setRevealed(hops.length); setPlaying(false); return; }
    setRevealed(1);
    setPlaying(hops.length > 1);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [runKey]);

  useEffect(() => {
    if (!playing) return undefined;
    timer.current = setInterval(() => {
      setRevealed((r) => { if (r >= hops.length) { setPlaying(false); return r; } return r + 1; });
    }, speed);
    return () => clearInterval(timer.current);
  }, [playing, speed, hops.length]); // eslint-disable-line react-hooks/exhaustive-deps

  return {
    shown: hops.slice(0, revealed),
    revealed, total: hops.length,
    playing, done: revealed >= hops.length,
    toggle: () => setPlaying((p) => { if (!p && revealed >= hops.length) setRevealed(1); return !p; }),
    speed, setSpeed,
  };
}
