import { useEffect, useState } from "react";
import PatternDiagram from "./PatternDiagram";
import { getJson } from "../api";

const pretty = (n) => String(n).replace(/-/g, " ").replace(/^./, (c) => c.toUpperCase());

// Diagrams are diagram-studio/1 data loaded BY NAME from the server (rule 17). Nothing is drawn from hand-built nodes here.
export default function DiagramView({ vertical, resetSignal, lastRun }) {
  const [names, setNames] = useState(["delegation-chain", "gateway-refusals"]);
  const [name, setName] = useState("delegation-chain");
  const [diagram, setDiagram] = useState(null);
  const [error, setError] = useState(null);
  const v = vertical;
  useEffect(() => {
    let live = true; // a late answer for a diagram or vertical the visitor has already left is dropped
    setDiagram(null);
    getJson(`/api/diagram?vertical=${encodeURIComponent(v)}&name=${encodeURIComponent(name)}`).then((j) => { if (live) { setDiagram(j.diagram); setNames(j.names); setError(null); } }, (e) => { if (live) setError(e.message); });
    return () => { live = false; };
  }, [v, name]);
  return (
    <div className="stack">
      <div className="seg" role="group" aria-label="Diagram">
        {names.map((n) => <button key={n} type="button" aria-pressed={name === n} onClick={() => setName(n)} data-testid={`dg-${n}`}>{pretty(n)}</button>)}
      </div>
      {error ? <p className="field-error" role="alert">Could not load the diagram ({error}).</p> : diagram ? <PatternDiagram key={diagram.name} diagram={diagram} resetSignal={resetSignal} lastRun={lastRun} /> : <p className="muted">Loading the diagram...</p>}
    </div>
  );
}
