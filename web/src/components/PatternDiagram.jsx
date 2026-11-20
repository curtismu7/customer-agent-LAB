import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Background, BackgroundVariant, Controls, Handle, MarkerType, Position, ReactFlow, ReactFlowProvider } from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { useDiagramStepper, STEP_TIME_OPTIONS } from "../hooks/useDiagramStepper";
import { REFIT_EVENT, useFitOnResize } from "../hooks/useFitOnResize";
import { verdictState } from "../lib";
import { Tag } from "./Bits";
import { ArrowNoLabel, EdgeLabels, FitOpen, Passport, PassportActions } from "../diagram-kit/DiagramKit.jsx";
import { boxPassport, sidePoint } from "../diagram-kit/diagramKit.js";
import "../diagram-kit/diagram-kit.css";

const FIT = { padding: 0.08 };
// At phone width fitting the whole wide diagram makes the text unreadable, so the first view fits the first two boxes whole (zoom 0.3 to 0.55; node text is
// enlarged in app.css) and a hint above the canvas says the rest is a drag away; drag the canvas to pan, drag a box to move it.
const narrow = () => typeof window !== "undefined" && typeof window.matchMedia === "function" && window.matchMedia("(max-width: 600px)").matches;
const HANDLES = [["t", Position.Top], ["b", Position.Bottom], ["l", Position.Left], ["r", Position.Right]];

function Box({ data }) {
  return (
    <div className="dnode" data-color={data.color} data-on={data.on ? "true" : "false"} data-testid={`dnode-${data.id}`}>
      {HANDLES.map(([k, pos]) => (
        <span key={k}>
          <Handle id={`s-${k}`} type="source" position={pos} className="dnode__handle" />
          <Handle id={`t-${k}`} type="target" position={pos} className="dnode__handle" />
        </span>
      ))}
      {data.label}
      {data.passport && <Passport p={data.passport} />}
    </div>
  );
}
const nodeTypes = { box: Box };

// The arrow draws the curve only: every label is drawn by EdgeLabels, above the boxes, placed clear of the other labels and the boxes.
const edgeTypes = { arrow: ArrowNoLabel };

// Pick the sides of the two boxes that face each other, so an arrow leaves toward its target. A later step on a pair that already has an arrow loops out of
// another side so the two arrows are not drawn over each other.
function sides(a, b) {
  const dx = b.x - a.x, dy = b.y - a.y;
  return Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? ["r", "l"] : ["l", "r"]) : (dy > 0 ? ["b", "t"] : ["t", "b"]);
}
export function edgeSides(steps, i, positions) {
  const s = steps[i];
  const [a, b] = sides(positions[s.from], positions[s.to]);
  const earlier = steps.slice(0, i).filter((o) => (o.from === s.from && o.to === s.to) || (o.from === s.to && o.to === s.from)).length;
  if (earlier === 0) return [a, b];
  const horizontal = a === "l" || a === "r";
  const loop = earlier % 2 === 1 ? (horizontal ? "b" : "r") : (horizontal ? "t" : "l");
  return [loop, loop];
}

function Canvas({ diagram, graph, positions, onMove, stepper, open, setOpen }) {
  const ref = useRef(null);
  const fit = useMemo(() => (narrow() ? { padding: 0.1, minZoom: 0.3, maxZoom: 0.55, nodes: diagram.nodes.slice(0, 2).map((n) => ({ id: n.id })) } : FIT), [diagram]);
  useFitOnResize(ref, fit);
  const active = stepper.step >= 0 ? diagram.steps[stepper.step] : null;
  const nodes = diagram.nodes.map((n) => ({
    id: n.id, type: "box", position: positions[n.id], draggable: true, zIndex: n.id === open ? 10 : undefined, // an expanded box sits above its neighbours
    data: { id: n.id, label: n.label, color: diagram.groups?.[n.kind]?.color || "dark", on: !!active && (active.from === n.id || active.to === n.id), passport: n.id === open ? boxPassport(graph, n.id) : null },
  }));
  const edges = diagram.steps.map((s, i) => {
    const [a, b] = edgeSides(diagram.steps, i, positions);
    const now = stepper.step === i;
    const seen = stepper.step >= 0 && i <= stepper.step;
    return {
      id: `e${i}`, source: s.from, target: s.to, sourceHandle: `s-${a}`, targetHandle: `t-${b}`, type: "arrow",
      animated: now,
      className: `dedge${now ? " dedge--now" : ""}${stepper.step >= 0 && !seen ? " dedge--dim" : ""}`,
      markerEnd: { type: MarkerType.ArrowClosed },
    };
  });
  // One label per arrow, in a layer above the boxes, placed clear of the other labels and the boxes.
  const labels = diagram.steps.map((s, i) => ({
    id: `e${i}`, text: `${i + 1}. ${s.label}`, source: s.from, target: s.to, sourceHandle: edges[i].sourceHandle, targetHandle: edges[i].targetHandle,
    active: stepper.step === i, dim: stepper.step >= 0 && !(i <= stepper.step),
  }));
  // What an expanded box can do: open the box at the far end of an arrow, close itself, and make a link that opens this page with the box expanded.
  const actions = useMemo(() => ({
    open: (id) => setOpen(id), close: () => setOpen(null),
    link: (id) => { const u = new URL(window.location.href); u.searchParams.set("box", id); return u.toString(); },
  }), [setOpen]);
  return (
    <div ref={ref} className="diagram__canvas" data-testid="diagram-canvas">
      <PassportActions.Provider value={actions}>
        <ReactFlow nodes={nodes} edges={edges} nodeTypes={nodeTypes} edgeTypes={edgeTypes} fitView fitViewOptions={fit} nodesConnectable={false} minZoom={0.3}
          onNodeClick={(_, n) => setOpen((o) => (o === n.id ? null : n.id))} onPaneClick={() => setOpen(null)}
          onNodeDragStop={(_, n) => onMove(n.id, n.position)} onNodeDrag={(_, n) => onMove(n.id, n.position)} proOptions={{ hideAttribution: true }}>
          <Background variant={BackgroundVariant.Dots} gap={18} />
          <Controls showInteractive={false} />
          <EdgeLabels items={labels} pointFor={(box, handle) => sidePoint(box, String(handle).split("-")[1])} fallback={{ w: 150, h: 56 }} />
          <FitOpen open={open} closePadding={FIT.padding} />
        </ReactFlow>
      </PassportActions.Provider>
    </div>
  );
}

// Simulate, pause, step, speed, stop; and Reset (positions and walkthrough).
function StepBar({ stepper, onReset, caption, total }) {
  const { step, active, paused } = stepper;
  return (
    <div className="dstep" data-testid="diagram-step-bar">
      <div className="dstep__row">
        <label className="inline">Step time{" "}
          <select value={stepper.stepMs} onChange={(e) => stepper.setStepMs(Number(e.target.value))} disabled={active && !paused} data-testid="speed">
            {STEP_TIME_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
        </label>
        {!active ? <button type="button" className="primary" onClick={stepper.simulate} data-testid="simulate">Simulate</button> : (
          <>
            <button type="button" onClick={stepper.prev} disabled={!paused}>Prev</button>
            {paused ? <button type="button" onClick={stepper.resume}>Resume</button> : <button type="button" onClick={stepper.pause}>Pause</button>}
            <button type="button" onClick={stepper.next} disabled={!paused}>Next</button>
            <button type="button" onClick={stepper.stop}>Stop</button>
          </>
        )}
        <button type="button" onClick={onReset} data-testid="diagram-reset">Reset positions and walkthrough</button>
      </div>
      <p className="dstep__caption" aria-live="polite">{active ? <><strong>Step {step + 1} of {total}</strong>{caption ? ` : ${caption}` : ""}</> : `Simulate walks the ${total} arrows in order.`}</p>
    </div>
  );
}

export default function PatternDiagram({ diagram, resetSignal = 0, lastRun = null }) {
  const initial = useMemo(() => Object.fromEntries(diagram.nodes.map((n) => [n.id, { x: n.x, y: n.y }])), [diagram]);
  const [positions, setPositions] = useState(initial);
  const stepper = useDiagramStepper(diagram.steps.length);
  // The pattern as a graph (boxes and arrows) for the box details; a box's kind is its group.
  const graph = useMemo(() => ({ nodes: diagram.nodes.map((n) => ({ id: n.id, label: n.label, group: n.kind })), edges: diagram.steps.map((st, i) => ({ source: st.from, target: st.to, label: `${i + 1}. ${st.label}` })), groups: diagram.groups }), [diagram]);
  const [open, setOpen] = useState(() => { const box = new URLSearchParams(window.location.search).get("box"); return box && diagram.nodes.some((n) => n.id === box) ? box : null; }); // a shared link's box
  const onMove = useCallback((id, p) => setPositions((cur) => ({ ...cur, [id]: { x: p.x, y: p.y } })), []);
  const step = stepper.step >= 0 ? diagram.steps[stepper.step] : null;
  const hop = step && lastRun ? lastRun.run.hops.find((h) => h.kind === step.hop) : null;
  // Reset restores box positions as well as the walkthrough and the view. The page-level Reset raises resetSignal.
  const reset = useCallback(() => { stepper.stop(); setPositions(initial); setOpen(null); setTimeout(() => window.dispatchEvent(new Event(REFIT_EVENT)), 0); }, [stepper.stop, initial]); // eslint-disable-line react-hooks/exhaustive-deps
  const seen = useRef(resetSignal);
  useEffect(() => { if (seen.current !== resetSignal) { seen.current = resetSignal; reset(); } }, [resetSignal, reset]);
  const moved = Object.keys(positions).filter((k) => positions[k].x !== initial[k].x || positions[k].y !== initial[k].y).length;
  return (
    <section className="diagram" aria-label={diagram.title}>
      <h2 className="panel__title">{diagram.title}</h2>
      <p className="lede">{diagram.intro}</p>
      <StepBar stepper={stepper} onReset={reset} caption={step ? step.label : ""} total={diagram.steps.length} />
      {step && (
        <article className="panel panel--inner" data-testid="diagram-now">
          <h3 className="panel__sub">Step {stepper.step + 1}: {step.label}</h3>
          <p>{step.say}</p>
          {hop && <p className="muted" data-testid="diagram-hop">In your last run ({lastRun.run.useCase.id}): hop {hop.n}, {hop.label} <Tag state={verdictState(hop.verdict)}>{hop.verdict}</Tag></p>}
        </article>
      )}
      <p className="muted dhint" data-testid="diagram-hint">This diagram is wider than the screen: drag the background to pan, and use the + and - buttons to zoom. Click a box to see its details.</p>
      <ReactFlowProvider>
        <Canvas diagram={diagram} graph={graph} positions={positions} onMove={onMove} stepper={stepper} open={open} setOpen={setOpen} />
      </ReactFlowProvider>
      <p className="muted" data-testid="diagram-moved">Drag any box; drag the background to pan. Simulated. Moved: {moved} box(es).</p>
    </section>
  );
}
