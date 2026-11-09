import { useEffect, useRef } from "react";
import { actorOf, laneVar, touches, txt } from "./lanes";

// What one actor is, which steps it takes part in (each opens that step), and what it sees. Opened from an actor
// tile or a lifeline box in the sequence view. Escape or the close button dismisses it.
export default function ActorCard({ actorId, hops = [], onSelect, onClose }) {
  const closeRef = useRef(null);
  // Focus moves into the card; when it closes, focus goes back to whatever opened it (tile or lifeline box).
  useEffect(() => {
    if (!actorId) return undefined;
    const opener = typeof document !== "undefined" ? document.activeElement : null;
    closeRef.current?.focus();
    return () => { if (opener && opener.isConnected && typeof opener.focus === "function") opener.focus(); };
  }, [actorId]);
  if (!actorId) return null;
  const a = actorOf(actorId);
  const mine = hops.filter((h) => touches(h, actorId));
  const received = mine.filter((h) => h.to === actorId && h.from !== actorId);
  return (
    <div className="ev-actorcard" role="dialog" aria-label={`${a.label} actor details`} style={{ "--lane": laneVar(actorId) }}
      data-testid="actor-card" onKeyDown={(e) => { if (e.key === "Escape") { e.stopPropagation(); onClose?.(); } }}>
      <div className="ev-actorcard__head">
        <span className="ev-ini" aria-hidden="true">{a.initials}</span>
        <b>{a.label}</b>
        <span className="ev-spacer" />
        <button type="button" ref={closeRef} className="ev-mini" aria-label={`Close ${a.label} details`} onClick={() => onClose?.()}>×</button>
      </div>
      <p className="ev-actorcard__role">{a.role}</p>
      <dl className="ev-kv">
        <dt>In steps</dt>
        <dd>
          {mine.length === 0 ? <span className="ev-muted">none in this run</span> : (
            <span className="ev-steps">
              {mine.map((h) => (
                <button type="button" key={h.n} className="ev-mini" aria-label={`Open step ${h.n}, ${txt(h.title)}`} onClick={() => onSelect?.(h.n)}>{h.n}</button>
              ))}
            </span>
          )}
        </dd>
        <dt>Sees</dt>
        <dd>{a.sees}</dd>
        {received.length > 0 && (<>
          <dt>Receives here</dt>
          <dd>{received.map((h) => `${h.n} ${txt(h.title)}`).join(", ")}</dd>
        </>)}
        <dt>Never sees</dt>
        <dd>{a.never}</dd>
      </dl>
    </div>
  );
}
