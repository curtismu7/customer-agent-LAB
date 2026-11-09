import { currentPath, go, handoffCarry, handoffHref, routeOf } from "../handoff";
import { Tag } from "./Bits";

// The open control for another standalone app: a button that navigates this tab to a RELATIVE path from the fixed allow-list. It exists only when
// this page is served under the lab proxy; otherwise the visitor is told to start the app from the Shelf. (A button, not a link: this lab renders
// no link-outs, a repo test pins that.)
function OpenApp({ app, uc, vertical, userId, label, testId }) {
  const href = handoffHref(app, uc, vertical, currentPath(), userId);
  if (!href) return <p className="muted" data-testid={`${testId}-shelf`}>Start <code>{app}</code> from the Shelf, then pick {uc} there.</p>;
  return <button type="button" className="primary" onClick={() => go(href)} data-testid={testId} data-href={href}>{label}</button>;
}

// A Hand off use case: which app, why, what carries over (ids only, exactly what the link carries), and Open / Preview here.
export function HandoffCard({ uc, vertical, userId, canPreview, onPreview, previewing }) {
  const r = routeOf(uc);
  const carry = handoffCarry(uc.id, vertical, userId) || [];
  return (
    <section className="handoff card" aria-label={`Hand-off to ${r.app}`} data-testid="handoff-card">
      <h3 className="handoff__title"><code>{r.app}</code> <span className="muted">separate app{r.basis ? ` · routing table: ${r.basis}` : ""}</span></h3>
      <ul className="handoff__ids" aria-label="Carried in the link">
        {carry.map(([k, v]) => <li key={k}><Tag>{k}={v}</Tag></li>)}
      </ul>
      <p className="muted">Ids only. Never carried: tokens, secrets or keys, cookies.</p>
      <div className="handoff__actions">
        <OpenApp app={r.app} uc={uc.id} vertical={vertical} userId={userId} label={`Open ${r.app}`} testId="handoff-open" />
        {canPreview && <button type="button" onClick={previewing ? undefined : onPreview} aria-disabled={previewing ? "true" : undefined} data-testid="handoff-preview">Preview here (mock)</button>}
      </div>
      <p className="muted handoff__note" title="The lab proxy remembers one app per browser, so a second tab would send this page's calls to the other app. This lab does not check that the other app is running (no outbound calls).">Opens in this tab; this chat is kept.</p>
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
