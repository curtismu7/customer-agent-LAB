import { useState } from "react";
import { verdictState } from "../lib";
import { Json, MockTag, Tag } from "./Bits";

// The ordered hops of a run. Each hop shows the raw request and response and its own traceparent (rule 14).
export default function HopList({ hops, traceparent, title = "Hops" }) {
  const [allOpen, setAllOpen] = useState(false);
  return (
    <section className="hops" aria-label={title} data-testid="hops">
      <div className="hops__bar">
        <h3 className="panel__sub">{title} ({hops.length})</h3>
        <button type="button" onClick={() => setAllOpen((v) => !v)} data-testid="hops-toggle">{allOpen ? "Collapse all hops" : "Open all hops"}</button>
      </div>
      {traceparent && <p className="muted">Run traceparent: <code data-testid="run-traceparent">{traceparent}</code></p>}
      <ol className="hops__list" key={String(allOpen)}>
        {hops.map((h) => (
          <li key={`${h.n}-${h.kind}`}>
            <details className="hop" open={allOpen} data-testid="hop">
              <summary className="hop__summary">
                <span className="hop__n">{h.n}.</span> <span className="hop__label">{h.label}</span>
                {" "}<Tag state={verdictState(h.verdict)} testId="hop-verdict">{h.verdict}</Tag>{h.mock && <> <MockTag /></>}
              </summary>
              <p className="muted">{h.from} to {h.to} <span className="mono">({h.kind})</span></p>
              {h.note && <p className="muted">{h.note}</p>}
              {h.traceparent && <p className="muted">traceparent: <code>{h.traceparent}</code></p>}
              <p className="field-label">Request</p>
              <Json value={h.request} label={`hop ${h.n} request`} />
              <p className="field-label">Response</p>
              <Json value={h.response} label={`hop ${h.n} response`} />
            </details>
          </li>
        ))}
      </ol>
    </section>
  );
}
