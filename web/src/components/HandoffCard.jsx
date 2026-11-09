import { currentPath, go, handoffHref, routeOf } from "../handoff";
import { Tag } from "./Bits";

// The open control for another standalone app: a button that navigates this tab to a RELATIVE path from the fixed allow-list. It exists only when
// this page is served under the lab proxy; otherwise the visitor is told to start the app from the Shelf. (A button, not a link: this lab renders
// no link-outs, a repo test pins that.)
function OpenApp({ app, uc, vertical, label, testId }) {
  const href = handoffHref(app, uc, vertical, currentPath());
  if (!href) return <p className="muted" data-testid={`${testId}-shelf`}>Start <code>{app}</code> from the Shelf, then pick {uc} there.</p>;
  return <button type="button" className="primary" onClick={() => go(href)} data-testid={testId} data-href={href}>{label}</button>;
}

// A Hand off use case: which app, why, what carries over (ids only), and Open / Preview here.
export function HandoffCard({ uc, vertical, userId, canPreview, onPreview, previewing }) {
  const r = routeOf(uc);
  return (
    <section className="handoff card" aria-label={`Hand-off to ${r.app}`} data-testid="handoff-card">
      <h3 className="handoff__title"><code>{r.app}</code> <span className="muted">separate app</span></h3>
      <p>{uc.id} runs in its own standalone app: it covers this use case in depth. This lab does not check whether that app is running (no outbound calls).</p>
      <p className="kicker">Why this app</p>
      <p className="muted">{r.basis ? `Routing table: ${r.basis}.` : "Routing table."}</p>
      <p className="kicker">Carried in the link (ids only)</p>
      <ul className="handoff__ids" aria-label="Carried in the link">
        <li><Tag>uc={uc.id}</Tag></li>
        <li><Tag>vertical={vertical}</Tag></li>
        {userId && <li><Tag>user={userId}</Tag></li>}
      </ul>
      <p className="muted">Never carried: tokens, secrets or keys, cookies.</p>
      <div className="handoff__actions">
        <OpenApp app={r.app} uc={uc.id} vertical={vertical} label={`Open ${r.app}`} testId="handoff-open" />
        {canPreview && <button type="button" onClick={previewing ? undefined : onPreview} aria-disabled={previewing ? "true" : undefined} data-testid="handoff-preview">Preview here (mock engine)</button>}
      </div>
      <p className="muted">Opens in this tab: the lab proxy remembers one app per browser. This chat is kept for this workspace.</p>
    </section>
  );
}

// A Here + go deeper use case: it runs here, and one line points at the lab that covers it in depth.
export function GoDeeper({ uc, vertical }) {
  const r = routeOf(uc);
  if (r.route !== "Here + go deeper" || !r.app) return null;
  return (
    <div className="deeper" data-testid="go-deeper">
      <span className="kicker">Go deeper in <code>{r.app}</code></span>
      <OpenApp app={r.app} uc={uc.id} vertical={vertical} label={`Go deeper in ${r.app}`} testId="deeper-open" />
    </div>
  );
}
