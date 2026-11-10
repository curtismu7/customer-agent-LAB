import { appsText, currentPath, go, handoffHref, routeOf } from "../handoff";

// The open control for another standalone app: a button that navigates this tab to a RELATIVE path from the fixed allow-list. It exists only when
// this page is served under the lab proxy; otherwise the visitor is told to start the app from the Shelf. (A button, not a link: this lab renders
// no link-outs, a repo test pins that.)
function OpenApp({ app, uc, vertical, userId, label, testId }) {
  const href = handoffHref(app, uc, vertical, currentPath(), userId);
  if (!href) return <p className="muted" data-testid={`${testId}-shelf`}>Start <code>{app}</code> from the Shelf, then pick {uc} there.</p>;
  return <button type="button" className="primary" onClick={() => go(href)} data-testid={testId} data-href={href}>{label}</button>;
}

// A Hand off use case in the chat: one line saying where it is handled, then Open (or Start it from the Shelf) and Preview here. Why it hands off,
// what the link carries and the routing basis are in the evidence column's hand-off summary and the use case's route tag.
export function HandoffCard({ uc, vertical, userId, canPreview, onPreview, previewing }) {
  const r = routeOf(uc);
  return (
    <section className="handoff" aria-label={`Hand-off to ${appsText(r)}`} data-testid="handoff-card">
      <p data-testid="turn-handoff-say">This is handled in {appsText(r)}, its own app.</p>
      <div className="handoff__actions">
        <OpenApp app={r.app} uc={uc.id} vertical={vertical} userId={userId} label={`Open ${r.app}`} testId="handoff-open" />
        {r.also && <OpenApp app={r.also} uc={uc.id} vertical={vertical} userId={userId} label={`Or open ${r.also}`} testId="handoff-open-also" />}
        {canPreview && <button type="button" onClick={previewing ? undefined : onPreview} aria-disabled={previewing ? "true" : undefined} data-testid="handoff-preview">Preview here (mock)</button>}
      </div>
    </section>
  );
}

// A Here + go deeper use case: it runs here, and one line points at the lab that covers it in depth.
export function GoDeeper({ uc, vertical, userId }) {
  const r = routeOf(uc);
  if (r.route !== "Here + go deeper" || !r.app) return null;
  return (
    <div className="deeper" data-testid="go-deeper">
      <span className="kicker">Go deeper in <code>{r.app}</code></span>
      <OpenApp app={r.app} uc={uc.id} vertical={vertical} userId={userId} label={`Go deeper in ${r.app}`} testId="deeper-open" />
    </div>
  );
}
