import { useState } from "react";
import { Tag } from "./Tag";
import { actorOf, readPref, STAGE_STATE, txt, verdictState, verdictWord, writePref } from "./lanes";
import "./evidence.css";

// One hop's full detail, ported from AI-DEMO2's StepDetailPanel and ordered claim before evidence: what happened, the
// gateway filter chain, the decision, what changed, then the raw (already redacted) request and response. The RFC
// column (why, what the specification requires, the common failure) is behind the "RFC info" toggle, remembered.
const RFC_KEY = "cal.ev.rfcInfo";
const ZOOM_KEY = "cal.ev.sdp.zoom";
const Z_MIN = 80, Z_MAX = 160, Z_STEP = 10, Z_DEFAULT = 120;
const NOISE = new Set(["iat", "nbf", "exp", "jti"]);

function requestText(r) {
  if (!r || typeof r !== "object") return r ? String(r) : "";
  const lines = [];
  if (r.method || r.url) lines.push(`${r.method || ""} ${r.url || ""}`.trim());
  for (const [k, v] of Object.entries(r.headers || {})) lines.push(`${k}: ${typeof v === "string" ? v : JSON.stringify(v)}`);
  if (r.body !== undefined) lines.push("", typeof r.body === "string" ? r.body : JSON.stringify(r.body, null, 2));
  return lines.join("\n");
}
function responseText(r) {
  if (!r || typeof r !== "object") return r ? String(r) : "";
  const lines = [];
  if (r.status != null) lines.push(`HTTP ${r.status}`);
  for (const [k, v] of Object.entries(r.headers || {})) lines.push(`${k}: ${typeof v === "string" ? v : JSON.stringify(v)}`);
  if (r.body !== undefined) lines.push("", typeof r.body === "string" ? r.body : JSON.stringify(r.body, null, 2));
  return lines.join("\n");
}
const cell = (v) => (v === undefined ? null : typeof v === "object" ? JSON.stringify(v) : String(v));
const decisionState = (o) => (/^permit/i.test(o) ? "ok" : /^deny/i.test(o) ? "bad" : "warn");

function ClaimDiff({ diff }) {
  const before = diff.before || {}, after = diff.after || {};
  const changed = new Set(diff.changed || []);
  const keys = [...new Set([...Object.keys(before), ...Object.keys(after)])].filter((k) => !NOISE.has(k));
  if (!keys.length) return null;
  return (
    <div className="ev-scroll">
      <table className="sdp__diff" data-testid="claim-diff">
        <thead><tr><th scope="col">Claim</th><th scope="col">Before</th><th scope="col">After</th></tr></thead>
        <tbody>
          {keys.map((k) => {
            const c = changed.has(k);
            const b = cell(before[k]), a = cell(after[k]);
            return (
              <tr key={k} data-changed={c ? "true" : undefined}>
                <td className="ev-mono">{txt(k)}{c && <span className="sdp__chg"> changed</span>}</td>
                <td className="ev-mono">{b == null ? <span className="ev-muted">none</span> : txt(b)}</td>
                <td className="ev-mono">{a == null ? <span className="ev-muted">none</span> : txt(a)}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function RfcColumn({ spec }) {
  if (!spec) return <div className="sdp__col sdp__rfc"><h4>Specification</h4><p className="ev-muted">No specification text for this hop kind.</p></div>;
  const refs = Array.isArray(spec.refs) ? spec.refs.filter((r) => r?.label) : [];
  return (
    <div className="sdp__col sdp__rfc" data-testid="rfc-column">
      {spec.none && (<><h4>Specification</h4><p data-testid="spec-none">No specification governs this hop.</p></>)}
      {spec.why && (<><h4>Why it works this way</h4><p>{txt(spec.why)}</p></>)}
      {!spec.none && (spec.mandate || refs.length > 0) && (<>
        <h4>What the specification requires</h4>
        {spec.mandate && <p>{txt(spec.mandate)}</p>}
        {refs.length > 0 && (
          <ul className="sdp__refs" aria-label="Specification references">
            {/* Plain labels, not links: this lab never links out (repo rule); the address is in the tooltip. */}
            {refs.map((r) => <li key={`${r.label}-${r.url}`} className="ev-pill" title={txt(r.title || "")}>{txt(r.label)}{r.url ? <span className="ev-ref-url"> {txt(r.url)}</span> : null}</li>)}
          </ul>
        )}
      </>)}
      {spec.failure && (<><h4>Common failure mode</h4><p>{txt(spec.failure)}</p></>)}
    </div>
  );
}

export default function StepDetailPanel({ hops = [], selected = null, onSelect, onClose }) {
  const [rfc, setRfc] = useState(() => readPref(RFC_KEY, (v) => v === "1" || v === "0", "1") === "1");
  const [zoom, setZoom] = useState(() => Number(readPref(ZOOM_KEY, (v) => { const n = Number(v); return n >= Z_MIN && n <= Z_MAX; }, Z_DEFAULT)));
  const toggleRfc = () => setRfc((on) => { writePref(RFC_KEY, on ? "0" : "1"); return !on; });
  const stepZoom = (d) => setZoom((z) => { const n = Math.min(Z_MAX, Math.max(Z_MIN, z + d)); writePref(ZOOM_KEY, n); return n; });

  const at = hops.findIndex((h) => h.n === selected);
  const h = hops[at];
  if (!h) return null;
  const prev = hops[at - 1], next = hops[at + 1];
  const from = actorOf(h.from), to = actorOf(h.to);
  const stages = Array.isArray(h.stages) ? h.stages : [];
  const stopAt = stages.findIndex((s) => s.result === "fail");
  const kv = Array.isArray(h.kv) ? h.kv : [];
  const diff = h.claimDiff && (h.claimDiff.before || h.claimDiff.after) ? h.claimDiff : null;
  const changed = Boolean(diff) || kv.length > 0;
  const req = requestText(h.request), res = responseText(h.response);
  const d = h.decision;

  return (
    <section className="ev-root sdp" aria-label={`Step ${h.n} detail`} data-testid="step-detail" style={{ "--ev-scale": zoom / 100 }}
      onKeyDown={(e) => { if (e.key === "Escape") onClose?.(); }}>
      <div className="sdp__head">
        <span className="sdp__num" aria-hidden="true">{h.n}</span>
        <div className="sdp__title">
          <h3>{txt(h.title)}</h3>
          <span className="ev-muted">{from.label} → {to.label}</span>{" "}
          <Tag state={verdictState(h.verdict)} testId="sdp-status">{verdictWord(h.verdict)}</Tag>
          {h.mock && <> <Tag state="info" title="Produced by this lab's mock engine">MOCK</Tag></>}
        </div>
        <span className="ev-spacer" />
        <span className="sq-grp" role="group" aria-label="Detail text size">
          <button type="button" aria-label="Smaller text" disabled={zoom <= Z_MIN} onClick={() => stepZoom(-Z_STEP)}>A−</button>
          <span data-testid="sdp-zoom">{zoom}%</span>
          <button type="button" aria-label="Larger text" disabled={zoom >= Z_MAX} onClick={() => stepZoom(Z_STEP)}>A+</button>
        </span>
        <button type="button" aria-pressed={rfc} onClick={toggleRfc} data-testid="rfc-toggle">RFC info</button>
        <button type="button" aria-label="Previous step" disabled={!prev} onClick={() => prev && onSelect?.(prev.n)}>‹ Prev</button>
        <button type="button" aria-label="Next step" disabled={!next} onClick={() => next && onSelect?.(next.n)}>Next ›</button>
        {onClose && <button type="button" aria-label="Close step detail" onClick={onClose}>×</button>}
      </div>

      <div className="sdp__cols" data-rfc={rfc ? "on" : "off"}>
        <div className="sdp__col">
          <h4>What happened</h4>
          <p data-testid="sdp-narrative">{txt(h.narrative || h.label || h.title)}</p>
          {h.note && <p className="ev-muted">{txt(h.note)}</p>}

          {stages.length > 0 && (<>
            <h4>Gateway filter chain</h4>
            <ol className="sdp__stages" data-testid="stages">
              {stages.map((s, i) => (
                <li key={`${s.name}-${i}`} data-result={s.result}>
                  <Tag state={STAGE_STATE[s.result] || "info"}>{txt(s.result)}</Tag>
                  <b>{txt(s.name)}</b>
                  <span className="ev-muted">{s.note ? txt(s.note) : ""}{i === stopAt && !/stopped here/.test(s.note || "") ? " (stopped here)" : ""}</span>
                </li>
              ))}
            </ol>
          </>)}

          {d && (<>
            <h4>Decision</h4>
            <p data-testid="decision"><Tag state={decisionState(String(d.outcome || ""))}>{txt(d.outcome)}</Tag>{d.by && <span className="ev-muted"> by {txt(d.by)}</span>}</p>
            {Array.isArray(d.reasons) && d.reasons.length > 0 && <ul className="sdp__list">{d.reasons.map((r, i) => <li key={i}>{txt(r)}</li>)}</ul>}
          </>)}

          <h4>What changed</h4>
          {changed ? (<>
            {diff && <ClaimDiff diff={diff} />}
            {kv.length > 0 && (
              <dl className="ev-kv" data-testid="sdp-kv">
                {kv.map(([k, v], i) => <div key={`${k}-${i}`} className="ev-kv__row"><dt>{txt(k)}</dt><dd className="ev-mono">{txt(v)}</dd></div>)}
              </dl>
            )}
          </>) : (
            <p className="ev-muted" data-testid="nothing-changed">{h.verdict === "skip" ? "This hop did not run, so nothing changed." : "Nothing changed — this hop carries the request without altering it."}</p>
          )}
        </div>

        <div className="sdp__col">
          <h4>Request</h4>
          {req ? <pre className="ev-pre" tabIndex={0} aria-label={`Step ${h.n} request`}>{txt(req)}</pre> : <p className="ev-muted">No request recorded.</p>}
          <h4>Response</h4>
          {res ? <pre className="ev-pre" tabIndex={0} aria-label={`Step ${h.n} response`}>{txt(res)}</pre> : <p className="ev-muted">No response recorded.</p>}
          {h.traceparent && <p className="ev-muted">traceparent <span className="ev-mono">{txt(h.traceparent)}</span></p>}
        </div>

        {rfc && <RfcColumn spec={h.spec} />}
      </div>
    </section>
  );
}
