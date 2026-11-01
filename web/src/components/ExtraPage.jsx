import { EXTRAS, extraHops, outcomeState, triggerText } from "../lib";
import { Tag } from "./Bits";
import HopList from "./HopList";

// An extra page: it exists only because a use case brought it in (its `opens` field). It shows what that run did through this page's lens, and names
// the product page as a plain label (never a link).
export default function ExtraPage({ opens, entry }) {
  const spec = EXTRAS[opens];
  const { run, uc } = entry;
  return (
    <section className="panel" aria-label={spec.label} data-testid={`extra-${opens}`}>
      <h2 className="panel__title">{spec.label}</h2>
      <p className="muted">Opened by {uc.id}: {uc.title}. It goes away when you press Reset.</p>
      <p>{spec.about}</p>
      <p><Tag state={outcomeState(run.outcome)}>{run.outcome}</Tag> {run.kind === "guided" && <Tag state="warn">guided, not computed</Tag>} <Tag state="info">persona: {run.persona}</Tag></p>
      <p className="muted" data-testid="extra-label">Product page (a label, not a link): <code>{triggerText(uc.trigger)}</code></p>
      {uc.linkOut && <p className="muted" data-testid="extra-linkout">A sibling standalone covers the same ground: <code>{uc.linkOut}</code> (lab reading, a name only)</p>}
      <HopList hops={extraHops(opens, run.hops)} traceparent={run.traceparent} title="Hops for this page" />
    </section>
  );
}
