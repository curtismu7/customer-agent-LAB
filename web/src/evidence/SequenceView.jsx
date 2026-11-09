import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import { Tag } from "./Tag";
import ActorCard from "./ActorCard";
import { actorOf, actorsIn, isNote, laneVar, readPref, stepKey, touches, txt, verdictWord, withSkipped, writePref } from "./lanes";
import "./evidence.css";

// Lifeline sequence diagram of one run, ported from AI-DEMO2's SequenceReelDiagram + SequenceActorHeader and driven by
// demo-hop/1 hops. Presentational: it never fetches. Every box is a button: an actor tile or a lifeline box opens the
// actor card, a row (arrow, label or note) calls onSelect(n). Arrow keys move between rows.
const COL = 220;      // lane spacing at 100% (zoomed views)
const MIN_COL = 96;   // fit mode spreads lanes across the width down to this, keeping text full size
const BOX_W = 140;
const ROW = 54;
const TOP = 80;
const CHAR_W = 7;
// Zoom: "fit" (the default) scales the drawing to the scroller's width, never above 100%, so every lane shows with no sideways scroll;
// − / + switch to a fixed percentage starting from the fitted one, and Fit goes back.
const ZOOM_MIN = 20, ZOOM_MAX = 200, ZOOM_STEP = 10, ZOOM_DEFAULT = "fit";
const FONTS = ["small", "medium", "large"];
const SPEEDS = [{ ms: 1000, label: "1s" }, { ms: 1500, label: "1.5s" }, { ms: 2600, label: "2.6s" }, { ms: 4000, label: "4s" }, { ms: 6000, label: "6s" }];
const SPEED_DEFAULT = 2600;
const K = { zoom: "cal.ev.seq.zoom2", font: "cal.ev.seq.font", speed: "cal.ev.seq.speed" };
const STATE_WORD = { idle: "idle", done: "done", active: "working" };

const rowLabel = (h) => `${h.n} · ${txt(h.title)}${h.verdict && h.verdict !== "ok" ? ` · ${verdictWord(h.verdict)}` : ""}`;
const labelW = (s) => s.length * CHAR_W + 18;
const noteW = (s) => Math.max(150, s.length * CHAR_W + 32);

export default function SequenceView({ hops = [], selected = null, onSelect }) {
  const uid = useId().replace(/[^A-Za-z0-9]/g, "");
  const [zoom, setZoom] = useState(() => { const v = readPref(K.zoom, (x) => x === "fit" || (Number(x) >= ZOOM_MIN && Number(x) <= ZOOM_MAX), ZOOM_DEFAULT); return v === "fit" ? v : Number(v); });
  const [boxW, setBoxW] = useState(0);
  const [font, setFont] = useState(() => readPref(K.font, (v) => FONTS.includes(v), "medium"));
  const [speed, setSpeed] = useState(() => Number(readPref(K.speed, (v) => SPEEDS.some((s) => String(s.ms) === v), SPEED_DEFAULT)));
  const [slow, setSlow] = useState(false);
  const [playing, setPlaying] = useState(false);
  const [follow, setFollow] = useState(true);
  const [actor, setActor] = useState(null);
  const [showSkipped, setShowSkipped] = useState(false);
  useEffect(() => writePref(K.zoom, zoom), [zoom]);
  useEffect(() => writePref(K.font, font), [font]);
  useEffect(() => writePref(K.speed, speed), [speed]);

  // Hops that did not run (verdict skip) sit behind a chip, the way AI-DEMO2 collapses "hops not in this run"; expanded,
  // they are drawn faint AFTER every hop that ran. Hidden ones are out of the rows, the arrow keys and slow mode.
  const skipped = hops.filter((h) => h.verdict === "skip").length;
  const shown = useMemo(() => withSkipped(hops, showSkipped), [hops, showSkipped]);
  const total = shown.length;
  const ns = shown.map((h) => h.n);
  // The cast comes from the whole run, not the revealed slice, so columns hold still during a narration.
  const cast = useMemo(() => actorsIn(shown), [shown]);

  // Slow mode: rows are revealed one at a time for narration; the rest are drawn faint as pending.
  const [revealed, setRevealed] = useState(total);
  useEffect(() => { if (!slow) setRevealed(total); }, [slow, total]);
  useEffect(() => {
    if (!slow || !playing || revealed >= total) return undefined;
    const t = setTimeout(() => setRevealed((r) => r + 1), speed);
    return () => clearTimeout(t);
  }, [slow, playing, revealed, total, speed]);
  useEffect(() => { if (slow && playing && revealed >= total) setPlaying(false); }, [slow, playing, revealed, total]);
  // While narrating, the newest revealed hop is the selected one, so the step detail follows the story.
  const lastRevealed = slow && revealed > 0 ? shown[revealed - 1]?.n : null;
  useEffect(() => { if (lastRevealed != null) onSelect?.(lastRevealed); }, [lastRevealed]); // eslint-disable-line react-hooks/exhaustive-deps

  const toggleSlow = () => {
    if (slow) { setSlow(false); setPlaying(false); return; }
    setSlow(true); setRevealed(0); setPlaying(true);
  };
  const goTo = (r) => { setPlaying(false); setRevealed(Math.max(0, Math.min(total, r))); };
  const togglePlay = () => {
    if (revealed >= total && !playing) { setRevealed(0); setPlaying(true); return; }
    setPlaying((p) => !p);
  };
  const reset = () => {
    setZoom(ZOOM_DEFAULT); setFont("medium"); setSpeed(SPEED_DEFAULT); setSlow(false); setPlaying(false);
    setFollow(true); setActor(null); setShowSkipped(false); setRevealed(total);
  };

  const focusN = selected ?? lastRevealed;
  const focusHop = shown.find((h) => h.n === focusN);
  const tabN = focusHop ? focusN : shown[0]?.n;
  const done = shown.slice(0, revealed);
  const actorState = (id) => (touches(focusHop, id) ? "active" : done.some((h) => touches(h, id)) ? "done" : "idle");

  // Follow flow: keep the focused row in view inside the diagram's own scroller (never scrollIntoView, which would
  // also scroll the page and drag the diagram sideways).
  const scrollRef = useRef(null);
  const rowRefs = useRef({});
  const hasHops = hops.length > 0;
  // The scroller's inner width, for the fitted percentage (no ResizeObserver, as in jsdom: the fit is still drawn, the readout says 100%).
  useEffect(() => {
    const el = scrollRef.current;
    if (!el || typeof ResizeObserver === "undefined") return undefined;
    const ro = new ResizeObserver(() => setBoxW(el.clientWidth));
    ro.observe(el);
    setBoxW(el.clientWidth);
    return () => ro.disconnect();
  }, [hasHops]);
  useEffect(() => {
    if (!follow || focusN == null) return;
    const el = rowRefs.current[focusN];
    const box = scrollRef.current;
    if (!el || !box) return;
    const r = el.getBoundingClientRect();
    const v = box.getBoundingClientRect();
    const dy = r.top < v.top ? r.top - v.top : r.bottom > v.bottom ? r.bottom - v.bottom : 0;
    // Sideways only while narrating, and measured on the arrow or note, not the full-width hit row: opening a finished
    // run keeps the first lane pinned at the left.
    let dx = 0;
    const mark = el.querySelector(".sq-msg, .sq-note")?.getBoundingClientRect();
    if (slow && mark && box.scrollWidth > box.clientWidth + 1) {
      if (mark.width > v.width) dx = mark.left + mark.width / 2 - (v.left + v.width / 2);
      else dx = mark.left < v.left + 24 ? mark.left - v.left - 24 : mark.right > v.right - 24 ? mark.right - v.right + 24 : 0;
    }
    if (dx || dy) box.scrollTo({ top: box.scrollTop + dy, left: box.scrollLeft + dx, behavior: "smooth" });
  }, [focusN, follow, slow]);

  const onRowKey = useCallback((e, n) => {
    const next = stepKey(e, n, ns, onSelect);
    if (next != null && next !== n) rowRefs.current[next]?.focus();
  }, [ns, onSelect]);

  if (!hops.length) return <p className="ev-empty" data-testid="sequence-empty">Run a use case to draw its sequence.</p>;

  const labels = shown.map(rowLabel);
  const half = labels.reduce((m, s, i) => Math.max(m, (isNote(shown[i]) ? noteW(s) : labelW(s)) / 2), 0);
  // Fit: lay the lanes out across the scroller's width (text stays full size); scale down only if even MIN_COL lanes do not fit.
  const gaps = Math.max(cast.length - 1, 0);
  const fitCol = zoom === "fit" && boxW > 0 && gaps > 0 ? Math.max(MIN_COL, Math.min(COL, Math.floor((boxW - 2 * Math.max(BOX_W / 2 + 8, 80)) / gaps))) : COL;
  const col = fitCol;
  const laneBox = Math.min(BOX_W, col - 12);
  const pad = zoom === "fit" && col < COL ? Math.max(laneBox / 2 + 8, 80) : Math.max(COL / 2, BOX_W / 2 + 8, half + 8);
  const colX = (id) => pad + cast.indexOf(id) * col;
  const width = pad * 2 + gaps * col;
  const fitPct = boxW > 0 ? Math.max(ZOOM_MIN, Math.min(100, Math.floor((boxW / width) * 100))) : 100;
  const pct = zoom === "fit" ? fitPct : zoom;
  const zoomBy = (d) => setZoom((z) => Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, (z === "fit" ? fitPct : z) + d)));
  const footY = TOP + total * ROW - 22;
  const height = footY + 34;
  const mock = hops.some((h) => h.mock);
  const sel = focusHop ? `, step ${focusHop.n} selected` : "";
  const openActor = (id) => setActor((cur) => (cur === id ? null : id));
  const actorKey = (e, id) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); openActor(id); } };

  return (
    <section className="ev-root sq" data-font={font} aria-label="Sequence view" data-testid="sequence-view">
      <div className="sq-bar" role="toolbar" aria-label="Sequence controls">
        {mock && <Tag state="info" title="Every hop here was produced by the lab's mock engine">MOCK engine</Tag>}
        <span className="sq-grp" role="group" aria-label="Zoom">
          <button type="button" aria-label="Zoom out" disabled={pct <= ZOOM_MIN} onClick={() => zoomBy(-ZOOM_STEP)}>−</button>
          <button type="button" aria-label={`Zoom ${pct}%, actual size`} title="Actual size (100%)" onClick={() => setZoom(100)} data-testid="seq-zoom">{pct}%</button>
          <button type="button" aria-label="Zoom in" disabled={pct >= ZOOM_MAX} onClick={() => zoomBy(ZOOM_STEP)}>+</button>
          <button type="button" aria-pressed={zoom === "fit"} title="Fit the whole width: every lane in view" onClick={() => setZoom("fit")} data-testid="seq-fit">Fit</button>
        </span>
        <span className="sq-grp" role="group" aria-label="Text size">
          {FONTS.map((f) => (
            <button type="button" key={f} aria-pressed={font === f} aria-label={`${f} text`} onClick={() => setFont(f)}>{f === "small" ? "A−" : f === "large" ? "A+" : "A"}</button>
          ))}
        </span>
        <button type="button" onClick={reset} title="Zoom, text size, speed and slow mode back to their defaults">Reset</button>
        <span className="sq-sep" aria-hidden="true" />
        <button type="button" aria-pressed={slow} onClick={toggleSlow} title="Reveal the steps one at a time for narration">Slow</button>
        {slow && (<>
          <button type="button" aria-label="Reveal previous step" disabled={revealed <= 1} onClick={() => goTo(revealed - 1)}>‹ Prev</button>
          <button type="button" className="primary" onClick={togglePlay}>{revealed >= total && !playing ? "Replay" : playing ? "Pause" : "Play"}</button>
          <button type="button" aria-label="Reveal next step" disabled={revealed >= total} onClick={() => goTo(revealed + 1)}>Next ›</button>
          <label className="sq-speed">Speed{" "}
            <select aria-label="Step speed" value={speed} onChange={(e) => setSpeed(Number(e.target.value))}>
              {SPEEDS.map((s) => <option key={s.ms} value={s.ms}>{s.label}</option>)}
            </select>
          </label>
          <Tag state="info" testId="slow-badge">Slow mode — {Math.min(revealed, total)}/{total}</Tag>
        </>)}
        <button type="button" aria-pressed={follow} onClick={() => setFollow((f) => !f)} title="Keep the current step in view">Follow flow</button>
      </div>

      <div className="sq-stage">
        <div className="sq-actors" role="group" aria-label="Actors, click one for its details">
          {cast.map((id) => {
            const a = actorOf(id);
            const st = actorState(id);
            return (
              <button type="button" key={id} className="sq-actor" data-state={st} style={{ "--lane": laneVar(id) }} aria-pressed={actor === id}
                aria-label={`${a.label}, ${STATE_WORD[st]}, details`} data-testid={`actor-${id}`} onClick={() => openActor(id)}>
                <span className="ev-ini" aria-hidden="true">{a.initials}</span>
                <span className="sq-actor__txt"><b>{a.label}</b><span className="sq-actor__st">{STATE_WORD[st]}</span></span>
              </button>
            );
          })}
        </div>
        <div className="sq-prog" aria-label={`Progress ${Math.min(revealed, total)} of ${total}`} role="img">
          {shown.map((h, i) => <span key={h.n} data-state={h.n === focusN ? "on" : i < revealed ? "done" : "pending"} />)}
        </div>
        {actor && <ActorCard actorId={actor} hops={shown} onSelect={(n) => { setActor(null); onSelect?.(n); }} onClose={() => setActor(null)} />}

        <div className="sq-scroll" ref={scrollRef}>
          <svg className="sq-svg" viewBox={`0 0 ${width} ${height}`} width={zoom === "fit" ? undefined : (width * zoom) / 100}
            style={zoom === "fit" ? { width: "100%", maxWidth: `${width}px` } : undefined} data-zoom={zoom === "fit" ? "fit" : String(zoom)} role="group"
            aria-label={`Sequence diagram, ${total} steps${sel}`} data-testid="sequence-svg">
            <defs>
              <marker id={`${uid}a`} markerWidth="9" markerHeight="9" refX="8" refY="4.5" orient="auto"><path d="M0,0 L9,4.5 L0,9 z" className="sq-head" /></marker>
              <marker id={`${uid}b`} markerWidth="9" markerHeight="9" refX="8" refY="4.5" orient="auto"><path d="M0,0 L9,4.5 L0,9 z" className="sq-head sq-head--on" /></marker>
            </defs>
            {cast.map((id) => {
              const x = colX(id);
              const a = actorOf(id);
              const box = (y, h, ty, small, where) => (
                <g role="button" tabIndex={-1} className="sq-lbtn" aria-label={`${a.label} actor details (${where})`} onClick={() => openActor(id)} onKeyDown={(e) => actorKey(e, id)}>
                  <rect className="sq-lbox" x={x - laneBox / 2} y={y} width={laneBox} height={h} rx="7" />
                  <text className={`sq-lt${small ? " sq-lt--sm" : ""}`} x={x} y={ty} textAnchor="middle">{a.label}</text>
                </g>
              );
              return (
                <g key={id} className="sq-lane" style={{ "--lane": laneVar(id) }} data-actor={id}>
                  {box(4, 34, 26, false, "top")}
                  <line className="sq-life" x1={x} y1="38" x2={x} y2={footY} />
                  {box(footY, 28, footY + 19, true, "bottom")}
                </g>
              );
            })}
            {shown.map((h, i) => {
              const y = TOP + i * ROW;
              const on = h.n === focusN;
              const pending = slow && i >= revealed;
              const label = labels[i];
              const common = {
                ref: (el) => { rowRefs.current[h.n] = el; },
                className: "sq-row", "data-on": on ? "true" : undefined, "data-pending": pending ? "true" : undefined, "data-verdict": h.verdict || "ok",
                role: "button", tabIndex: h.n === tabN ? 0 : -1, "aria-current": on ? "step" : undefined,
                "aria-label": `Step ${label}, ${actorOf(h.from).label} to ${actorOf(h.to).label}${pending ? ", not revealed yet" : ""}`,
                "data-testid": `row-${h.n}`,
                onClick: () => onSelect?.(h.n), onKeyDown: (e) => onRowKey(e, h.n),
              };
              const hit = <rect className="sq-hit" x="8" y={y - 30} width={width - 16} height="50" rx="6" />;
              if (isNote(h)) {
                const x = colX(h.from);
                const w = noteW(label);
                return (
                  <g key={h.n} {...common} style={{ "--lane": laneVar(h.from) }}>
                    {hit}
                    <rect className="sq-note" x={x - w / 2} y={y - 20} width={w} height="34" rx="6" />
                    <text className="sq-al" x={x} y={y + 2} textAnchor="middle">{label}</text>
                  </g>
                );
              }
              const x1 = colX(h.from), x2 = colX(h.to);
              const end = x2 > x1 ? x2 - 5 : x2 + 5;
              const mid = (x1 + x2) / 2;
              const w = labelW(label);
              return (
                <g key={h.n} {...common}>
                  {hit}
                  <line className="sq-msg" x1={x1} y1={y} x2={end} y2={y} markerEnd={`url(#${uid}${on ? "b" : "a"})`} />
                  <rect className="sq-albox" x={mid - w / 2} y={y - 25} width={w} height="20" rx="5" />
                  <text className="sq-al" x={mid} y={y - 11} textAnchor="middle">{label}</text>
                </g>
              );
            })}
          </svg>
        </div>
      </div>
      {skipped > 0 && (
        <button type="button" className="ev-chipbtn" aria-expanded={showSkipped} onClick={() => setShowSkipped((v) => !v)}>
          {showSkipped ? `− ${skipped} hops not in this run` : `+ ${skipped} hops not in this run`}
        </button>
      )}
      <p className="ev-foot">Every actor box and every step row is clickable. Click an actor for what it does; click a step for its full detail.</p>
    </section>
  );
}
