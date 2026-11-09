import { Fragment } from "react";
import SequenceView from "../evidence/SequenceView";
import MovieReel from "../evidence/MovieReel";
import StepDetailPanel from "../evidence/StepDetailPanel";
import DiagramView from "./DiagramView";
import TokenView from "./TokenView";
import { DIAGRAMS, VIEWS, VIEW_LABEL } from "../quickConfig";
import { handoffCarry, routeOf } from "../handoff";
import { Tag } from "./Bits";

// The hand-off summary the evidence column shows while a Hand off use case is selected and has not been previewed.
function HandoffSummary({ uc, catalog, vertical, userId }) {
  const all = (catalog?.tracks || []).flatMap((t) => t.usecases);
  const n = (f) => all.filter((u) => f(routeOf(u).route)).length;
  const app = routeOf(uc).app;
  const same = all.filter((u) => routeOf(u).route === "Hand off" && routeOf(u).app === app);
  return (
    <section className="evsum" aria-label="Hand-off" data-testid="handoff-summary">
      <ul className="card-grid evsum__cards">
        <li className="card card--ok"><h3>Runs here · {n((r) => r === "Here" || r === "Here + go deeper")}</h3><p className="muted">One agent; the mock engine decides.</p></li>
        <li className="card"><h3>Hands off · {n((r) => r === "Hand off")}</h3><p className="muted">Opens its own standalone app, same tab.</p></li>
        <li className="card card--neutral"><h3>Guides · {n((r) => r === "Guide")}</h3><p className="muted">Learning pages and scripts, no lab yet.</p></li>
      </ul>
      <div className="evsum__carry">
        <div>
          <p className="kicker">Carried in the link</p>
          <dl className="kv">
            {(handoffCarry(uc.id, vertical, userId) || []).map(([k, v]) => <Fragment key={k}><dt>{k}</dt><dd className="mono">{v}</dd></Fragment>)}
          </dl>
        </div>
        <div>
          <p className="kicker">Never carried</p>
          <ul className="plain"><li>tokens</li><li>secrets or keys</li><li>cookies</li></ul>
        </div>
      </div>
      <p className="kicker">Everything this lab hands to <code>{app}</code></p>
      <ul className="evsum__list">{same.map((u) => <li key={u.id} data-current={u.id === uc.id ? "true" : undefined}><span className="mono">{u.id}</span> {u.title}</li>)}</ul>
      <p className="muted">This app does not check whether the other one is running (no outbound calls). If it does not load, start it from the Shelf.</p>
    </section>
  );
}

export default function EvidenceColumn({ run, selHop, onSelect, config, onTab, onFull, vertical, resetSignal, lastRun, uc, catalog, userId, showHandoff }) {
  const hops = run?.hops || [];
  const tabs = VIEWS.filter((v) => DIAGRAMS.includes(v) || config.views.tokens === "embedded");
  const tab = tabs.includes(config.tab) && (config.tab === "tokens" || config.views[config.tab] === "embedded") ? config.tab : null;
  return (
    <section className="evcol" aria-label="Evidence" data-testid="evidence-column">
      <header className="evcol__head">
        <h2 className="evcol__title">Evidence</h2>
        <span className="muted">{run ? `${run.useCase?.id} · ${hops.length} hops${run.mode === "mock" ? " · MOCK engine" : run.mode === "live" ? " · LIVE" : ""}` : "nothing run yet"}</span>
        <span className="spacer" />
        <button type="button" onClick={() => onFull("sequence")} data-testid="full-sequence" title="The sequence view on a page of its own">Full page</button>
      </header>
      {showHandoff ? <HandoffSummary uc={uc} catalog={catalog} vertical={vertical} userId={userId} /> : (
        <>
          {/* A segmented control, not a second tablist: the page's tabpanel is the agent area itself. Pressed = the view on show. */}
          <div className="evtabs seg" role="group" aria-label="Evidence view" data-testid="evidence-tabs">
            {tabs.map((v) => (
              <button key={v} type="button" aria-pressed={tab === v} aria-controls="evpanel" onClick={() => onTab(v)} data-testid={`evtab-${v}`}>{VIEW_LABEL[v]}</button>
            ))}
          </div>
          <div id="evpanel" role="region" aria-label={tab ? `${VIEW_LABEL[tab]} view` : "Evidence view"} className="evcol__panel" data-view={tab || "none"}>
            {!tab && <p className="muted" data-testid="no-view">No evidence view is embedded. Pick a tab, or turn one on in Quick Config.</p>}
            {tab === "sequence" && <SequenceView hops={hops} selected={selHop} onSelect={onSelect} />}
            {tab === "reel" && <MovieReel hops={hops} selected={selHop} onSelect={onSelect} />}
            {(tab === "sequence" || tab === "reel") && hops.length > 0 && selHop != null && <StepDetailPanel hops={hops} selected={selHop} onSelect={onSelect} onClose={() => onSelect(null)} />}
            {(tab === "sequence" || tab === "reel") && hops.length > 0 && selHop == null && <p className="muted">Click a step, an actor or a tool-call pill for its full detail.</p>}
            {tab === "topology" && <DiagramView vertical={vertical} resetSignal={resetSignal} lastRun={lastRun} />}
            {tab === "tokens" && (
              <div data-testid="evidence-tokens">
                <p className="muted">The tokens this run used, raw and decoded. {run?.mode === "live" ? "A live token is masked: the server never sends its raw value." : <>Every one is a MOCK token <Tag state="info">MOCK</Tag> issued by this lab and signed with a public mock key; showing it raw is the point (education).</>}</p>
                {run ? <TokenView tokens={run.tokens} /> : <p className="muted">Run a use case to see its tokens.</p>}
              </div>
            )}
          </div>
        </>
      )}
    </section>
  );
}
