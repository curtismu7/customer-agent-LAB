import FloatingDialog from "../floating-dialog/FloatingDialog";
import { actorOf, laneVar, touches, txt } from "./lanes";

// What one actor is, which steps it takes part in (each opens that step), and what it sees. Opened from an actor
// tile or a lifeline box in the sequence view. A FloatingDialog (owner 2026-11-09): drag it by the title bar, resize
// it, or pop it out to its own window. Escape or the close button dismisses it; focus moves to the close button on
// open and goes back to whatever opened it (tile or lifeline box) on close.
export default function ActorCard({ actorId, hops = [], onSelect, onClose }) {
  if (!actorId) return null;
  const a = actorOf(actorId);
  const mine = hops.filter((h) => touches(h, actorId));
  const received = mine.filter((h) => h.to === actorId && h.from !== actorId);
  const right = typeof window !== "undefined" ? Math.max(8, window.innerWidth - 336) : null;
  return (
    <FloatingDialog isOpen noBackdrop onClose={() => onClose?.()} focusKey={actorId}
      title={<><span className="ev-ini" aria-hidden="true">{a.initials}</span><b>{a.label}</b></>}
      ariaLabel={`${a.label} actor details`} closeAriaLabel={`Close ${a.label} details`} footer={null}
      className="ev-actorcard-dialog" style={{ "--lane": laneVar(actorId) }}
      defaultWidth={320} defaultHeight={null} defaultX={right} defaultY={96} minWidth={260} minHeight={160}
      storageKey="evidence.actorCard">
      <div className="ev-actorcard" data-testid="actor-card">
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
    </FloatingDialog>
  );
}
