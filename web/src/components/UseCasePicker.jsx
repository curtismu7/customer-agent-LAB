import { useMemo, useState } from "react";
import { EXTRAS, NEEDS_LABELS, TRACK_LABELS, haystack, outcomeState } from "../lib";
import { appsText, routeOf } from "../handoff";
import { Tag } from "./Bits";

// The route tag on a row: the catalog outcome for a use case that runs here, "Opens <app>" for a hand-off, "Guide" for a guide. Always a word.
export function RouteTag({ u }) {
  const r = routeOf(u);
  if (r.route === "Hand off") return <Tag state="info" testId="route-tag" title={`Hands off to ${appsText(r)}, ${r.also ? "separate standalone apps" : "a separate standalone app"}`}>Opens {appsText(r)}</Tag>;
  if (r.route === "Guide") return <Tag state="info" testId="route-tag" title="A learning page or script: no lab yet">Guide</Tag>;
  return <Tag state={outcomeState(u.expectedOutcome)} testId="route-tag" title={r.route === "Here + go deeper" ? `Runs here; go deeper in ${r.app}` : "Runs here"}>{u.expectedOutcome}{r.route === "Here + go deeper" ? " +" : ""}</Tag>;
}

// The use case list, grouped by the eight tracks, searchable. Each row shows what the use case needs (badges) and its flag.
export function UseCaseRow({ u, selected, onPick, slim = false }) {
  return (
    <li>
      <button type="button" className="pick__item" aria-pressed={selected} onClick={() => onPick(u.id)} data-testid={`uc-${u.id}`} data-route={routeOf(u).route}>
        <span className="pick__head"><span className="pick__id">{u.id}</span> <span className="pick__title">{u.title}</span> <RouteTag u={u} /></span>
        {!slim && <span className="pick__badges">
          {u.guided ? <Tag state="info" title="The lab opens the product's page and does not compute the outcome">guided</Tag> : <Tag state="ok" title="The lab's engine computes the outcome">computed</Tag>}
          {u.needs.map((n) => <Tag key={n} title={`needs: ${NEEDS_LABELS[n] || n}`}>{n}</Tag>)}
          {u.flag && <Tag state="warn" title="Needs this live feature flag">flag: {u.flag}</Tag>}
          {u.maturity === "needs-build" && <Tag state="warn" title="The source marks this needs-build: lab-simulated">lab-simulated</Tag>}
          {u.opens !== "none" && Object.hasOwn(EXTRAS, u.opens) && <Tag state="info" title="Running it opens an extra page">opens: {EXTRAS[u.opens].label}</Tag>}
        </span>}
      </button>
    </li>
  );
}

// `keep` narrows the list (the Several filter, the diagram pages' runnable-only list); `slim` drops the badge row.
export default function UseCasePicker({ catalog, selectedId, onPick, failed = false, keep = null, slim = false, label = "Use cases" }) {
  const [query, setQuery] = useState("");
  const [openTracks, setOpenTracks] = useState(() => new Set(["foundations"]));
  const q = query.trim().toLowerCase();
  const tracks = useMemo(() => (catalog?.tracks || []).map((t) => ({ ...t, shown: q ? t.usecases.filter((u) => haystack(u).includes(q)) : t.usecases })).map((t) => (keep ? { ...t, shown: t.shown.filter(keep) } : t)), [catalog, q, keep]);
  const found = tracks.reduce((n, t) => n + t.shown.length, 0);
  return (
    <section className="pick" aria-label={label} data-testid="picker">
      <label className="field">Search the {catalog?.total ?? 87} use cases
        <input type="search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="id, title, tool, flag, outcome..." data-testid="search" autoComplete="off" />
      </label>
      <p className="muted" role="status" aria-live="polite" data-testid="search-count">{!catalog && failed ? "Use cases unavailable" : q ? `${found} of ${catalog?.total ?? 87} match` : keep ? `${found} of ${catalog?.total ?? 87} shown` : `${catalog?.total ?? 87} use cases in 8 tracks`}</p>
      {!catalog && (failed ? <p className="muted" data-testid="catalog-failed">The use cases could not be loaded. Is the server running?</p> : <p className="muted">Loading the use cases...</p>)}
      {tracks.map((t) => (t.shown.length === 0 ? null : (
        <details key={t.track} className="pick__track" open={q ? true : openTracks.has(t.track)} onToggle={(e) => { const isOpen = e.currentTarget.open; if (!q) setOpenTracks((cur) => { const next = new Set(cur); if (isOpen) next.add(t.track); else next.delete(t.track); return next; }); }} data-testid={`track-${t.track}`}>
          <summary>{TRACK_LABELS[t.track] || t.track} <span className="muted">({q || keep ? `${t.shown.length} of ${t.count}` : t.count})</span></summary>
          <ul className="pick__list">{t.shown.map((u) => <UseCaseRow key={u.id} u={u} selected={u.id === selectedId} onPick={onPick} slim={slim} />)}</ul>
        </details>
      )))}
      {catalog && q && found === 0 && <p className="muted" data-testid="no-match">No use case matches "{query.slice(0, 60)}".</p>}
    </section>
  );
}
