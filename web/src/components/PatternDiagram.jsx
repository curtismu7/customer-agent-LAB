import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Background, BackgroundVariant, BaseEdge, Controls, EdgeLabelRenderer, getBezierPath, Handle, MarkerType, Position, ReactFlow, ReactFlowProvider } from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { useDiagramStepper, STEP_TIME_OPTIONS } from "../hooks/useDiagramStepper";
import { REFIT_EVENT, useFitOnResize } from "../hooks/useFitOnResize";
import { verdictState } from "../lib";
import { Tag } from "./Bits";

const FIT = { padding: 0.08 };
// At phone width fitting the whole wide diagram makes the text unreadable, so the first view fits the first two boxes whole (zoom 0.3 to 0.55; node text is
// enlarged in app.css) and a hint above the canvas says the rest is a drag away; drag the canvas to pan, drag a box to move it.
const narrow = () => typeof window !== "undefined" && typeof window.matchMedia === "function" && window.matchMedia("(max-width: 600px)").matches;
const HANDLES = [["t", Position.Top], ["b", Position.Bottom], ["l", Position.Left], ["r", Position.Right]];

function Box({ data }) {
  return (
    <div className="dnode" data-color={data.color} data-on={data.on ? "true" : "false"}>
      {HANDLES.map(([k, pos]) => (
        <span key={k}>
          <Handle id={`s-${k}`} type="source" position={pos} className="dnode__handle" />
          <Handle id={`t-${k}`} type="target" position={pos} className="dnode__handle" />
        </span>
      ))}
      {data.label}
    </div>
  );
}
const nodeTypes = { box: Box };

// An edge that draws its own label, so steps along the same pair of boxes can sit apart instead of on top of each other.
function LabelEdge({ id, sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition, markerEnd, data }) {
  const [path, lx, ly] = getBezierPath({ sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition });
  return (
    <>
      <BaseEdge id={id} path={path} markerEnd={markerEnd} />
      <EdgeLabelRenderer>
        <div className="dlabel" data-now={data.now ? "true" : "false"} data-dim={data.dim ? "true" : "false"} data-testid="edge-label"
          style={{ transform: `translate(-50%, -50%) translate(${lx}px, ${ly + data.dy}px)` }}>{data.text}</div>
      </EdgeLabelRenderer>
    </>
  );
}
const edgeTypes = { label: LabelEdge };

const samePair = (a, b) => (a.from === b.from && a.to === b.to) || (a.from === b.to && a.to === b.from);
// Steps along the same pair of boxes (either direction) are spread out: the label of the k-th of n steps sits (k - (n-1)/2) * 30 px from the middle.
export function labelOffsets(steps) {
  return steps.map((s, i) => {
    const group = steps.map((o, j) => [o, j]).filter(([o]) => samePair(o, s));
    const k = group.findIndex(([, j]) => j === i);
    return Math.round((k - (group.length - 1) / 2) * 30);
  });
}

// Pick the sides of the two boxes that face each other, so an arrow leaves toward its target. A later step on a pair that already has an arrow loops out of
// another side so the two arrows are not drawn over each other.
function sides(a, b) {
  const dx = b.x - a.x, dy = b.y - a.y;
  return Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? ["r", "l"] : ["l", "r"]) : (dy > 0 ? ["b", "t"] : ["t", "b"]);
}
export function edgeSides(steps, i, positions) {
  const s = steps[i];
  const [a, b] = sides(positions[s.from], positions[s.to]);
  const earlier = steps.slice(0, i).filter((o) => samePair(o, s)).length;
  if (earlier === 0) return [a, b];
  const horizontal = a === "l" || a === "r";
  const loop = earlier % 2 === 1 ? (horizontal ? "b" : "r") : (horizontal ? "t" : "l");
  return [loop, loop];
}

function Canvas({ diagram, positions, onMove, stepper }) {
  const ref = useRef(null);
  const fit = useMemo(() => (narrow() ? { padding: 0.1, minZoom: 0.3, maxZoom: 0.55, nodes: diagram.nodes.slice(0, 2).map((n) => ({ id: n.id })) } : FIT), [diagram]);
  useFitOnResize(ref, fit);
  const active = stepper.step >= 0 ? diagram.steps[stepper.step] : null;
  const nodes = diagram.nodes.map((n) => ({
    id: n.id, type: "box", position: positions[n.id], draggable: true,
    data: { label: n.label, color: diagram.groups?.[n.kind]?.color || "dark", on: !!active && (active.from === n.id || active.to === n.id) },
  }));
  const offs = labelOffsets(diagram.steps);
  const edges = diagram.steps.map((s, i) => {
    const [a, b] = edgeSides(diagram.steps, i, positions);
    const now = stepper.step === i;
    const seen = stepper.step >= 0 && i <= stepper.step;
    return {
      id: `e${i}`, source: s.from, target: s.to, sourceHandle: `s-${a}`, targetHandle: `t-${b}`, type: "label",
      animated: now, data: { text: `${i + 1}. ${s.label}`, dy: offs[i], now, dim: stepper.step >= 0 && !seen },
      className: `dedge${now ? " dedge--now" : ""}${stepper.step >= 0 && !seen ? " dedge--dim" : ""}`,
      markerEnd: { type: MarkerType.ArrowClosed },
    };
  });
  return (
    <div ref={ref} className="diagram__canvas" data-testid="diagram-canvas">
      <ReactFlow nodes={nodes} edges={edges} nodeTypes={nodeTypes} edgeTypes={edgeTypes} fitView fitViewOptions={fit} nodesConnectable={false} minZoom={0.3}
        onNodeDragStop={(_, n) => onMove(n.id, n.position)} onNodeDrag={(_, n) => onMove(n.id, n.position)} proOptions={{ hideAttribution: true }}>
        <Background variant={BackgroundVariant.Dots} gap={18} />
        <Controls showInteractive={false} />
      </ReactFlow>
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
  const onMove = useCallback((id, p) => setPositions((cur) => ({ ...cur, [id]: { x: p.x, y: p.y } })), []);
  const step = stepper.step >= 0 ? diagram.steps[stepper.step] : null;
  const hop = step && lastRun ? lastRun.run.hops.find((h) => h.kind === step.hop) : null;
  // Reset restores box positions as well as the walkthrough and the view. The page-level Reset raises resetSignal.
  const reset = useCallback(() => { stepper.stop(); setPositions(initial); setTimeout(() => window.dispatchEvent(new Event(REFIT_EVENT)), 0); }, [stepper.stop, initial]); // eslint-disable-line react-hooks/exhaustive-deps
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
      <p className="muted dhint" data-testid="diagram-hint">This diagram is wider than the screen: drag the background to pan, and use the + and - buttons to zoom.</p>
      <ReactFlowProvider>
        <Canvas diagram={diagram} positions={positions} onMove={onMove} stepper={stepper} />
      </ReactFlowProvider>
      <p className="muted" data-testid="diagram-moved">Drag any box; drag the background to pan. Simulated. Moved: {moved} box(es).</p>
    </section>
  );
}
