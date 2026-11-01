import { useMemo, useState } from "react";
import { EXTRAS, NEEDS_LABELS, TRACK_LABELS, haystack } from "../lib";
import { Tag } from "./Bits";

// The use case list, grouped by the eight tracks, searchable. Each row shows what the use case needs (badges) and its flag.
export function UseCaseRow({ u, selected, onPick }) {
  return (
    <li>
      <button type="button" className="pick__item" aria-pressed={selected} onClick={() => onPick(u.id)} data-testid={`uc-${u.id}`}>
        <span className="pick__head"><span className="pick__id">{u.id}</span> <span className="pick__title">{u.title}</span></span>
        <span className="pick__badges">
          {u.guided ? <Tag state="info" title="The lab opens the product's page and does not compute the outcome">guided</Tag> : <Tag state="ok" title="The lab's engine computes the outcome">computed</Tag>}
          {u.needs.map((n) => <Tag key={n} title={`needs: ${NEEDS_LABELS[n] || n}`}>{n}</Tag>)}
          {u.flag && <Tag state="warn" title="Needs this live feature flag">flag: {u.flag}</Tag>}
          {u.maturity === "needs-build" && <Tag state="warn" title="The source marks this needs-build: lab-simulated">lab-simulated</Tag>}
          {u.opens !== "none" && Object.hasOwn(EXTRAS, u.opens) && <Tag state="info" title="Running it opens an extra page">opens: {EXTRAS[u.opens].label}</Tag>}
        </span>
      </button>
    </li>
  );
}

export default function UseCasePicker({ catalog, selectedId, onPick, failed = false }) {
  const [query, setQuery] = useState("");
  const [openTracks, setOpenTracks] = useState(() => new Set(["foundations"]));
  const q = query.trim().toLowerCase();
  const tracks = useMemo(() => (catalog?.tracks || []).map((t) => ({ ...t, shown: q ? t.usecases.filter((u) => haystack(u).includes(q)) : t.usecases })), [catalog, q]);
  const found = tracks.reduce((n, t) => n + t.shown.length, 0);
  return (
    <section className="pick" aria-label="Use cases" data-testid="picker">
      <label className="field">Search the {catalog?.total ?? 87} use cases
        <input type="search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="id, title, tool, flag, outcome..." data-testid="search" autoComplete="off" />
      </label>
      <p className="muted" role="status" aria-live="polite" data-testid="search-count">{!catalog && failed ? "Use cases unavailable" : q ? `${found} of ${catalog?.total ?? 87} match` : `${catalog?.total ?? 87} use cases in 8 tracks`}</p>
      {!catalog && (failed ? <p className="muted" data-testid="catalog-failed">The use cases could not be loaded. Is the server running?</p> : <p className="muted">Loading the use cases...</p>)}
      {tracks.map((t) => (t.shown.length === 0 ? null : (
        <details key={t.track} className="pick__track" open={q ? true : openTracks.has(t.track)} onToggle={(e) => { const isOpen = e.currentTarget.open; if (!q) setOpenTracks((cur) => { const next = new Set(cur); if (isOpen) next.add(t.track); else next.delete(t.track); return next; }); }} data-testid={`track-${t.track}`}>
          <summary>{TRACK_LABELS[t.track] || t.track} <span className="muted">({q ? `${t.shown.length} of ${t.count}` : t.count})</span></summary>
          <ul className="pick__list">{t.shown.map((u) => <UseCaseRow key={u.id} u={u} selected={u.id === selectedId} onPick={onPick} />)}</ul>
        </details>
      )))}
      {catalog && q && found === 0 && <p className="muted" data-testid="no-match">No use case matches "{query.slice(0, 60)}".</p>}
    </section>
  );
}
