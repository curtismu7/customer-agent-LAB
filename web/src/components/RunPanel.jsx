import { NEEDS_LABELS, TRACK_LABELS, outcomeState, triggerText } from "../lib";
import { InventedTag, Tag } from "./Bits";
import HopList from "./HopList";
import TokenView from "./TokenView";

// The honest refusal text for each answer the API can give instead of a run. The server's own detail is shown as it is.
const REFUSAL = {
  vertical_stub: ["Not built", "This vertical is a data stub: it has a name and no pack yet. Pick Banking, Healthcare or Retail to run."],
  live_not_built: ["Live is not built", "Live mode is step 3 and is not built yet. Switch to Mock to run this use case."],
  live_not_allowed: ["Live is refused", "Live mode is not allowed on this machine."],
  mock_signin_refused: ["Mock sign-in refused", "The mock sign-in guards did not hold."],
  workspace_full: ["Workspace full", "This workspace holds the most runs it keeps. Reset it to continue."],
  network: ["No answer from the server", "The server did not answer. Is it running?"],
};

export function Refusal({ result }) {
  const code = result.body?.error || `http_${result.status}`;
  const [head, fallback] = REFUSAL[code] || ["Refused", "The server refused this run."];
  const noAnswer = !result.status; // status 0 = the request never got an HTTP answer
  return (
    <div className="panel panel--inner" data-state={result.status === 501 ? "warn" : "bad"} role="alert" data-testid="refusal" data-code={code}>
      <h3 className="panel__sub">{head} <Tag state={result.status === 501 ? "warn" : "bad"}>{noAnswer ? "no HTTP answer" : `HTTP ${result.status}`}</Tag></h3>
      <p>{result.body?.detail || fallback}</p>
      {result.body?.live?.message && <p className="muted">{result.body.live.message}</p>}
    </div>
  );
}

function Inputs({ uc }) {
  const entries = Object.entries(uc.labInputs || {});
  return (
    <div className="inputs" data-testid="lab-inputs">
      <p className="field-label">What the lab feeds the engine {entries.length ? <InventedTag /> : null}</p>
      {entries.length === 0
        ? <p className="muted">Nothing special: the lab runs the catalog's evidence chain for the everyday read tool and the persona you pick below.</p>
        : <ul className="plain">{entries.map(([k, v]) => <li key={k}><code>{k}</code>: <code>{JSON.stringify(v)}</code> <InventedTag /></li>)}</ul>}
    </div>
  );
}

export function RunResult({ run }) {
  const guided = run.kind === "guided";
  return (
    <section className="result" aria-label="Run result" data-testid="result">
      <div className="result__head">
        <Tag state={outcomeState(run.outcome)} testId="outcome">{run.outcome}</Tag>
        {guided
          ? <Tag state="warn" testId="guided-note" title="The lab did not compute this">guided, not computed</Tag>
          : <Tag state={run.matchesExpected ? "ok" : "bad"} testId="matches">{run.matchesExpected ? "engine result matches the catalog label" : "engine result differs from the catalog label"}</Tag>}
        {run.labSimulated && <Tag state="warn">lab-simulated (source says needs-build)</Tag>}
        <Tag state="info">mode: {run.mode}</Tag>
        <Tag state="info">persona: {run.persona}</Tag>
      </div>
      <p data-testid="narration">{run.narration}</p>
      {guided && <p className="muted" data-testid="guided-explain">Guided, not computed: the lab opened the page the product would open and shows the catalog's label ({run.expectedOutcome}). It did not run or verify that outcome.</p>}
      {run.live?.status === "needs-flag" && <p className="muted" data-testid="live-note">{run.live.message}</p>}
      <HopList hops={run.hops} traceparent={run.traceparent} />
      <h3 className="panel__sub">Tokens</h3>
      <TokenView tokens={run.tokens} />
    </section>
  );
}

// The one line a screen reader hears when a run finishes.
const announce = (run) => `${run.useCase?.id || "Run"} finished: ${run.outcome}${run.kind === "guided" ? ", guided, not computed" : run.matchesExpected ? ", matches the catalog label" : ", differs from the catalog label"}.`;

export default function RunPanel({ uc, vertical, verticals, persona, setPersona, personas, onRun, running, result, mode }) {
  if (!uc) return <section className="panel" data-testid="run-empty"><h2 className="panel__title">Run a use case</h2><p className="muted">Pick a use case on the left. Then choose a vertical pack and a persona, and Run.</p></section>;
  const v = verticals.find((x) => x.id === vertical);
  const stub = v?.pack === "stub";
  return (
    <section className="panel" aria-label="Run a use case" data-testid="run-panel">
      <p className="muted" data-testid="run-track">{TRACK_LABELS[uc.track] || uc.track} / {uc.id}</p>
      <h2 className="panel__title" data-testid="run-title">{uc.title}</h2>
      <p>{uc.buyerStory}</p>
      <details>
        <summary>What the product does (catalog text, from AI-DEMO2)</summary>
        <p>{uc.pingOneSolution}</p>
        <ul className="plain">{Object.entries(uc.productRoles || {}).map(([k, t]) => <li key={k}><strong>{NEEDS_LABELS[k] || k}:</strong> {t}</li>)}</ul>
      </details>
      <p className="muted">Trigger in the product: <code>{triggerText(uc.trigger)}</code></p>
      <p className="muted">Expected outcome (the catalog's label): <Tag state={outcomeState(uc.expectedOutcome)}>{uc.expectedOutcome}</Tag> {uc.tool && <>Tool in this vertical: <code>{uc.tool}</code></>}</p>
      {uc.live?.status === "needs-flag" && <p className="muted" data-testid="flag-note">{uc.live.message}</p>}
      {uc.live?.status === "needs-build" && <p className="muted">{uc.live.message}</p>}
      <Inputs uc={uc} />
      <div className="runbar">
        <label className="field">Persona <InventedTag />
          <select value={persona} onChange={(e) => setPersona(e.target.value)} data-testid="persona">
            {personas.map((p) => <option key={p} value={p}>{p}</option>)}
          </select>
        </label>
        {/* aria-disabled, not disabled: a disabled button drops keyboard focus to the page body while the run is in flight. */}
        <button type="button" className="primary" onClick={running ? undefined : onRun} aria-disabled={running ? "true" : undefined} data-testid="run">{running ? "Running..." : mode ? `Run in ${mode}` : "Run"}</button>
      </div>
      {stub && <p className="muted" data-testid="stub-hint">The selected vertical ({v.label}) is a stub. Running it shows the server's honest "not built" answer.</p>}
      {/* The live region says the outcome only; the hop and token dump is not announced. */}
      <p className="sr-only" role="status" aria-live="polite" data-testid="run-announce">{result?.ok ? announce(result.body.run) : ""}</p>
      {result && !result.ok && <Refusal result={result} />}
      {result?.ok && <RunResult run={result.body.run} />}
    </section>
  );
}
