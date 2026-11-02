import { useEffect, useState } from "react";
import { getJson } from "../api";
import { outcomeState } from "../lib";
import { Tag } from "./Bits";

// The server's short list of run summaries for this workspace (GET /api/runs). It reloads whenever a run is made or the workspace is reset.
export default function RunHistory({ refresh }) {
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  useEffect(() => {
    let live = true;
    getJson("/api/runs").then((j) => { if (live) { setData(j); setError(null); } }, (e) => { if (live) setError(e.message); });
    return () => { live = false; };
  }, [refresh]);
  if (error) return <p className="field-error" role="alert">Could not load the run history ({error}).</p>;
  if (!data) return <p className="muted">Loading the run history...</p>;
  return (
    <section className="panel" aria-label="Run history" data-testid="history">
      <h2 className="panel__title">Run history</h2>
      <p className="muted">This workspace keeps up to {data.max} run summaries ({data.count} now). Reset clears them.</p>
      {data.runs.length === 0 ? <p className="muted" data-testid="history-empty">No runs yet. Pick a use case on the Agent page and Run.</p> : (
        <div className="scroll"><table className="tbl tbl--wide">
          <thead><tr><th>#</th><th>Use case</th><th>Vertical</th><th>Persona</th><th>Outcome</th><th>Check</th><th>Trace</th></tr></thead>
          <tbody>{data.runs.map((r) => (
            <tr key={r.seq} data-testid="history-row">
              <td>{r.seq}</td><td>{r.id}</td><td>{r.vertical}</td><td>{r.persona ?? "n/a (live)"}</td>
              <td><Tag state={outcomeState(r.outcome)}>{r.outcome}</Tag></td>
              <td>{String(r.outcome).startsWith("LIVE_") ? "live, identity provider only" : r.matchesExpected === null ? "guided, not computed" : r.matchesExpected ? "matches the catalog label" : "differs from the catalog label"}</td>
              <td><code>{String(r.traceId).slice(0, 8)}</code></td>
            </tr>
          ))}</tbody>
        </table></div>
      )}
    </section>
  );
}
